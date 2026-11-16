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

export interface SubredditRulesSummary {
  subreddit?: string;
  no_links?: boolean;
  no_self_promo?: boolean;
  flair_required?: boolean;
  flairs?: string[];
  min_karma?: number;
  min_account_age_days?: number;
  raw_rules?: string[];
}

export interface SubredditRuleWarning {
  rule: 'NO_LINKS' | 'NO_SELF_PROMO' | 'FLAIR_REQUIRED' | 'UNKNOWN_FLAIR' | 'MIN_KARMA' | 'MIN_ACCOUNT_AGE';
  message: string;
}

const URL_RE = /(https?:\/\/|www\.)[^\s]+/i;
const SELF_PROMO_RE =
  /\b(check out (?:my|our)|we just launched|i built (?:a|an|this)|sign up (?:at|for|now)|try (?:my|our) (?:product|app|tool)|free beta|use code|join the waitlist|pricing starts at)\b/i;

export function evaluateSubredditDraft(
  rules: SubredditRulesSummary,
  input: {
    draft_title?: string;
    draft_text: string;
    flair?: string;
    author_karma?: number;
    account_age_days?: number;
  },
): {
  verdict: 'clear' | 'warn';
  allowed: boolean;
  warnings: SubredditRuleWarning[];
} {
  const warnings: SubredditRuleWarning[] = [];
  const combinedText = `${input.draft_title ? input.draft_title + ' ' : ''}${input.draft_text ?? ''}`;

  if (rules.no_links && URL_RE.test(combinedText)) {
    warnings.push({
      rule: 'NO_LINKS',
      message: 'Draft contains links, but subreddit rules forbid links in posts.',
    });
  }

  if (rules.no_self_promo && SELF_PROMO_RE.test(combinedText)) {
    warnings.push({
      rule: 'NO_SELF_PROMO',
      message: 'Draft contains promotional pitch phrasing, which is disallowed by subreddit rules.',
    });
  }

  if (rules.flair_required && (!input.flair || !input.flair.trim())) {
    warnings.push({
      rule: 'FLAIR_REQUIRED',
      message: 'Subreddit requires a post flair, but none was provided.',
    });
  }

  if (input.flair && Array.isArray(rules.flairs) && rules.flairs.length > 0) {
    const normFlair = input.flair.trim().toLowerCase();
    const matched = rules.flairs.some((f) => f.trim().toLowerCase() === normFlair);
    if (!matched) {
      warnings.push({
        rule: 'UNKNOWN_FLAIR',
        message: `Flair "${input.flair}" does not match allowed flairs: ${rules.flairs.join(', ')}.`,
      });
    }
  }

  if (typeof rules.min_karma === 'number' && typeof input.author_karma === 'number') {
    if (input.author_karma < rules.min_karma) {
      warnings.push({
        rule: 'MIN_KARMA',
        message: `Author karma (${input.author_karma}) is below required minimum (${rules.min_karma}).`,
      });
    }
  }

  if (typeof rules.min_account_age_days === 'number' && typeof input.account_age_days === 'number') {
    if (input.account_age_days < rules.min_account_age_days) {
      warnings.push({
        rule: 'MIN_ACCOUNT_AGE',
        message: `Author account age (${input.account_age_days} days) is below required minimum (${rules.min_account_age_days} days).`,
      });
    }
  }

  return {
    verdict: warnings.length === 0 ? 'clear' : 'warn',
    allowed: warnings.length === 0,
    warnings,
  };
}

export function registerSubredditRulesCheck(): void {
  registerReaderCheck(
    'subreddit_rules',
    async (
      runtime: ReaderRuntime,
      params: Record<string, unknown>,
      caller: ReaderCaller,
    ): Promise<ReaderEnvelope<Record<string, unknown>>> => {
      const subreddit = String(params.subreddit ?? '').replace(/^r\//, '').trim();
      const draftTitle = typeof params.draft_title === 'string' ? params.draft_title : undefined;
      const draftText = String(params.draft_text ?? '');
      const flair = typeof params.flair === 'string' ? params.flair : undefined;
      const authorKarma = typeof params.author_karma === 'number' ? params.author_karma : undefined;
      const accountAgeDays =
        typeof params.account_age_days === 'number' ? params.account_age_days : undefined;
      const maxAgeS =
        typeof params.max_age_s === 'number'
          ? params.max_age_s
          : DEFAULT_MAX_AGE_BY_CLASS.comments;

      let rulesSummary: SubredditRulesSummary = {
        subreddit,
        no_links: false,
        no_self_promo: false,
        flair_required: false,
        flairs: [],
        raw_rules: [],
      };

      const notes: string[] = [];
      let pageLoads = 0;

      if (params.rules_override && typeof params.rules_override === 'object') {
        rulesSummary = {
          ...rulesSummary,
          ...(params.rules_override as Partial<SubredditRulesSummary>),
          subreddit: (params.rules_override as Partial<SubredditRulesSummary>).subreddit ?? subreddit,
        };
      } else {
        const rulesUrl =
          typeof params.rules_url === 'string' && params.rules_url.trim()
            ? params.rules_url.trim()
            : `https://www.reddit.com/r/${subreddit}/about/rules/`;

        const readEnv = await runtime.read({
          site: 'reddit',
          view: 'subreddit.rules',
          target: rulesUrl,
          params: { subreddit },
          max_age_s: maxAgeS,
          caller,
        });

        if (readEnv.ok && readEnv.data) {
          const d = readEnv.data as Record<string, unknown>;
          const fromData = (d.rules_summary ?? d) as Record<string, unknown>;
          rulesSummary = {
            subreddit: typeof fromData.subreddit === 'string' ? fromData.subreddit : subreddit,
            no_links: Boolean(fromData.no_links),
            no_self_promo: Boolean(fromData.no_self_promo),
            flair_required: Boolean(fromData.flair_required),
            flairs: Array.isArray(fromData.flairs) ? fromData.flairs.map(String) : [],
            min_karma: typeof fromData.min_karma === 'number' ? fromData.min_karma : undefined,
            min_account_age_days:
              typeof fromData.min_account_age_days === 'number'
                ? fromData.min_account_age_days
                : undefined,
            raw_rules: Array.isArray(fromData.raw_rules)
              ? fromData.raw_rules.map((r) =>
                  typeof r === 'string'
                    ? r
                    : `${(r as { index?: unknown }).index ?? ''}. ${(r as { title?: unknown }).title ?? ''} ${(r as { detail?: unknown }).detail ?? ''}`.trim(),
                )
              : Array.isArray(fromData.rules)
                ? fromData.rules.map((r) =>
                    typeof r === 'string'
                      ? r
                      : `${(r as { index?: unknown }).index ?? ''}. ${(r as { title?: unknown }).title ?? ''} ${(r as { detail?: unknown }).detail ?? ''}`.trim(),
                  )
                : [],
          };
          if (readEnv.source === 'live') pageLoads += 1;
        } else {
          notes.push(`Unable to read live subreddit rules (${readEnv.error_code ?? 'ERROR'}).`);
        }

        if (typeof params.wiki_url === 'string' && params.wiki_url.trim()) {
          const wikiEnv = await runtime.read({
            site: 'reddit',
            view: 'subreddit.rules',
            target: params.wiki_url.trim(),
            params: { subreddit, is_wiki: true },
            max_age_s: maxAgeS,
            caller,
          });
          if (wikiEnv.ok && wikiEnv.data) {
            const wd = wikiEnv.data as Record<string, unknown>;
            if (Array.isArray(wd.raw_rules) || Array.isArray(wd.rules)) {
              const incoming = (wd.raw_rules ?? wd.rules) as unknown[];
              rulesSummary.raw_rules = [
                ...(rulesSummary.raw_rules ?? []),
                ...incoming.map((r) =>
                  typeof r === 'string'
                    ? r
                    : `${(r as { index?: unknown }).index ?? ''}. ${(r as { title?: unknown }).title ?? ''} ${(r as { detail?: unknown }).detail ?? ''}`.trim(),
                ),
              ];
            }
            if (wd.no_links) rulesSummary.no_links = true;
            if (wd.no_self_promo) rulesSummary.no_self_promo = true;
            if (wd.flair_required) rulesSummary.flair_required = true;
            if (Array.isArray(wd.flairs)) {
              const merged = new Set([...(rulesSummary.flairs ?? []), ...wd.flairs.map(String)]);
              rulesSummary.flairs = Array.from(merged);
            }
            if (typeof wd.min_karma === 'number') {
              rulesSummary.min_karma = Math.max(rulesSummary.min_karma ?? 0, wd.min_karma);
            }
            if (typeof wd.min_account_age_days === 'number') {
              rulesSummary.min_account_age_days = Math.max(rulesSummary.min_account_age_days ?? 0, wd.min_account_age_days);
            }
            if (wikiEnv.source === 'live') pageLoads += 1;
          }
        }
      }

      const evalRes = evaluateSubredditDraft(rulesSummary, {
        draft_title: draftTitle,
        draft_text: draftText,
        flair,
        author_karma: authorKarma,
        account_age_days: accountAgeDays,
      });

      const nowDate = new Date(runtime.getClockNowMs());
      const nowIso = formatIsoWithOffset(nowDate);
      const auditId = mintUlid('au', nowDate.getTime());
      const targetKey = `check:subreddit_rules:${subreddit}:${sha256Hex(draftText).slice(0, 16)}`;

      const env: ReaderEnvelope<Record<string, unknown>> = {
        ok: true,
        schema: READER_SCHEMA_VERSION,
        site: 'reddit',
        view: 'check.subreddit_rules',
        target: `https://www.reddit.com/r/${subreddit}/about/rules/`,
        target_key: targetKey,
        captured_at: nowIso,
        source: 'live',
        freshness: { max_age_s: maxAgeS, age_s: 0, stale: false },
        complete: true,
        missing_required: [],
        gate: 'CLEAR',
        pacing: {
          site: 'reddit',
          loads_left_hour: SITE_PACING_POLICIES.reddit.perHour,
          loads_left_day: SITE_PACING_POLICIES.reddit.perDay,
        },
        redaction: { policy: REDACTION_POLICY_ID, fields_redacted: 0 },
        evidence_id: null,
        audit_id: auditId,
        caller,
        data: {
          verdict: evalRes.verdict,
          allowed: evalRes.allowed,
          subreddit,
          warnings: evalRes.warnings,
          rules_summary: rulesSummary,
        },
        notes,
        error_code: null,
      };

      runtime.recordAuditRow(env, nowIso, nowIso, 'check', 'n/a', pageLoads, 'CLEAR', 'CLEAR', null);
      return env;
    },
  );
}
