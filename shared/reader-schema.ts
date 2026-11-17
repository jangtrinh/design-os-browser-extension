/**
 * Shared Browser Layer schema (`dos.reader.v1`): multi-site read-only envelope,
 * freshness classes, pacing/guard state, and collected DOM snapshot structures.
 */

export const READER_SCHEMA_VERSION = 'dos.reader.v1' as const;
export const REDACTION_POLICY_ID = 'third-party-v1' as const;

export type ReaderSiteId =
  | 'linkedin'
  | 'x'
  | 'youtube-studio'
  | 'producthunt'
  | 'reddit'
  | 'threads'
  | 'facebook'
  | 'unikorn'
  | 'jobs'
  | 'generic';

export type ReaderGateState =
  | 'CLEAR'
  | 'BLOCKED_CHALLENGE'
  | 'BLOCKED_AUTH'
  | 'BLOCKED_PAYMENT'
  | 'BLOCKED_POLICY'
  | 'PAUSED_BY_GUARD';

export type EvidenceMode = 'off' | 'json' | 'json+screenshot';

export type ViewFreshnessClass =
  | 'metrics'
  | 'comments'
  | 'lists'
  | 'profiles'
  | 'duplicate_text'
  | 'listings'
  | 'link_status';

export const DEFAULT_MAX_AGE_BY_CLASS: Record<ViewFreshnessClass, number> = {
  metrics: 21_600,       // 6 h
  comments: 3_600,       // 1 h
  lists: 604_800,        // 7 d
  profiles: 86_400,      // 24 h
  duplicate_text: 900,   // 15 min
  listings: 86_400,      // 24 h
  link_status: 3_600,    // 1 h
};

export interface ReaderCaller {
  bot: string;
  routine: string;
}

export interface ReaderFreshness {
  max_age_s: number;
  age_s: number;
  stale: boolean;
}

export interface ReaderPacingInfo {
  site: ReaderSiteId;
  loads_left_hour: number;
  loads_left_day: number;
}

export interface ReaderRedactionInfo {
  policy: typeof REDACTION_POLICY_ID;
  fields_redacted: number;
}

export interface ReaderEnvelope<T = Record<string, unknown>> {
  ok: boolean;
  schema: typeof READER_SCHEMA_VERSION;
  site: ReaderSiteId;
  view: string;
  target: string;
  target_key: string;
  captured_at: string;
  source: 'live' | 'cache';
  freshness: ReaderFreshness;
  complete: boolean;
  missing_required: string[];
  gate: ReaderGateState;
  pacing: ReaderPacingInfo;
  redaction: ReaderRedactionInfo;
  evidence_id: string | null;
  audit_id: string;
  caller: ReaderCaller;
  data: T;
  notes: string[];
  error_code?: string | null;
  alert_line?: string;
}

export type ReaderCheckKind =
  | 'duplicate_text'
  | 'profile_links'
  | 'link_status'
  | 'subreddit_rules';

export interface CollectedAxNode {
  role: string;
  name: string;
  href?: string;
  text?: string;
}

export interface CollectedLinkItem {
  text: string;
  href: string;
}

export interface CollectedPageSnapshot {
  url: string;
  finalUrl: string;
  title: string;
  status?: number;
  axNodes: CollectedAxNode[];
  headings: string[];
  links: CollectedLinkItem[];
  meta: Record<string, string>;
  bodySample: string;
  domMarkers: string[];
  structuralAlertTexts: string[];
  loadingIndicators: string[];
  hiddenInstructions: string[];
  scrollStepsExecuted: number;
  stalled?: boolean;
  /** Visible text of the page, one entry per rendered line (innerText), capped. */
  textLines?: string[];
  /** Full visible text of open dialogs/modals (role=dialog, aria-modal), capped. */
  dialogTexts?: string[];
}

export interface SitePacingPolicy {
  site: ReaderSiteId;
  perHour: number;
  perDay: number;
  minGapMs: number;
  jitterPct: number;
  parallelTabs: number;
  perHost: boolean;
}

export const SITE_PACING_POLICIES: Record<ReaderSiteId, SitePacingPolicy> = {
  linkedin: { site: 'linkedin', perHour: 30, perDay: 150, minGapMs: 20_000, jitterPct: 0.3, parallelTabs: 1, perHost: false },
  facebook: { site: 'facebook', perHour: 30, perDay: 200, minGapMs: 20_000, jitterPct: 0, parallelTabs: 1, perHost: false },
  x: { site: 'x', perHour: 40, perDay: 300, minGapMs: 10_000, jitterPct: 0, parallelTabs: 1, perHost: false },
  threads: { site: 'threads', perHour: 40, perDay: 300, minGapMs: 10_000, jitterPct: 0, parallelTabs: 1, perHost: false },
  reddit: { site: 'reddit', perHour: 40, perDay: 300, minGapMs: 10_000, jitterPct: 0, parallelTabs: 1, perHost: false },
  'youtube-studio': { site: 'youtube-studio', perHour: 20, perDay: 100, minGapMs: 10_000, jitterPct: 0, parallelTabs: 1, perHost: false },
  producthunt: { site: 'producthunt', perHour: 20, perDay: 100, minGapMs: 10_000, jitterPct: 0, parallelTabs: 1, perHost: false },
  unikorn: { site: 'unikorn', perHour: 20, perDay: 100, minGapMs: 10_000, jitterPct: 0, parallelTabs: 1, perHost: false },
  jobs: { site: 'jobs', perHour: 20, perDay: 100, minGapMs: 15_000, jitterPct: 0, parallelTabs: 1, perHost: true },
  generic: { site: 'generic', perHour: 30, perDay: 300, minGapMs: 5_000, jitterPct: 0, parallelTabs: 2, perHost: true },
};

export interface AccountGuardRecord {
  site: ReaderSiteId;
  state: 'CLEAR' | 'PAUSED';
  reason: string | null;
  since: string | null;
  evidence_id: string | null;
  alert_emitted: boolean;
  alert_line: string | null;
}

export interface ReaderViewDescriptor {
  site: ReaderSiteId;
  view: string;
  description: string;
  requiredFields: string[];
  freshnessClass: ViewFreshnessClass;
  defaultMaxAgeS: number;
  allowedHosts: string[];
  supportsScroll?: boolean;
}
