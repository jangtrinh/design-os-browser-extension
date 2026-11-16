import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { shortHash8 } from '../../../shared/hash.js';
import type { ReaderSiteId } from '../../../shared/reader-schema.js';

export const DEFAULT_OWNER_HANDLES = [
  'jangtrinh',
  'jangtrinhvn',
  'designosbyjang',
  'design-os',
  'uxdesignvn',
  'jang trinh',
];

const ALREADY_REDACTED_RE = /^\[(redacted|member):[a-f0-9]{8}\]$/;
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.]+/g;
const PHONE_RE = /(?<!\d)0\d{2,3}[ .]?\d{3}[ .]?\d{3,4}(?!\d)/g;
const HTTP_URL_RE = /https?:\/\/[^\s")]+/g;
const QUERY_PARAM_RE = /(vanityName|recipient|profileUrn)=[^&\s")]+/g;
const LINKEDIN_PATH_SLUG_RE = /(?<![\w/])\/in\/(?!jangtrinh\/)(?!\[member)([^/?#"\s]+)/g;
const PILOT_METRIC_RE =
  /^[\d,.+]+\s*(reactions?|comments?|impressions?|followers|connections|reposts?)?$|^(Search|Message|Follow|Connect|More|Show all|Next|Previous|Page \d+|\d+)$/i;

const PROMPT_INJECTION_RE =
  /(ignore\s+(all\s+)?previous\s+instructions|disregard\s+system\s+prompt|<\|im_start\|>|system\s*prompt\s*:|assistant\s*:\s*please|you\s+must\s+override)/i;

export interface RedactOptions {
  site: ReaderSiteId;
  view?: string;
  allowHandles?: string[];
  extraThirdPartyNames?: string[];
}

export interface RedactResult<T> {
  redacted: T;
  fieldsRedacted: number;
  pageInstructionIgnored: boolean;
}

export function resolveOwnerAllowlist(extra?: string[]): Set<string> {
  const fromEnv = (process.env.BROWSER_AGENT_ALLOWLIST_HANDLES ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return new Set([
    ...DEFAULT_OWNER_HANDLES.map((s) => s.toLowerCase()),
    ...(extra ?? []).map((s) => s.toLowerCase()),
    ...fromEnv,
  ]);
}

function scrubString(text: string, allow: Set<string>, isThirdPartyPage: boolean): { value: string; changed: number } {
  let changed = 0;
  let out = text;

  const replaceCounted = (re: RegExp, fn: (...args: string[]) => string): void => {
    out = out.replace(re, (...m) => {
      const next = fn(...m);
      if (next !== m[0]) changed += 1;
      return next;
    });
  };

  replaceCounted(EMAIL_RE, () => '[email-redacted]');
  replaceCounted(PHONE_RE, () => '[phone-redacted]');
  replaceCounted(HTTP_URL_RE, (rawUrl) => {
    let u = rawUrl.replace(/\/in\/(?!jangtrinh\/)([^/?#"]+)/g, (full, slug: string) => {
      if (allow.has(slug.toLowerCase()) || slug.startsWith('[member:')) return full;
      return `/in/[member:${shortHash8(slug)}]`;
    });
    if (isThirdPartyPage && u.includes('?') && !u.includes('keywords=design%20system')) {
      u = `${u.split('?')[0]}?[query-redacted]`;
    } else if (u.includes('messaging/compose') && u.includes('?')) {
      u = `${u.split('?')[0]}?[query-redacted]`;
    }
    return u;
  });
  replaceCounted(QUERY_PARAM_RE, (_, key) => `${key}=[redacted:${shortHash8(_)}]`);
  replaceCounted(LINKEDIN_PATH_SLUG_RE, (full, slug) => {
    if (allow.has(slug.toLowerCase())) return full;
    return `/in/[member:${shortHash8(slug)}]`;
  });
  return { value: out, changed };
}

function hashThirdPartyValue(value: string, prefix: 'redacted' | 'member', allow: Set<string>): { value: string; redacted: boolean } {
  const trimmed = value.trim();
  if (!trimmed || ALREADY_REDACTED_RE.test(trimmed)) return { value, redacted: false };
  if (allow.has(trimmed.toLowerCase())) return { value, redacted: false };
  return { value: `[${prefix}:${shortHash8(trimmed)}]`, redacted: true };
}

const NAME_KEYS = new Set(['author_name', 'authorName', 'full_name', 'fullName', 'headline', 'viewer_name', 'name']);
const SLUG_KEYS = new Set(['author_handle', 'authorHandle', 'public_identifier', 'publicIdentifier', 'handle', 'slug', 'username']);

export function redactReaderPayload<T>(payload: T, opts: RedactOptions): RedactResult<T> {
  const allow = resolveOwnerAllowlist(opts.allowHandles);
  const keepListNames = opts.view === 'following.list' || opts.view === 'followers.list';
  const keepCommentFeed = opts.view === 'feed.comments' || opts.view === 'comments.read' || opts.view === 'product.comments';
  let fieldsRedacted = 0;
  let pageInstructionIgnored = false;

  const extraNames = new Set((opts.extraThirdPartyNames ?? []).map((n) => n.trim().toLowerCase()).filter(Boolean));

  const walk = (node: unknown, parentObj?: Record<string, unknown>, key?: string): unknown => {
    if (typeof node === 'string') {
      if (PROMPT_INJECTION_RE.test(node)) pageInstructionIgnored = true;
      for (const n of extraNames) {
        if (node.toLowerCase().includes(n)) {
          fieldsRedacted += 1;
          return `[redacted:${shortHash8(node)}]`;
        }
      }

      const isThirdPartyItem = parentObj?.third_party === true;
      if (key && SLUG_KEYS.has(key) && !(keepListNames || keepCommentFeed) && !(key === 'slug' && opts.view === 'product.page')) {
        const res = hashThirdPartyValue(node, 'member', allow);
        if (res.redacted) fieldsRedacted += 1;
        return res.value;
      }
      if (key && NAME_KEYS.has(key) && isThirdPartyItem !== true && !keepListNames) {
        if (key === 'name' && opts.view?.startsWith('analytics')) return node;
        if (!allow.has(node.trim().toLowerCase()) && !PILOT_METRIC_RE.test(node.trim())) {
          const isViewerOrPerson = opts.view === 'analytics.profile_views' || opts.view === 'profile.public' || opts.view === 'search.people' || isThirdPartyItem === false;
          if (isViewerOrPerson || key !== 'name') {
            const res = hashThirdPartyValue(node, 'redacted', allow);
            if (res.redacted) fieldsRedacted += 1;
            return res.value;
          }
        }
      }
      if (key === 'email' || key === 'phone' || key === 'phone_number') {
        fieldsRedacted += 1;
        return `[${key === 'email' ? 'email' : 'phone'}-redacted]`;
      }
      if (isThirdPartyItem && keepListNames && (key === 'profile_url' || key === 'profileUrl' || key === 'handle' || key === 'display_name')) {
        const scrubbedOnlyPii = node.replace(EMAIL_RE, '[email-redacted]').replace(PHONE_RE, '[phone-redacted]');
        if (scrubbedOnlyPii !== node) fieldsRedacted += 1;
        return scrubbedOnlyPii;
      }
      const scrubbed = scrubString(node, allow, !allow.has(node.toLowerCase()));
      fieldsRedacted += scrubbed.changed;
      return scrubbed.value;
    }

    if (Array.isArray(node)) return node.map((item) => walk(item));

    if (node && typeof node === 'object') {
      const rec = node as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rec)) {
        out[k] = walk(v, rec, k);
      }
      return out;
    }
    return node;
  };

  const redacted = walk(payload) as T;
  return { redacted, fieldsRedacted, pageInstructionIgnored };
}

export function detectHiddenPromptInstructions(texts: string[]): boolean {
  return texts.some((t) => PROMPT_INJECTION_RE.test(t));
}

const PILOT_JANG = new Set([
  '05-observe-profile', '06-observe-analytics-content', '07-observe-analytics-content-settled',
  '13-observe-recent-activity', '16-observe-post', '29-observe-post-full', '30-observe-post-full-settled',
]);
const PILOT_THIRD = new Set([
  '09-observe-profile-views', '10-observe-profile-views-settled', '19-observe-search', '22-observe-search-result-profile',
]);

/** Direct TypeScript port of `docs/pilot/2026-11-16-linkedin-live/redact.py` for zero-diff golden parity. */
export function redactPilotRawDir(rawDir: string, outDir: string): string[] {
  mkdirSync(outDir, { recursive: true });
  const allow = new Set<string>();
  for (const f of PILOT_JANG) {
    const parsed = JSON.parse(readFileSync(join(rawDir, `${f}.json`), 'utf8')) as {
      data: { nodes: Array<{ name: string }> };
    };
    for (const n of parsed.data.nodes) allow.add(n.name);
  }

  const hash8 = (s: string): string => shortHash8(s);
  const urlRewrite = (u: string, third: boolean): string => {
    let out = u.replace(/\/in\/(?!jangtrinh\/)([^/?#"]+)/g, (_, g1: string) => `/in/[member:${hash8(g1)}]`);
    if (third && out.includes('?') && !out.includes('keywords=design%20system')) {
      out = `${out.split('?')[0]}?[query-redacted]`;
    }
    if (out.includes('messaging/compose')) {
      out = `${out.split('?')[0]}?[query-redacted]`;
    }
    return out;
  };
  const scrub = (s: string, third: boolean): string => {
    let out = s.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email-redacted]');
    out = out.replace(/(?<!\d)0\d{2,3}[ .]?\d{3}[ .]?\d{3,4}(?!\d)/g, '[phone-redacted]');
    out = out.replace(/https?:\/\/[^\s")]+/g, (m) => urlRewrite(m, third));
    out = out.replace(/(vanityName|recipient|profileUrn)=[^&\s")]+/g, (m, g1: string) => `${g1}=[redacted:${hash8(m)}]`);
    out = out.replace(/(?<![\w/])\/in\/(?!jangtrinh\/)(?!\[member)([^/?#"\s]+)/g, (_, g1: string) => `/in/[member:${hash8(g1)}]`);
    return out;
  };
  const walk = (o: unknown, third: boolean): unknown => {
    if (Array.isArray(o)) return o.map((v) => walk(v, third));
    if (o && typeof o === 'object') {
      const next: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(o as Record<string, unknown>)) next[k] = walk(v, third);
      return next;
    }
    if (typeof o === 'string') return scrub(o, third);
    return o;
  };

  const written: string[] = [];
  for (const name of readdirSync(rawDir).filter((n) => n.endsWith('.json')).sort()) {
    const f = name.slice(0, -5);
    let d = JSON.parse(readFileSync(join(rawDir, name), 'utf8')) as Record<string, unknown>;
    const third = PILOT_THIRD.has(f);
    if (third) {
      const data = d.data as { nodes: Array<{ ref: number; role: string; name: string; href?: string }>; compactText: string; title: string };
      for (const n of data.nodes) {
        if (!allow.has(n.name) && !PILOT_METRIC_RE.test(n.name.trim())) n.name = `[redacted:${hash8(n.name)}]`;
      }
      data.compactText = data.nodes
        .map((n) => `[ref=${n.ref}] ${n.role} "${n.name}"${n.href ? ` (href=${n.href})` : ''}`)
        .join('\n');
      if (!data.title.endsWith('Search | LinkedIn') && !data.title.endsWith('Profile Viewers | LinkedIn')) {
        data.title = `[redacted:${hash8(data.title)}] | LinkedIn`;
      }
      d._redaction = 'Third-party names/headlines hashed (sha256[:8]); profile slugs hashed; query strings dropped; compactText regenerated from redacted nodes.';
    }
    if (f.startsWith('20-') || f.startsWith('21-')) {
      const data = d.data as Record<string, string>;
      for (const k of ['publicIdentifier', 'fullName']) data[k] = `[member:${hash8(data[k])}]`;
      data.url = urlRewrite(data.url, true);
      d._redaction = 'Third-party profile: identifier and name hashed.';
    }
    if (f === '25-cache-profiles') {
      const rows = d.rows as Array<Record<string, string>>;
      for (const r of rows) {
        if (r.public_identifier !== 'jangtrinh') {
          for (const k of ['public_identifier', 'full_name']) r[k] = `[member:${hash8(r[k])}]`;
        }
      }
      d._redaction = 'Non-Jang rows hashed.';
    }
    if (f === '28-cache-events') {
      d._note = 'These 8 events come from the earlier logged-out throwaway-profile smoke test (Cloudflare challenge + authwall), not from the signed-in pilot.';
    }
    d = walk(d, third) as Record<string, unknown>;
    const outPath = join(outDir, `${f}.json`);
    writeFileSync(outPath, JSON.stringify(d, null, 2), 'utf8');
    written.push(outPath);
  }
  return written;
}
