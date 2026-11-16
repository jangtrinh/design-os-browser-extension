import { formatIsoWithOffset, mintUlid, sha256Hex } from '../../../../shared/hash.js';
import {
  DEFAULT_MAX_AGE_BY_CLASS,
  READER_SCHEMA_VERSION,
  REDACTION_POLICY_ID,
  SITE_PACING_POLICIES,
  type ReaderCaller,
  type ReaderEnvelope,
} from '../../../../shared/reader-schema.js';
import { registerReaderCheck } from '../reader-registry.js';
import type { ReaderRuntime } from '../reader-runtime.js';

export interface ProfileTarget {
  profile: string;
  url: string;
  visible_links?: string[];
  required_links?: string[];
}

export const DEFAULT_REQUIRED_LINKS = [
  'https://github.com/jangtrinh',
  'https://www.linkedin.com/in/jangtrinh',
];

export const DEFAULT_JANG_PROFILES: ProfileTarget[] = [
  { profile: 'linkedin', url: 'https://www.linkedin.com/in/jangtrinh' },
  { profile: 'x', url: 'https://x.com/jangtrinh' },
  { profile: 'threads', url: 'https://www.threads.net/@jangtrinh' },
  { profile: 'github', url: 'https://github.com/jangtrinh' },
  { profile: 'reddit', url: 'https://www.reddit.com/user/jangtrinh' },
  { profile: 'unikorn', url: 'https://unikorn.vn/u/jangtrinh' },
  { profile: 'youtube', url: 'https://www.youtube.com/@jangtrinh' },
  { profile: 'producthunt', url: 'https://www.producthunt.com/@jangtrinh' },
];

export const SHORTENER_HOSTS = new Set(['lnkd.in', 't.co', 'bit.ly', 'youtu.be']);

export function normalizeComparableLink(rawUrl: string): string {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  try {
    const u = new URL(rawUrl.trim());
    let host = u.hostname.toLowerCase();
    if (host.startsWith('www.')) {
      host = host.slice(4);
    }

    const searchParams = new URLSearchParams(u.search);
    const keysToDelete: string[] = [];
    for (const key of searchParams.keys()) {
      if (key.toLowerCase().startsWith('utm_')) {
        keysToDelete.push(key);
      }
    }
    for (const k of keysToDelete) {
      searchParams.delete(k);
    }
    const query = searchParams.toString();

    let pathname = u.pathname.toLowerCase();
    while (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }
    if (pathname === '/') {
      pathname = '';
    }

    const port = u.port && u.port !== '80' && u.port !== '443' ? `:${u.port}` : '';
    const protocol = u.protocol.toLowerCase();
    return `${protocol}//${host}${port}${pathname}${query ? `?${query}` : ''}`;
  } catch {
    let s = rawUrl.trim().toLowerCase().replace(/^www\./, '');
    while (s.length > 1 && s.endsWith('/')) {
      s = s.slice(0, -1);
    }
    return s;
  }
}

function isShortlink(rawUrl: string): boolean {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, '');
    return SHORTENER_HOSTS.has(host);
  } catch {
    return false;
  }
}

export interface ProfileLinkCheckResult {
  profile: string;
  url: string;
  resolved_links: string[];
  missing: string[];
  extra: string[];
  broken: string[];
}

export function registerProfileLinksCheck(): void {
  registerReaderCheck(
    'profile_links',
    async (
      runtime: ReaderRuntime,
      params: Record<string, unknown>,
      caller: ReaderCaller,
    ): Promise<ReaderEnvelope<Record<string, unknown>>> => {
      const targets: ProfileTarget[] = Array.isArray(params.profiles)
        ? (params.profiles as ProfileTarget[])
        : DEFAULT_JANG_PROFILES;

      const shortlinkMap = (params.shortlink_map ?? {}) as Record<string, string>;
      const linkStatuses = (params.link_statuses ?? {}) as Record<
        string,
        { status?: number; final_url?: string; redirected_to_auth?: boolean }
      >;
      const maxAgeS =
        typeof params.max_age_s === 'number'
          ? params.max_age_s
          : DEFAULT_MAX_AGE_BY_CLASS.profiles;

      const rawLinksByProfile = new Map<ProfileTarget, string[]>();
      let totalPageLoads = 0;

      for (const p of targets) {
        if (Array.isArray(p.visible_links)) {
          rawLinksByProfile.set(p, p.visible_links.map(String));
        } else {
          let host = '';
          try {
            host = new URL(p.url).hostname;
          } catch {
            host = '';
          }
          const readEnv = await runtime.read({
            site: 'generic',
            view: 'page.snapshot',
            target: p.url,
            params: { signed_in: true, allowed_hosts: host ? [host] : [] },
            max_age_s: maxAgeS,
            caller,
          });
          if (readEnv.source === 'live') totalPageLoads += 1;

          const raw = Array.isArray((readEnv.data as Record<string, unknown>)?.links)
            ? ((readEnv.data as Record<string, unknown>).links as unknown[])
            : [];
          const links: string[] = raw
            .map((item) => {
              if (typeof item === 'string') return item;
              if (item && typeof item === 'object') {
                const o = item as { href?: unknown; url?: unknown };
                return String(o.href ?? o.url ?? '');
              }
              return '';
            })
            .filter(Boolean);

          rawLinksByProfile.set(p, links);
        }
      }

      // Check if any shortlinks need on-demand link_status resolution
      const unresolvedShortUrls = new Set<string>();
      for (const links of rawLinksByProfile.values()) {
        for (const l of links) {
          if (isShortlink(l) && !shortlinkMap[l] && !linkStatuses[l]?.final_url) {
            unresolvedShortUrls.add(l);
          }
        }
      }

      const resolvedFromCheck: Record<string, string> = {};
      const statusFromCheck: Record<
        string,
        { status?: number | null; final_url?: string | null; redirected_to_auth?: boolean }
      > = {};

      if (unresolvedShortUrls.size > 0) {
        const checkRes = await runtime.check(
          'link_status',
          { urls: [...unresolvedShortUrls], signed_in: true },
          caller,
        );
        const data = (checkRes.data ?? {}) as {
          items?: Array<{
            url: string;
            final_url?: string | null;
            status?: number | null;
            redirected_to_auth?: boolean;
          }>;
        };
        for (const item of data.items ?? []) {
          if (item.final_url) resolvedFromCheck[item.url] = item.final_url;
          statusFromCheck[item.url] = {
            status: item.status,
            final_url: item.final_url,
            redirected_to_auth: item.redirected_to_auth,
          };
        }
      }

      const results: ProfileLinkCheckResult[] = [];
      for (const p of targets) {
        const visibleLinks = rawLinksByProfile.get(p) ?? [];
        const resolvedLinks: string[] = [];
        const broken: string[] = [];

        for (const href of visibleLinks) {
          const resolved =
            shortlinkMap[href] ??
            linkStatuses[href]?.final_url ??
            resolvedFromCheck[href] ??
            href;
          resolvedLinks.push(resolved);

          const st =
            linkStatuses[href] ??
            linkStatuses[resolved] ??
            statusFromCheck[href] ??
            statusFromCheck[resolved];

          if (st) {
            const isBroken =
              st.redirected_to_auth === true ||
              (typeof st.status === 'number' && (st.status < 200 || st.status >= 400));
            if (isBroken) {
              broken.push(href);
            }
          }
        }

        const required =
          p.required_links ??
          (Array.isArray(params.required_links)
            ? (params.required_links as string[])
            : DEFAULT_REQUIRED_LINKS);

        const normRequired = required.map((r) => ({
          raw: r,
          norm: normalizeComparableLink(r),
        }));
        const normResolved = resolvedLinks.map((r) => normalizeComparableLink(r));
        const normResolvedSet = new Set(normResolved);

        const missing: string[] = [];
        for (const req of normRequired) {
          if (!normResolvedSet.has(req.norm)) {
            missing.push(req.raw);
          }
        }

        const extra: string[] = [];
        for (let i = 0; i < resolvedLinks.length; i += 1) {
          const normRes = normResolved[i];
          if (!normRequired.some((r) => r.norm === normRes)) {
            extra.push(resolvedLinks[i]);
          }
        }

        results.push({
          profile: p.profile,
          url: p.url,
          resolved_links: resolvedLinks,
          missing,
          extra,
          broken,
        });
      }

      const missingTotal = results.reduce((acc, r) => acc + r.missing.length, 0);
      const brokenTotal = results.reduce((acc, r) => acc + r.broken.length, 0);
      const verdict = missingTotal === 0 && brokenTotal === 0 ? 'clear' : 'drift';

      const nowDate = new Date(runtime.getClockNowMs());
      const nowIso = formatIsoWithOffset(nowDate);
      const auditId = mintUlid('au', nowDate.getTime());
      const targetKey = `check:profile_links:${sha256Hex(targets.map((t) => t.url).join('\n')).slice(0, 16)}`;

      const env: ReaderEnvelope<Record<string, unknown>> = {
        ok: true,
        schema: READER_SCHEMA_VERSION,
        site: 'generic',
        view: 'check.profile_links',
        target: targets.map((t) => t.url).join(', '),
        target_key: targetKey,
        captured_at: nowIso,
        source: 'live',
        freshness: { max_age_s: maxAgeS, age_s: 0, stale: false },
        complete: true,
        missing_required: [],
        gate: 'CLEAR',
        pacing: {
          site: 'generic',
          loads_left_hour: SITE_PACING_POLICIES.generic.perHour,
          loads_left_day: SITE_PACING_POLICIES.generic.perDay,
        },
        redaction: { policy: REDACTION_POLICY_ID, fields_redacted: 0 },
        evidence_id: null,
        audit_id: auditId,
        caller,
        data: {
          verdict,
          profiles: results,
          missing_total: missingTotal,
          broken_total: brokenTotal,
        },
        notes: [],
        error_code: null,
      };

      runtime.recordAuditRow(env, nowIso, nowIso, 'check', 'n/a', totalPageLoads, 'CLEAR', 'CLEAR', null);
      return env;
    },
  );
}
