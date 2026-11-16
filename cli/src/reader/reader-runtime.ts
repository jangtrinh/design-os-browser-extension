import { formatIsoWithOffset, mintUlid } from '../../../shared/hash.js';
import {
  READER_SCHEMA_VERSION,
  REDACTION_POLICY_ID,
  SITE_PACING_POLICIES,
  type CollectedPageSnapshot,
  type EvidenceMode,
  type ReaderCaller,
  type ReaderCheckKind,
  type ReaderEnvelope,
  type ReaderGateState,
  type ReaderSiteId,
} from '../../../shared/reader-schema.js';
import type { LinkedInSqliteCache } from '../db/sqlite-cache.js';
import { AccountGuardManager } from './account-guard.js';
import { ReaderAuditLog, type StoredAuditRow } from './audit-log.js';
import { getEvidenceById, recordEvidenceBundle } from './evidence-recorder.js';
import { PacingBudgetManager, type PacingClock } from './pacing-budget.js';
import { deriveTargetKey, getReaderView, listReaderViews } from './reader-registry.js';
import { SharedReaderStore } from './reader-store.js';
import { detectHiddenPromptInstructions, redactReaderPayload } from './redaction.js';
import { validateReaderTargetUrl } from './url-safety.js';

export type ExtensionCollectFn = (req: {
  site: ReaderSiteId;
  view: string;
  targetUrl: string;
  params: Record<string, unknown>;
  captureScreenshot: boolean;
}) => Promise<{
  ok: boolean;
  snapshot?: CollectedPageSnapshot;
  screenshotBase64?: string;
  gate?: ReaderGateState;
  gateReason?: string;
  error_code?: string;
  message?: string;
}>;

export type ReaderCheckHandler = (
  runtime: ReaderRuntime,
  params: Record<string, unknown>,
  caller: ReaderCaller,
) => Promise<ReaderEnvelope<Record<string, unknown>>>;

const CHECK_HANDLERS = new Map<ReaderCheckKind, ReaderCheckHandler>();

export function registerReaderCheck(kind: ReaderCheckKind, handler: ReaderCheckHandler): void {
  CHECK_HANDLERS.set(kind, handler);
}

export interface ReaderReadInput {
  site: ReaderSiteId;
  view: string;
  target?: string;
  params?: Record<string, unknown>;
  max_age_s?: number;
  evidence?: EvidenceMode;
  caller?: ReaderCaller;
}

export class ReaderRuntime {
  readonly store: SharedReaderStore;
  readonly audit: ReaderAuditLog;
  readonly pacing: PacingBudgetManager;
  readonly guard: AccountGuardManager;
  private readonly cache: LinkedInSqliteCache;
  private readonly allowFixtureLoopback: boolean;
  private readonly configuredAllowedHosts: string[];
  private readonly clock: PacingClock;
  private collectPage: ExtensionCollectFn;
  private readonly inFlight = new Map<string, Promise<ReaderEnvelope<Record<string, unknown>>>>();

  constructor(options: {
    cache: LinkedInSqliteCache;
    collectPage: ExtensionCollectFn;
    clock?: PacingClock;
    mirrorAuditToFile?: boolean;
    allowFixtureLoopback?: boolean;
    configuredAllowedHosts?: string[];
    onGuardChange?: (guards: ReturnType<AccountGuardManager['listGuards']>) => void;
  }) {
    this.cache = options.cache;
    this.collectPage = options.collectPage;
    this.clock = options.clock ?? {
      now: () => Date.now(),
      sleep: (ms: number) => new Promise((r) => setTimeout(r, ms)),
      jitter: () => Math.random() * 2 - 1,
    };
    this.allowFixtureLoopback = Boolean(options.allowFixtureLoopback);
    this.configuredAllowedHosts = options.configuredAllowedHosts ?? [];

    const db = options.cache.getDatabase();
    this.store = new SharedReaderStore(db);
    this.audit = new ReaderAuditLog(db, options.mirrorAuditToFile ?? true);
    this.pacing = new PacingBudgetManager(db, this.clock);
    this.guard = new AccountGuardManager(db, this.audit, options.onGuardChange);
  }

  setCollector(fn: ExtensionCollectFn): void {
    this.collectPage = fn;
  }

  listViews(site?: ReaderSiteId) {
    return listReaderViews(site);
  }

  queryCache(input: { sql?: string; site?: string; view?: string; target_key?: string; since?: string; limit?: number }) {
    if (typeof input.sql === 'string' && input.sql.trim()) {
      const rows = this.cache.queryReadOnlySql(input.sql);
      return { ok: true, count: rows.length, rows };
    }
    const rows = this.store.queryByFilter(input);
    return { ok: true, count: rows.length, rows };
  }

  pacingStatus(site?: ReaderSiteId) {
    return site ? this.pacing.getStatus(site) : this.pacing.listAllStatuses();
  }

  guardStatus(site?: ReaderSiteId) {
    return site ? this.guard.getGuard(site) : this.guard.listGuards();
  }

  getEvidence(evidenceId: string) {
    return getEvidenceById(evidenceId);
  }

  queryAudit(filters: { since?: string; site?: string; caller?: string; limit?: number } = {}): {
    ok: boolean;
    count: number;
    rows: StoredAuditRow[];
  } {
    const rows = this.audit.query(filters);
    return { ok: true, count: rows.length, rows };
  }

  async check(
    checkKind: ReaderCheckKind,
    params: Record<string, unknown>,
    caller: ReaderCaller = { bot: 'cli', routine: 'manual' },
  ): Promise<ReaderEnvelope<Record<string, unknown>>> {
    const handler = CHECK_HANDLERS.get(checkKind);
    if (!handler) {
      const now = new Date(this.clock.now());
      const iso = formatIsoWithOffset(now);
      const auditId = mintUlid('au', now.getTime());
      const env: ReaderEnvelope<Record<string, unknown>> = {
        ok: false,
        schema: READER_SCHEMA_VERSION,
        site: 'generic',
        view: `check.${checkKind}`,
        target: '',
        target_key: `check:${checkKind}`,
        captured_at: iso,
        source: 'cache',
        freshness: { max_age_s: 0, age_s: 0, stale: false },
        complete: false,
        missing_required: [],
        gate: 'BLOCKED_POLICY',
        pacing: { site: 'generic', loads_left_hour: SITE_PACING_POLICIES.generic.perHour, loads_left_day: SITE_PACING_POLICIES.generic.perDay },
        redaction: { policy: REDACTION_POLICY_ID, fields_redacted: 0 },
        evidence_id: null,
        audit_id: auditId,
        caller,
        data: { error: `Unknown reader_check: ${checkKind}` },
        notes: [],
        error_code: 'UNKNOWN_CHECK',
      };
      this.recordAuditRow(env, iso, iso, 'check', 'n/a', 0, 'CLEAR', 'BLOCKED_POLICY', null);
      return env;
    }
    return await handler(this, params, caller);
  }

  async read(input: ReaderReadInput): Promise<ReaderEnvelope<Record<string, unknown>>> {
    const handler = getReaderView(input.site, input.view);
    const params = input.params ?? {};
    const caller = input.caller ?? { bot: 'cli', routine: 'ad-hoc' };
    const evidenceMode: EvidenceMode = input.evidence ?? 'json';

    if (!handler) {
      return this.failEnvelope(input.site, input.view, input.target ?? '', `unknown:${input.site}:${input.view}`, caller, 'BLOCKED_POLICY', 'UNKNOWN_VIEW', `Unknown view ${input.site}:${input.view}`);
    }

    const target = input.target?.trim() || handler.resolveTargetUrl(params) || '';
    const targetKey = deriveTargetKey(input.site, input.view, target, params);
    const urlCheck = validateReaderTargetUrl({
      site: input.site,
      targetUrl: target,
      allowFixtureLoopback: this.allowFixtureLoopback,
      configuredAllowedHosts: [...handler.descriptor.allowedHosts, ...this.configuredAllowedHosts],
    });
    if (!urlCheck.ok) {
      return this.failEnvelope(input.site, input.view, target, targetKey, caller, 'BLOCKED_POLICY', urlCheck.code ?? 'BLOCKED_POLICY', urlCheck.message ?? 'URL rejected');
    }

    const maxAgeS = input.max_age_s !== undefined ? input.max_age_s : handler.descriptor.defaultMaxAgeS;
    const nowMs = this.clock.now();
    const cachedRow = this.store.getLatest(input.site, input.view, targetKey);
    const cachedAgeS = cachedRow ? Math.max(0, Math.floor((nowMs - cachedRow.captured_ms) / 1000)) : 0;

    // Rule 8.1: Paused account guard overrides everything — 0 live loads on paused site.
    const guardState = this.guard.getGuard(input.site);
    if (guardState.state === 'PAUSED') {
      return this.serveGuardPaused(input.site, input.view, target, targetKey, maxAgeS, cachedRow, cachedAgeS, caller, guardState.reason ?? 'Account guard paused.');
    }

    // Fresh cache hit (or caller explicitly accepts any cached entry via max_age_s: -1).
    if (cachedRow && (maxAgeS < 0 || cachedAgeS < maxAgeS)) {
      const stale = maxAgeS >= 0 ? cachedAgeS >= maxAgeS : cachedAgeS >= handler.descriptor.defaultMaxAgeS;
      return this.serveCachedHit(input.site, input.view, target, targetKey, cachedRow, maxAgeS, cachedAgeS, stale, maxAgeS < 0 ? 'stale-allowed' : 'hit', caller);
    }

    if (maxAgeS < 0 && !cachedRow) {
      return this.failEnvelope(input.site, input.view, target, targetKey, caller, 'CLEAR', 'CACHE_MISS_NO_LIVE', 'max_age_s < 0 requested cache-only read, but no complete cached entry exists.');
    }

    // Single-flight coalescing: concurrent live reads for same site+view+target_key share 1 page load.
    const inflightKey = `${input.site}:${input.view}:${targetKey}`;
    const existingFlight = this.inFlight.get(inflightKey);
    if (existingFlight) {
      await existingFlight;
      const populated = this.store.getLatest(input.site, input.view, targetKey);
      if (populated) {
        const ageS = Math.max(0, Math.floor((this.clock.now() - populated.captured_ms) / 1000));
        return this.serveCachedHit(input.site, input.view, target, targetKey, populated, maxAgeS, ageS, false, 'hit', caller);
      }
    }

    const runPromise = this.executeLiveRead({
      site: input.site,
      view: input.view,
      target,
      targetKey,
      params,
      maxAgeS,
      evidenceMode,
      caller,
    });
    this.inFlight.set(inflightKey, runPromise);
    try {
      return await runPromise;
    } finally {
      this.inFlight.delete(inflightKey);
    }
  }

  private async executeLiveRead(ctx: {
    site: ReaderSiteId;
    view: string;
    target: string;
    targetKey: string;
    params: Record<string, unknown>;
    maxAgeS: number;
    evidenceMode: EvidenceMode;
    caller: ReaderCaller;
  }): Promise<ReaderEnvelope<Record<string, unknown>>> {
    const handler = getReaderView(ctx.site, ctx.view)!;
    const startedAt = formatIsoWithOffset(new Date(this.clock.now()));
    const auditId = mintUlid('au', this.clock.now());
    const attemptId = mintUlid('at', this.clock.now());

    const budget = await this.pacing.acquireLoad(ctx.site, ctx.target, 1);
    if (!budget.ok) {
      const endedAt = formatIsoWithOffset(new Date(this.clock.now()));
      const env: ReaderEnvelope<Record<string, unknown>> = {
        ok: false,
        schema: READER_SCHEMA_VERSION,
        site: ctx.site,
        view: ctx.view,
        target: ctx.target,
        target_key: ctx.targetKey,
        captured_at: endedAt,
        source: 'cache',
        freshness: { max_age_s: ctx.maxAgeS, age_s: 0, stale: true },
        complete: false,
        missing_required: [],
        gate: 'CLEAR',
        pacing: budget.pacing,
        redaction: { policy: REDACTION_POLICY_ID, fields_redacted: 0 },
        evidence_id: null,
        audit_id: auditId,
        caller: ctx.caller,
        data: { error: budget.reason },
        notes: [budget.reason ?? 'Pacing budget exhausted'],
        error_code: budget.error_code ?? 'PACING_EXHAUSTED',
      };
      this.recordAuditRow(env, startedAt, endedAt, 'read', 'miss', 0, 'CLEAR', 'CLEAR', null, attemptId);
      return env;
    }

    let collected = await this.collectPage({
      site: ctx.site,
      view: ctx.view,
      targetUrl: ctx.target,
      params: ctx.params,
      captureScreenshot: ctx.evidenceMode === 'json+screenshot',
    });
    let totalPageLoads = 1;

    // Stall recovery: unsettled / loading spinner -> wait 2x min gap, retry once. Never retry on blocked gate!
    if (collected.ok && collected.snapshot?.stalled && (!collected.gate || collected.gate === 'CLEAR')) {
      const firstStall = this.pacing.recordStall(ctx.site, ctx.target);
      if (firstStall.paused30m) {
        if (firstStall.triggerGuard) {
          const paused = this.guard.triggerPause({
            site: ctx.site,
            view: ctx.view,
            target: ctx.target,
            targetKey: ctx.targetKey,
            reason: '3 stall pauses within one day',
            caller: ctx.caller,
            auditId,
            loadsLeftHour: budget.pacing.loads_left_hour,
            loadsLeftDay: budget.pacing.loads_left_day,
            screenshotBase64: collected.screenshotBase64,
          });
          return this.failEnvelopeWithGuard(ctx, startedAt, auditId, attemptId, totalPageLoads, paused.guard.reason ?? 'STALLED', paused.evidenceId, paused.alertLineOnce);
        }
        return this.failEnvelopeWithAudit(ctx, startedAt, auditId, attemptId, totalPageLoads, 'CLEAR', 'STALLED', '3 consecutive stalls; site paused for 30 minutes.');
      }

      const canRetry = this.pacing.canAfford(ctx.site, ctx.target, 1);
      if (canRetry.ok) {
        await this.pacing.waitStallRetryGap(ctx.site, ctx.target);
        const retryBudget = await this.pacing.acquireLoad(ctx.site, ctx.target, 1);
        if (retryBudget.ok) {
          totalPageLoads += 1;
          collected = await this.collectPage({
            site: ctx.site,
            view: ctx.view,
            targetUrl: ctx.target,
            params: ctx.params,
            captureScreenshot: ctx.evidenceMode === 'json+screenshot',
          });
        }
      }
      if (collected.ok && collected.snapshot?.stalled) {
        const secondStall = this.pacing.recordStall(ctx.site, ctx.target);
        if (secondStall.triggerGuard) {
          const paused = this.guard.triggerPause({
            site: ctx.site,
            view: ctx.view,
            target: ctx.target,
            targetKey: ctx.targetKey,
            reason: '3 stall pauses within one day',
            caller: ctx.caller,
            auditId,
            loadsLeftHour: budget.pacing.loads_left_hour,
            loadsLeftDay: budget.pacing.loads_left_day,
            screenshotBase64: collected.screenshotBase64,
          });
          return this.failEnvelopeWithGuard(ctx, startedAt, auditId, attemptId, totalPageLoads, paused.guard.reason ?? 'STALLED', paused.evidenceId, paused.alertLineOnce);
        }
      }
    }

    // Account Guard check: challenge, authwall, 429, 451, or warning marker (PAYMENT does NOT pause site!).
    const gate: ReaderGateState = collected.gate ?? 'CLEAR';
    if (gate === 'BLOCKED_CHALLENGE' || gate === 'BLOCKED_AUTH') {
      const reason = collected.gateReason ?? `Gate ${gate} detected on ${ctx.site}`;
      const paused = this.guard.triggerPause({
        site: ctx.site,
        view: ctx.view,
        target: ctx.target,
        targetKey: ctx.targetKey,
        reason,
        caller: ctx.caller,
        auditId,
        loadsLeftHour: budget.pacing.loads_left_hour,
        loadsLeftDay: budget.pacing.loads_left_day,
        screenshotBase64: collected.screenshotBase64,
      });
      return this.failEnvelopeWithGuard(ctx, startedAt, auditId, attemptId, totalPageLoads, reason, paused.evidenceId, paused.alertLineOnce, gate);
    }

    if (!collected.ok || !collected.snapshot) {
      return this.failEnvelopeWithAudit(ctx, startedAt, auditId, attemptId, totalPageLoads, gate, collected.error_code ?? 'COLLECT_FAILED', collected.message ?? 'Extension failed to collect page snapshot.');
    }

    if (!collected.snapshot.stalled) {
      this.pacing.recordLoadSuccess(ctx.site, ctx.target);
    }
    if (collected.snapshot.scrollStepsExecuted >= 3) {
      const scrollCost = Math.floor(collected.snapshot.scrollStepsExecuted / 3);
      if (scrollCost > 0) {
        await this.pacing.acquireLoad(ctx.site, ctx.target, scrollCost);
        totalPageLoads += scrollCost;
      }
    }

    const parsed = handler.parse(collected.snapshot, ctx.params);
    const notes = [...parsed.notes];
    if (
      collected.snapshot.hiddenInstructions.length > 0 ||
      detectHiddenPromptInstructions(collected.snapshot.hiddenInstructions)
    ) {
      notes.push('PAGE_INSTRUCTION_IGNORED');
    }

    const redaction = redactReaderPayload(parsed.data, { site: ctx.site, view: ctx.view });
    if (redaction.pageInstructionIgnored && !notes.includes('PAGE_INSTRUCTION_IGNORED')) {
      notes.push('PAGE_INSTRUCTION_IGNORED');
    }

    const endDate = new Date(this.clock.now());
    const endedAt = formatIsoWithOffset(endDate);
    const pacingNow = this.pacing.getStatus(ctx.site, ctx.target);
    const evidenceId = ctx.evidenceMode === 'off' ? null : mintUlid(`ev_${ctx.site}`, endDate.getTime());
    const complete = parsed.missing_required.length === 0 && !collected.snapshot.stalled;

    const envelope: ReaderEnvelope<Record<string, unknown>> = {
      ok: true,
      schema: READER_SCHEMA_VERSION,
      site: ctx.site,
      view: ctx.view,
      target: ctx.target,
      target_key: parsed.target_key ?? ctx.targetKey,
      captured_at: endedAt,
      source: 'live',
      freshness: { max_age_s: ctx.maxAgeS, age_s: 0, stale: false },
      complete,
      missing_required: parsed.missing_required,
      gate,
      pacing: { site: pacingNow.site, loads_left_hour: pacingNow.loads_left_hour, loads_left_day: pacingNow.loads_left_day },
      redaction: { policy: REDACTION_POLICY_ID, fields_redacted: redaction.fieldsRedacted },
      evidence_id: evidenceId,
      audit_id: auditId,
      caller: ctx.caller,
      data: redaction.redacted,
      notes,
      error_code: complete ? null : 'INCOMPLETE',
    };

    if (ctx.evidenceMode !== 'off') {
      recordEvidenceBundle({
        mode: ctx.evidenceMode,
        envelope,
        screenshotBase64: collected.screenshotBase64,
        now: endDate,
      });
    }

    const saved = this.store.saveResult({
      site: ctx.site,
      view: ctx.view,
      target_key: envelope.target_key,
      target: ctx.target,
      captured_at: endedAt,
      captured_ms: endDate.getTime(),
      schema: READER_SCHEMA_VERSION,
      complete,
      missing_required: parsed.missing_required,
      data: redaction.redacted,
      evidence_id: evidenceId,
      audit_id: auditId,
      caller: ctx.caller,
    });

    this.recordAuditRow(envelope, startedAt, endedAt, 'read', 'miss', totalPageLoads, 'CLEAR', gate, saved.result_id, attemptId);
    return envelope;
  }

  /** Bridges legacy `linkedin.*` RPC responses into the shared `reader_results` / `reader_latest` cache. */
  mirrorLegacyLinkedInRead(action: string, data: Record<string, unknown>): void {
    const viewMap: Record<string, string> = {
      'linkedin.profile.get': 'profile.self',
      'linkedin.post.get': 'post.summary',
      'linkedin.analytics.read': 'analytics.content',
      'linkedin.comments.read': 'post.comments',
      'linkedin.feed.read': 'feed.recent',
      'linkedin.search': 'search.people',
    };
    const view = viewMap[action];
    if (!view) return;
    const missing = Array.isArray(data.missingRequired) ? data.missingRequired.map(String) : [];
    const target = String(data.url ?? data.pageUrl ?? '');
    const targetKey = deriveTargetKey('linkedin', view, target, data);
    const nowDate = new Date(this.clock.now());
    const redaction = redactReaderPayload(data, { site: 'linkedin', view });
    this.store.saveResult({
      site: 'linkedin',
      view,
      target_key: targetKey,
      target,
      captured_at: formatIsoWithOffset(nowDate),
      captured_ms: nowDate.getTime(),
      schema: READER_SCHEMA_VERSION,
      complete: missing.length === 0,
      missing_required: missing,
      data: redaction.redacted,
      evidence_id: null,
      audit_id: mintUlid('au_legacy', nowDate.getTime()),
      caller: { bot: 'legacy-rpc', routine: action },
    });
  }

  private serveCachedHit(
    site: ReaderSiteId,
    view: string,
    target: string,
    targetKey: string,
    row: NonNullable<ReturnType<SharedReaderStore['getLatest']>>,
    maxAgeS: number,
    ageS: number,
    stale: boolean,
    cacheKind: 'hit' | 'stale-allowed',
    caller: ReaderCaller,
  ): ReaderEnvelope<Record<string, unknown>> {
    const nowIso = formatIsoWithOffset(new Date(this.clock.now()));
    const auditId = mintUlid('au', this.clock.now());
    const p = this.pacing.getStatus(site, target);
    const env: ReaderEnvelope<Record<string, unknown>> = {
      ok: true,
      schema: READER_SCHEMA_VERSION,
      site,
      view,
      target: row.target || target,
      target_key: targetKey,
      captured_at: row.captured_at,
      source: 'cache',
      freshness: { max_age_s: maxAgeS, age_s: ageS, stale },
      complete: row.complete === 1,
      missing_required: JSON.parse(row.missing_required_json) as string[],
      gate: 'CLEAR',
      pacing: { site: p.site, loads_left_hour: p.loads_left_hour, loads_left_day: p.loads_left_day },
      redaction: { policy: REDACTION_POLICY_ID, fields_redacted: 0 },
      evidence_id: row.evidence_id,
      audit_id: auditId,
      caller,
      data: JSON.parse(row.data_json) as Record<string, unknown>,
      notes: [],
      error_code: null,
    };
    this.recordAuditRow(env, nowIso, nowIso, 'read', cacheKind, 0, 'CLEAR', 'CLEAR', row.result_id);
    return env;
  }

  private serveGuardPaused(
    site: ReaderSiteId,
    view: string,
    target: string,
    targetKey: string,
    maxAgeS: number,
    cachedRow: ReturnType<SharedReaderStore['getLatest']>,
    ageS: number,
    caller: ReaderCaller,
    reason: string,
  ): ReaderEnvelope<Record<string, unknown>> {
    const nowIso = formatIsoWithOffset(new Date(this.clock.now()));
    const auditId = mintUlid('au', this.clock.now());
    const p = this.pacing.getStatus(site, target);
    const hasCache = Boolean(cachedRow);
    const env: ReaderEnvelope<Record<string, unknown>> = {
      ok: false,
      schema: READER_SCHEMA_VERSION,
      site,
      view,
      target,
      target_key: targetKey,
      captured_at: cachedRow?.captured_at ?? nowIso,
      source: 'cache',
      freshness: { max_age_s: maxAgeS, age_s: hasCache ? ageS : 0, stale: true },
      complete: cachedRow?.complete === 1,
      missing_required: cachedRow ? (JSON.parse(cachedRow.missing_required_json) as string[]) : [],
      gate: 'PAUSED_BY_GUARD',
      pacing: { site: p.site, loads_left_hour: p.loads_left_hour, loads_left_day: p.loads_left_day },
      redaction: { policy: REDACTION_POLICY_ID, fields_redacted: 0 },
      evidence_id: this.guard.getGuard(site).evidence_id ?? cachedRow?.evidence_id ?? null,
      audit_id: auditId,
      caller,
      data: cachedRow ? (JSON.parse(cachedRow.data_json) as Record<string, unknown>) : { error: reason },
      notes: [reason],
      error_code: 'PAUSED_BY_GUARD',
    };
    this.recordAuditRow(env, nowIso, nowIso, 'read', hasCache ? 'stale-allowed' : 'n/a', 0, 'PAUSED', 'PAUSED_BY_GUARD', cachedRow?.result_id ?? null);
    return env;
  }

  private failEnvelope(
    site: ReaderSiteId,
    view: string,
    target: string,
    targetKey: string,
    caller: ReaderCaller,
    gate: ReaderGateState,
    errorCode: string,
    message: string,
  ): ReaderEnvelope<Record<string, unknown>> {
    const nowIso = formatIsoWithOffset(new Date(this.clock.now()));
    const auditId = mintUlid('au', this.clock.now());
    const p = this.pacing.getStatus(site, target);
    const env: ReaderEnvelope<Record<string, unknown>> = {
      ok: false,
      schema: READER_SCHEMA_VERSION,
      site,
      view,
      target,
      target_key: targetKey,
      captured_at: nowIso,
      source: 'cache',
      freshness: { max_age_s: 0, age_s: 0, stale: false },
      complete: false,
      missing_required: [],
      gate,
      pacing: { site: p.site, loads_left_hour: p.loads_left_hour, loads_left_day: p.loads_left_day },
      redaction: { policy: REDACTION_POLICY_ID, fields_redacted: 0 },
      evidence_id: null,
      audit_id: auditId,
      caller,
      data: { error: message },
      notes: [message],
      error_code: errorCode,
    };
    this.recordAuditRow(env, nowIso, nowIso, 'read', 'n/a', 0, 'CLEAR', gate, null);
    return env;
  }

  private failEnvelopeWithAudit(
    ctx: { site: ReaderSiteId; view: string; target: string; targetKey: string; caller: ReaderCaller },
    startedAt: string,
    auditId: string,
    attemptId: string,
    pageLoads: number,
    gate: ReaderGateState,
    errorCode: string,
    message: string,
  ): ReaderEnvelope<Record<string, unknown>> {
    const endedAt = formatIsoWithOffset(new Date(this.clock.now()));
    const p = this.pacing.getStatus(ctx.site, ctx.target);
    const env: ReaderEnvelope<Record<string, unknown>> = {
      ok: false,
      schema: READER_SCHEMA_VERSION,
      site: ctx.site,
      view: ctx.view,
      target: ctx.target,
      target_key: ctx.targetKey,
      captured_at: endedAt,
      source: 'live',
      freshness: { max_age_s: 0, age_s: 0, stale: false },
      complete: false,
      missing_required: [],
      gate,
      pacing: { site: p.site, loads_left_hour: p.loads_left_hour, loads_left_day: p.loads_left_day },
      redaction: { policy: REDACTION_POLICY_ID, fields_redacted: 0 },
      evidence_id: null,
      audit_id: auditId,
      caller: ctx.caller,
      data: { error: message },
      notes: [message],
      error_code: errorCode,
    };
    this.recordAuditRow(env, startedAt, endedAt, 'read', 'miss', pageLoads, 'CLEAR', gate, null, attemptId);
    return env;
  }

  private failEnvelopeWithGuard(
    ctx: { site: ReaderSiteId; view: string; target: string; targetKey: string; caller: ReaderCaller },
    startedAt: string,
    auditId: string,
    attemptId: string,
    pageLoads: number,
    reason: string,
    evidenceId: string,
    alertLineOnce?: string,
    detectedGate: ReaderGateState = 'PAUSED_BY_GUARD',
  ): ReaderEnvelope<Record<string, unknown>> {
    const endedAt = formatIsoWithOffset(new Date(this.clock.now()));
    const p = this.pacing.getStatus(ctx.site, ctx.target);
    const env: ReaderEnvelope<Record<string, unknown>> = {
      ok: false,
      schema: READER_SCHEMA_VERSION,
      site: ctx.site,
      view: ctx.view,
      target: ctx.target,
      target_key: ctx.targetKey,
      captured_at: endedAt,
      source: 'live',
      freshness: { max_age_s: 0, age_s: 0, stale: false },
      complete: false,
      missing_required: [],
      gate: detectedGate === 'BLOCKED_CHALLENGE' || detectedGate === 'BLOCKED_AUTH' ? 'PAUSED_BY_GUARD' : detectedGate,
      pacing: { site: p.site, loads_left_hour: p.loads_left_hour, loads_left_day: p.loads_left_day },
      redaction: { policy: REDACTION_POLICY_ID, fields_redacted: 0 },
      evidence_id: evidenceId,
      audit_id: auditId,
      caller: ctx.caller,
      data: { error: reason, detected_gate: detectedGate },
      notes: [reason],
      error_code: 'PAUSED_BY_GUARD',
      ...(alertLineOnce ? { alert_line: alertLineOnce } : {}),
    };
    this.recordAuditRow(env, startedAt, endedAt, 'read', 'miss', pageLoads, 'CLEAR', 'PAUSED_BY_GUARD', null, attemptId);
    return env;
  }

  recordAuditRow(
    env: ReaderEnvelope<unknown>,
    startedAt: string,
    endedAt: string,
    kind: 'read' | 'check' | 'guard',
    cache: 'hit' | 'miss' | 'stale-allowed' | 'n/a',
    pageLoads: number,
    gateBefore: ReaderGateState | 'PAUSED',
    gateAfter: ReaderGateState | 'CLEAR' | 'PAUSED',
    resultId: string | null,
    attemptId?: string,
  ): void {
    this.audit.append({
      audit_id: env.audit_id,
      attempt_id: attemptId,
      started_at: startedAt,
      ended_at: endedAt,
      caller_bot: env.caller.bot,
      caller_routine: env.caller.routine,
      site: env.site,
      view: env.view,
      target: env.target,
      kind,
      cache,
      page_loads: pageLoads,
      pacing_after: env.pacing,
      gate_before: gateBefore,
      gate_after: gateAfter,
      result: env.ok ? 'AGENT_OK' : 'AGENT_FAIL',
      error_code: env.error_code ?? null,
      evidence_id: env.evidence_id,
      result_id: resultId,
    });
  }
}
