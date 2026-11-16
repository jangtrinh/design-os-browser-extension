import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { formatIsoWithOffset, mintUlid } from '../../../shared/hash.js';
import {
  READER_SCHEMA_VERSION,
  REDACTION_POLICY_ID,
  SITE_PACING_POLICIES,
  type AccountGuardRecord,
  type ReaderCaller,
  type ReaderEnvelope,
  type ReaderSiteId,
} from '../../../shared/reader-schema.js';
import type { CallerOrigin } from '../../../shared/rpc-envelope.js';
import { ReaderAuditLog } from './audit-log.js';
import { recordEvidenceBundle } from './evidence-recorder.js';

export class AccountGuardManager {
  private readonly db: DatabaseSyncType;
  private readonly audit: ReaderAuditLog;
  private readonly onChange?: (guards: AccountGuardRecord[]) => void;

  constructor(
    db: DatabaseSyncType,
    audit: ReaderAuditLog,
    onChange?: (guards: AccountGuardRecord[]) => void,
  ) {
    this.db = db;
    this.audit = audit;
    this.onChange = onChange;
  }

  getGuard(site: ReaderSiteId): AccountGuardRecord {
    const row = this.db
      .prepare('SELECT * FROM account_guards WHERE site = ?')
      .get(site) as {
        site: ReaderSiteId;
        state: 'CLEAR' | 'PAUSED';
        reason: string | null;
        since: string | null;
        evidence_id: string | null;
        alert_emitted: number;
        alert_line: string | null;
      } | undefined;

    if (!row) {
      return {
        site,
        state: 'CLEAR',
        reason: null,
        since: null,
        evidence_id: null,
        alert_emitted: false,
        alert_line: null,
      };
    }
    return {
      site: row.site,
      state: row.state,
      reason: row.reason,
      since: row.since,
      evidence_id: row.evidence_id,
      alert_emitted: row.alert_emitted === 1,
      alert_line: row.alert_line,
    };
  }

  listGuards(): AccountGuardRecord[] {
    return (Object.keys(SITE_PACING_POLICIES) as ReaderSiteId[]).map((site) => this.getGuard(site));
  }

  triggerPause(params: {
    site: ReaderSiteId;
    view: string;
    target: string;
    targetKey: string;
    reason: string;
    caller: ReaderCaller;
    auditId: string;
    loadsLeftHour: number;
    loadsLeftDay: number;
    screenshotBase64?: string;
    extraData?: Record<string, unknown>;
    now?: Date;
  }): { guard: AccountGuardRecord; alertLineOnce?: string; evidenceId: string } {
    const now = params.now ?? new Date();
    const existing = this.getGuard(params.site);
    const sinceIso = existing.state === 'PAUSED' && existing.since ? existing.since : formatIsoWithOffset(now);
    const evidenceId = mintUlid(`ev_${params.site}`, now.getTime());

    const stubEnvelope: ReaderEnvelope<Record<string, unknown>> = {
      ok: false,
      schema: READER_SCHEMA_VERSION,
      site: params.site,
      view: params.view,
      target: params.target,
      target_key: params.targetKey,
      captured_at: formatIsoWithOffset(now),
      source: 'live',
      freshness: { max_age_s: 0, age_s: 0, stale: false },
      complete: false,
      missing_required: [],
      gate: 'PAUSED_BY_GUARD',
      pacing: { site: params.site, loads_left_hour: params.loadsLeftHour, loads_left_day: loadsLeftDaySafe(params.loadsLeftDay) },
      redaction: { policy: REDACTION_POLICY_ID, fields_redacted: 0 },
      evidence_id: evidenceId,
      audit_id: params.auditId,
      caller: params.caller,
      data: { guard_reason: params.reason, ...(params.extraData ?? {}) },
      notes: ['Account guard triggered; automatic pause active until human clears via extension popup.'],
      error_code: 'PAUSED_BY_GUARD',
    };

    // Account guard triggers always capture json+screenshot when a screenshot is provided.
    recordEvidenceBundle({
      mode: params.screenshotBase64 ? 'json+screenshot' : 'json',
      envelope: stubEnvelope,
      screenshotBase64: params.screenshotBase64,
      now,
    });

    const alertLine =
      `[GUARD PAUSED] site=${params.site} reason="${params.reason}" since=${sinceIso} evidence=${evidenceId}`;
    const alreadyAlerted = existing.state === 'PAUSED' && existing.alert_emitted;

    this.db
      .prepare(
        `INSERT INTO account_guards (site, state, reason, since, evidence_id, alert_emitted, alert_line)
         VALUES (?, 'PAUSED', ?, ?, ?, 1, ?)
         ON CONFLICT(site) DO UPDATE SET
           state = 'PAUSED',
           reason = COALESCE(account_guards.reason, excluded.reason),
           since = COALESCE(account_guards.since, excluded.since),
           evidence_id = COALESCE(account_guards.evidence_id, excluded.evidence_id),
           alert_emitted = 1,
           alert_line = COALESCE(account_guards.alert_line, excluded.alert_line)`,
      )
      .run(params.site, params.reason, sinceIso, evidenceId, alertLine);

    const updated = this.getGuard(params.site);
    this.onChange?.(this.listGuards());
    return {
      guard: updated,
      ...(alreadyAlerted ? {} : { alertLineOnce: updated.alert_line ?? alertLine }),
      evidenceId: updated.evidence_id ?? evidenceId,
    };
  }

  /**
   * Clears a PAUSED site guard. ONLY accepted from trusted human clicks in `extension-popup`.
   * Any agent-rpc / CLI / MCP attempt is unconditionally rejected.
   */
  resolveByHumanPopup(
    site: ReaderSiteId,
    callerOrigin: CallerOrigin,
    now: Date = new Date(),
  ): { ok: boolean; error?: string; guard: AccountGuardRecord } {
    const current = this.getGuard(site);
    if (callerOrigin !== 'extension-popup') {
      return {
        ok: false,
        error: 'GUARD_CLEAR_FORBIDDEN: Only human clicks inside extension-popup may resume a paused account guard.',
        guard: current,
      };
    }

    const nowIso = formatIsoWithOffset(now);
    this.db
      .prepare(
        `INSERT INTO account_guards (site, state, reason, since, evidence_id, alert_emitted, alert_line)
         VALUES (?, 'CLEAR', NULL, NULL, NULL, 0, NULL)
         ON CONFLICT(site) DO UPDATE SET
           state = 'CLEAR',
           reason = NULL,
           since = NULL,
           evidence_id = NULL,
           alert_emitted = 0,
           alert_line = NULL`,
      )
      .run(site);

    this.audit.append({
      started_at: nowIso,
      ended_at: nowIso,
      caller_bot: 'human-popup',
      caller_routine: 'Account guard resolved in popup',
      site,
      view: 'guard.resolve',
      target: `guard://${site}`,
      kind: 'guard',
      cache: 'n/a',
      page_loads: 0,
      pacing_after: { site, loads_left_hour: SITE_PACING_POLICIES[site].perHour, loads_left_day: SITE_PACING_POLICIES[site].perDay },
      gate_before: current.state === 'PAUSED' ? 'PAUSED' : 'CLEAR',
      gate_after: 'CLEAR',
      result: 'AGENT_OK',
      error_code: null,
      evidence_id: current.evidence_id,
      result_id: null,
    });

    const cleared = this.getGuard(site);
    this.onChange?.(this.listGuards());
    return { ok: true, guard: cleared };
  }
}

function loadsLeftDaySafe(n: number): number {
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}
