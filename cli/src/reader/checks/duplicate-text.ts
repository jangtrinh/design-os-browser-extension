import { formatIsoWithOffset, mintUlid, normalizeNfc, sha256Hex } from '../../../../shared/hash.js';
import {
  DEFAULT_MAX_AGE_BY_CLASS,
  READER_SCHEMA_VERSION,
  REDACTION_POLICY_ID,
  SITE_PACING_POLICIES,
  type ReaderCaller,
  type ReaderEnvelope,
  type ReaderSiteId,
} from '../../../../shared/reader-schema.js';
import { registerReaderCheck } from '../reader-registry.js';
import type { ReaderRuntime } from '../reader-runtime.js';
import { DEFAULT_OWNER_HANDLES, resolveOwnerAllowlist } from '../redaction.js';

export function normalizeComparisonText(raw: string): string {
  return normalizeNfc(raw)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function charTrigrams(text: string): Set<string> {
  const clean = normalizeComparisonText(text);
  const out = new Set<string>();
  if (clean.length <= 3) {
    if (clean) out.add(clean);
    return out;
  }
  for (let i = 0; i <= clean.length - 3; i += 1) {
    out.add(clean.slice(i, i + 3));
  }
  return out;
}

export function textSimilarity(a: string, b: string): number {
  const na = normalizeComparisonText(a);
  const nb = normalizeComparisonText(b);
  if (!na && !nb) return 1;
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ta = charTrigrams(na);
  const tb = charTrigrams(nb);
  let inter = 0;
  for (const x of ta) {
    if (tb.has(x)) inter += 1;
  }
  return (2 * inter) / (ta.size + tb.size);
}

export interface DuplicateCandidate {
  text: string;
  url: string;
  author_handle?: string;
}

export function evaluateDuplicateText(params: {
  draftText: string;
  candidates: DuplicateCandidate[];
  repliesComplete: boolean;
  ownerHandles?: string[];
  similarityThreshold?: number;
}): {
  verdict: 'duplicate' | 'clear' | 'unknown';
  matches: Array<{ url: string; similarity: number; author_is_jang: boolean; exact_sha256: boolean }>;
  replies_complete: boolean;
  draft_sha256: string;
} {
  const threshold = params.similarityThreshold ?? 0.9;
  const allow = resolveOwnerAllowlist(params.ownerHandles ?? DEFAULT_OWNER_HANDLES);
  const normDraft = normalizeComparisonText(params.draftText);
  const draftSha = sha256Hex(normDraft);

  const matches: Array<{ url: string; similarity: number; author_is_jang: boolean; exact_sha256: boolean }> = [];
  for (const c of params.candidates) {
    const normCand = normalizeComparisonText(c.text);
    const exactSha = sha256Hex(normCand) === draftSha;
    const sim = exactSha ? 1 : Number(textSimilarity(normDraft, normCand).toFixed(4));
    if (exactSha || sim >= threshold) {
      const handle = (c.author_handle ?? '').replace(/^@/, '').toLowerCase();
      matches.push({
        url: c.url,
        similarity: sim,
        author_is_jang: Boolean(handle && allow.has(handle)),
        exact_sha256: exactSha,
      });
    }
  }

  let verdict: 'duplicate' | 'clear' | 'unknown';
  if (matches.length > 0) {
    verdict = 'duplicate';
  } else if (!params.repliesComplete) {
    // R8 invariant: partial replies can NEVER yield "clear".
    verdict = 'unknown';
  } else {
    verdict = 'clear';
  }

  return { verdict, matches, replies_complete: params.repliesComplete, draft_sha256: draftSha };
}

export function registerDuplicateTextCheck(): void {
  registerReaderCheck('duplicate_text', async (runtime: ReaderRuntime, params: Record<string, unknown>, caller: ReaderCaller) => {
    const site = (typeof params.site === 'string' ? params.site : 'threads') as ReaderSiteId;
    const threadUrl = typeof params.thread_url === 'string' ? params.thread_url : typeof params.profile_url === 'string' ? params.profile_url : '';
    const draftText = String(params.text ?? '');
    const maxAgeS = typeof params.max_age_s === 'number' ? params.max_age_s : DEFAULT_MAX_AGE_BY_CLASS.duplicate_text;
    const targetKey = `check:duplicate_text:${site}:${sha256Hex(threadUrl || draftText).slice(0, 16)}`;

    let candidates: DuplicateCandidate[] = Array.isArray(params.candidates)
      ? (params.candidates as DuplicateCandidate[])
      : [];
    let repliesComplete = typeof params.replies_complete === 'boolean' ? params.replies_complete : true;
    const notes: string[] = [];

    if (candidates.length === 0 && threadUrl) {
      const view = site === 'linkedin' ? 'post.comments' : 'post.replies';
      const readEnv = await runtime.read({
        site,
        view,
        target: threadUrl,
        max_age_s: maxAgeS,
        evidence: 'off',
        caller,
      });
      if (!readEnv.ok) {
        repliesComplete = false;
        notes.push(`Unable to read live thread (${readEnv.error_code ?? 'ERROR'}); returning unknown.`);
      } else {
        const d = readEnv.data as Record<string, unknown>;
        if (typeof d.replies_complete === 'boolean') repliesComplete = d.replies_complete;
        if (d.comments_rendered === false) repliesComplete = false;
        const rows = (Array.isArray(d.items) ? d.items : Array.isArray(d.comments) ? d.comments : []) as Array<Record<string, unknown>>;
        candidates = rows.map((r) => ({
          text: String(r.text ?? ''),
          url: String(r.url ?? threadUrl),
          author_handle: String(r.author_handle ?? r.author_name ?? ''),
        }));
      }
    }

    const res = evaluateDuplicateText({
      draftText,
      candidates,
      repliesComplete,
    });

    const nowDate = new Date(runtime.getClockNowMs());
    const nowIso = formatIsoWithOffset(nowDate);
    const auditId = mintUlid('au', nowDate.getTime());
    const p = runtime.pacingStatus(site);
    const pSingle = Array.isArray(p)
      ? { site, loads_left_hour: SITE_PACING_POLICIES[site].perHour, loads_left_day: SITE_PACING_POLICIES[site].perDay }
      : { site: p.site, loads_left_hour: p.loads_left_hour, loads_left_day: p.loads_left_day };

    const env: ReaderEnvelope<Record<string, unknown>> = {
      ok: true,
      schema: READER_SCHEMA_VERSION,
      site,
      view: 'check.duplicate_text',
      target: threadUrl,
      target_key: targetKey,
      captured_at: nowIso,
      source: 'live',
      freshness: { max_age_s: maxAgeS, age_s: 0, stale: false },
      complete: true,
      missing_required: [],
      gate: 'CLEAR',
      pacing: pSingle,
      redaction: { policy: REDACTION_POLICY_ID, fields_redacted: 0 },
      evidence_id: null,
      audit_id: auditId,
      caller,
      data: res,
      notes,
      error_code: null,
    };
    runtime.recordAuditRow(env, nowIso, nowIso, 'check', 'n/a', 0, 'CLEAR', 'CLEAR', null);
    return env;
  });
}
