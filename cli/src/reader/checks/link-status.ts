import { formatIsoWithOffset, mintUlid, sha256Hex } from '../../../../shared/hash.js';
import {
  DEFAULT_MAX_AGE_BY_CLASS,
  READER_SCHEMA_VERSION,
  REDACTION_POLICY_ID,
  SITE_PACING_POLICIES,
  type EvidenceMode,
  type ReaderCaller,
  type ReaderEnvelope,
} from '../../../../shared/reader-schema.js';
import { registerReaderCheck } from '../reader-registry.js';
import type { ReaderRuntime } from '../reader-runtime.js';
import { validateReaderTargetUrl } from '../url-safety.js';

export const JEV_READ_DENIED_HOSTS = [
  'facebook.com',
  'www.facebook.com',
  'm.facebook.com',
  'youtube.com',
  'www.youtube.com',
  'studio.youtube.com',
];

export const JANG_OWNED_SLUGS = [
  'jangtrinh',
  'jangtrinhvn',
  'uxdesignvn',
  'designosbyjang',
  'design-os',
];

export const AUTH_REDIRECT_RE =
  /\/(login|authwall|uas\/login|i\/flow\/login|account\/access|checkpoint|challenge)(\/|\?|$)/i;

const NOT_FOUND_TITLE_RE = /^(404\b|page not found|not found\b)|\b(404 not found|page (?:could not be|not) found|this page (?:isn't|is not) available)\b/i;

export interface LinkStatusItem {
  url: string;
  /** true = verified reachable, false = verified broken/blocked, null = not checked. */
  ok: boolean | null;
  /** false when nothing was loaded for this URL (no data is never "ok"). */
  checked: boolean;
  status: number | null;
  final_url: string | null;
  title: string | null;
  redirected_to_auth: boolean;
  route: 'blocked' | 'jev-read' | 'extension';
  blocked_policy?: boolean;
  skipped_extension?: boolean;
  reason?: string;
  evidence_id?: string | null;
}

export function registerLinkStatusCheck(): void {
  registerReaderCheck(
    'link_status',
    async (
      runtime: ReaderRuntime,
      params: Record<string, unknown>,
      caller: ReaderCaller,
    ): Promise<ReaderEnvelope<Record<string, unknown>>> => {
      const rawUrls = Array.isArray(params.urls) ? params.urls.map(String) : [];
      const signedIn = params.signed_in === true;
      const injectedStatuses = (params.statuses ?? {}) as Record<
        string,
        { status?: number; final_url?: string; title?: string }
      >;
      const evidenceMode = (typeof params.evidence === 'string' ? params.evidence : 'off') as EvidenceMode;
      const maxAgeS =
        typeof params.max_age_s === 'number'
          ? params.max_age_s
          : DEFAULT_MAX_AGE_BY_CLASS.link_status;

      const items: LinkStatusItem[] = [];
      let totalPageLoads = 0;

      for (const url of rawUrls) {
        const urlValidation = validateReaderTargetUrl({
          site: 'generic',
          targetUrl: url,
          allowFixtureLoopback: false,
        });

        if (!urlValidation.ok) {
          items.push({
            url,
            ok: false,
            checked: true,
            blocked_policy: true,
            status: null,
            final_url: null,
            title: null,
            redirected_to_auth: false,
            route: 'blocked',
            reason: urlValidation.message,
          });
          continue;
        }

        let parsedUrl: URL;
        try {
          parsedUrl = new URL(url);
        } catch {
          items.push({
            url,
            ok: false,
            checked: true,
            blocked_policy: true,
            status: null,
            final_url: null,
            title: null,
            redirected_to_auth: false,
            route: 'blocked',
          });
          continue;
        }

        const host = parsedUrl.hostname.toLowerCase();
        const pathname = parsedUrl.pathname.toLowerCase();
        const isDeniedHost = JEV_READ_DENIED_HOSTS.includes(host);

        let effectiveSignedIn = signedIn;
        if (isDeniedHost) {
          const isOwnedSlug = JANG_OWNED_SLUGS.some((slug) => pathname.includes(slug.toLowerCase()));
          const isStudio = host === 'studio.youtube.com';
          const isAllowlistedOwned = isOwnedSlug || isStudio;

          if (!isAllowlistedOwned) {
            items.push({
              url,
              ok: false,
              checked: true,
              blocked_policy: true,
              reason: 'Non-allowlisted Facebook/YouTube page refused by policy.',
              status: null,
              final_url: url,
              title: null,
              redirected_to_auth: false,
              route: 'blocked',
            });
            continue;
          }

          effectiveSignedIn = true;
        }

        const injected = injectedStatuses[url];
        if (!effectiveSignedIn && !injected) {
          // Public link: this check does not load it. Hand it to jev-read and say so;
          // never report an unloaded URL as ok (2026-11-17 finding #6).
          items.push({
            url,
            ok: null,
            checked: false,
            skipped_extension: true,
            route: 'jev-read',
            status: null,
            final_url: null,
            title: null,
            redirected_to_auth: false,
            reason: 'Not loaded: public URL routed to jev-read. Pass signed_in:true to load it in the extension.',
          });
          continue;
        }

        if (injected) {
          const finalUrl = injected.final_url ?? url;
          const status = typeof injected.status === 'number' ? injected.status : 200;
          const title = injected.title ?? null;
          const redirectedToAuth = AUTH_REDIRECT_RE.test(finalUrl);
          const ok = !redirectedToAuth && status >= 200 && status < 400;

          items.push({
            url,
            ok,
            checked: true,
            status,
            final_url: finalUrl,
            title,
            redirected_to_auth: redirectedToAuth,
            route: 'extension',
          });
          continue;
        }

        // Live read via extension with signed-in session
        const readEnv = await runtime.read({
          site: 'generic',
          view: 'page.snapshot',
          target: url,
          params: { signed_in: true, allowed_hosts: [parsedUrl.hostname] },
          evidence: evidenceMode,
          caller,
        });

        totalPageLoads += 1;
        const d = (readEnv.data ?? {}) as Record<string, unknown>;
        const finalUrl =
          typeof d.final_url === 'string'
            ? d.final_url
            : typeof d.url === 'string'
              ? d.url
              : url;
        // Status is only what was observed; never assume 200.
        const status = typeof d.status === 'number' ? d.status : null;
        const title = typeof d.title === 'string' ? d.title : null;
        const redirectedToAuth =
          AUTH_REDIRECT_RE.test(finalUrl) || readEnv.gate === 'BLOCKED_AUTH' || d.detected_gate === 'BLOCKED_AUTH';
        const notFoundTitle = title !== null && NOT_FOUND_TITLE_RE.test(title);
        let ok: boolean | null;
        let checked = true;
        let reason: string | undefined;
        if (redirectedToAuth) {
          ok = false;
          reason = 'Redirected to a sign-in page.';
        } else if (!readEnv.ok || readEnv.gate !== 'CLEAR') {
          ok = null;
          checked = false;
          reason = `Page could not be read (${readEnv.error_code ?? readEnv.gate}).`;
        } else if ((status !== null && (status < 200 || status >= 400)) || notFoundTitle) {
          ok = false;
          reason = notFoundTitle ? `Page title says not found: "${title}".` : undefined;
        } else if (!readEnv.complete) {
          ok = null;
          checked = false;
          reason = 'Page read was incomplete.';
        } else {
          ok = true;
        }

        items.push({
          url,
          ok,
          checked,
          status,
          final_url: finalUrl,
          title,
          redirected_to_auth: redirectedToAuth,
          route: 'extension',
          evidence_id: readEnv.evidence_id,
          ...(reason ? { reason } : {}),
        });
      }

      const nowDate = new Date(runtime.getClockNowMs());
      const nowIso = formatIsoWithOffset(nowDate);
      const auditId = mintUlid('au', nowDate.getTime());
      const uncheckedCount = items.filter((i) => !i.checked).length;
      const failedCount = items.filter((i) => i.ok === false).length;
      // No URLs, or any URL left unchecked, is never "clear".
      const verdict = failedCount > 0 ? 'warn' : uncheckedCount > 0 || items.length === 0 ? 'unknown' : 'clear';
      const complete = items.length > 0 && uncheckedCount === 0;
      const targetKey = `check:link_status:${sha256Hex(rawUrls.join('\n')).slice(0, 16)}`;

      const env: ReaderEnvelope<Record<string, unknown>> = {
        ok: true,
        schema: READER_SCHEMA_VERSION,
        site: 'generic',
        view: 'check.link_status',
        target: rawUrls.join(', '),
        target_key: targetKey,
        captured_at: nowIso,
        source: 'live',
        freshness: { max_age_s: maxAgeS, age_s: 0, stale: false },
        complete,
        missing_required: complete ? [] : ['items'],
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
          items,
          statuses: Object.fromEntries(items.map((i) => [i.url, i])),
          total: items.length,
          ok_count: items.filter((i) => i.ok === true).length,
          failed_count: failedCount,
          unchecked_count: uncheckedCount,
        },
        notes: uncheckedCount > 0 ? [`${uncheckedCount} URL(s) were not checked; verdict is unknown, not clear.`] : [],
        error_code: complete ? null : 'UNCHECKED_LINKS',
      };

      runtime.recordAuditRow(env, nowIso, nowIso, 'check', 'n/a', totalPageLoads, 'CLEAR', 'CLEAR', null);
      return env;
    },
  );
}
