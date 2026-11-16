import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { formatIsoWithOffset } from '../../../shared/hash.js';
import {
  SITE_PACING_POLICIES,
  type ReaderPacingInfo,
  type ReaderSiteId,
  type SitePacingPolicy,
} from '../../../shared/reader-schema.js';

export interface PacingClock {
  now(): number;
  sleep(ms: number): Promise<void>;
  /** Returns value in [-1, 1] for jitter calculation. */
  jitter(): number;
}

const DEFAULT_CLOCK: PacingClock = {
  now: () => Date.now(),
  sleep: (ms: number) => new Promise((r) => setTimeout(r, ms)),
  jitter: () => Math.random() * 2 - 1,
};

export interface BudgetAcquireResult {
  ok: boolean;
  waitedMs: number;
  error_code?: 'PACING_EXHAUSTED' | 'STALLED';
  reason?: string;
  pacing: ReaderPacingInfo;
}

export function resolveBudgetKey(site: ReaderSiteId, targetUrl?: string): { effectiveSite: ReaderSiteId; budgetKey: string; policy: SitePacingPolicy } {
  let host = '';
  if (targetUrl) {
    try {
      host = new URL(targetUrl).hostname.toLowerCase();
    } catch {
      host = '';
    }
  }
  const effectiveSite: ReaderSiteId =
    site === 'jobs' && (host === 'linkedin.com' || host.endsWith('.linkedin.com'))
      ? 'linkedin'
      : site;
  const policy = SITE_PACING_POLICIES[effectiveSite];
  const budgetKey = policy.perHost && host ? `${effectiveSite}:${host}` : effectiveSite;
  return { effectiveSite, budgetKey, policy };
}

export class PacingBudgetManager {
  private readonly db: DatabaseSyncType;
  private readonly clock: PacingClock;

  constructor(db: DatabaseSyncType, clock: PacingClock = DEFAULT_CLOCK) {
    this.db = db;
    this.clock = clock;
  }

  getStatus(site: ReaderSiteId, targetUrl?: string): ReaderPacingInfo & {
    budget_key: string;
    used_hour: number;
    used_day: number;
    per_hour: number;
    per_day: number;
    stalled_until: string | null;
    consecutive_stalls: number;
  } {
    const nowMs = this.clock.now();
    const { effectiveSite, budgetKey, policy } = resolveBudgetKey(site, targetUrl);
    const hourRow = this.db
      .prepare('SELECT COALESCE(SUM(loads), 0) AS total FROM pacing_loads WHERE budget_key = ? AND ts_ms >= ?')
      .get(budgetKey, nowMs - 3_600_000) as { total: number };
    const dayRow = this.db
      .prepare('SELECT COALESCE(SUM(loads), 0) AS total FROM pacing_loads WHERE budget_key = ? AND ts_ms >= ?')
      .get(budgetKey, nowMs - 86_400_000) as { total: number };
    const stateRow = this.db
      .prepare('SELECT consecutive_stalls, stalled_until_ms FROM pacing_state WHERE budget_key = ?')
      .get(budgetKey) as { consecutive_stalls: number; stalled_until_ms: number } | undefined;

    const usedHour = Number(hourRow?.total ?? 0);
    const usedDay = Number(dayRow?.total ?? 0);
    const stalledUntilMs = Number(stateRow?.stalled_until_ms ?? 0);

    return {
      site: effectiveSite,
      budget_key: budgetKey,
      loads_left_hour: Math.max(0, policy.perHour - usedHour),
      loads_left_day: Math.max(0, policy.perDay - usedDay),
      used_hour: usedHour,
      used_day: usedDay,
      per_hour: policy.perHour,
      per_day: policy.perDay,
      stalled_until: stalledUntilMs > nowMs ? formatIsoWithOffset(new Date(stalledUntilMs)) : null,
      consecutive_stalls: Number(stateRow?.consecutive_stalls ?? 0),
    };
  }

  listAllStatuses(): ReturnType<PacingBudgetManager['getStatus']>[] {
    return (Object.keys(SITE_PACING_POLICIES) as ReaderSiteId[]).map((s) => this.getStatus(s));
  }

  canAfford(site: ReaderSiteId, targetUrl?: string, additionalLoads = 1): { ok: boolean; error_code?: 'PACING_EXHAUSTED' | 'STALLED'; reason?: string } {
    const status = this.getStatus(site, targetUrl);
    if (status.stalled_until) {
      return {
        ok: false,
        error_code: 'STALLED',
        reason: `Site ${status.site} is paused until ${status.stalled_until} after 3 consecutive stalls.`,
      };
    }
    if (status.loads_left_hour < additionalLoads || status.loads_left_day < additionalLoads) {
      return {
        ok: false,
        error_code: 'PACING_EXHAUSTED',
        reason: `Pacing budget exhausted for ${status.budget_key} (${status.used_hour}/${status.per_hour} hour, ${status.used_day}/${status.per_day} day).`,
      };
    }
    return { ok: true };
  }

  async acquireLoad(site: ReaderSiteId, targetUrl?: string, loadsCost = 1): Promise<BudgetAcquireResult> {
    const preCheck = this.canAfford(site, targetUrl, loadsCost);
    const statusBefore = this.getStatus(site, targetUrl);
    if (!preCheck.ok) {
      return {
        ok: false,
        waitedMs: 0,
        error_code: preCheck.error_code,
        reason: preCheck.reason,
        pacing: {
          site: statusBefore.site,
          loads_left_hour: statusBefore.loads_left_hour,
          loads_left_day: statusBefore.loads_left_day,
        },
      };
    }

    const { effectiveSite, budgetKey, policy } = resolveBudgetKey(site, targetUrl);
    const state = this.db
      .prepare('SELECT last_load_ms FROM pacing_state WHERE budget_key = ?')
      .get(budgetKey) as { last_load_ms: number } | undefined;

    let waitedMs = 0;
    const nowBeforeSleep = this.clock.now();
    if (state?.last_load_ms) {
      const jitterOffset = policy.minGapMs * policy.jitterPct * this.clock.jitter();
      const targetGap = Math.max(0, Math.round(policy.minGapMs + jitterOffset));
      const elapsed = nowBeforeSleep - state.last_load_ms;
      if (elapsed < targetGap) {
        waitedMs = targetGap - elapsed;
        await this.clock.sleep(waitedMs);
      }
    }

    const loadTs = this.clock.now();
    this.db
      .prepare('INSERT INTO pacing_loads (budget_key, site, ts_ms, loads) VALUES (?, ?, ?, ?)')
      .run(budgetKey, effectiveSite, loadTs, loadsCost);
    this.db
      .prepare(
        `INSERT INTO pacing_state (budget_key, last_load_ms) VALUES (?, ?)
         ON CONFLICT(budget_key) DO UPDATE SET last_load_ms = excluded.last_load_ms`,
      )
      .run(budgetKey, loadTs);

    const after = this.getStatus(site, targetUrl);
    return {
      ok: true,
      waitedMs,
      pacing: {
        site: after.site,
        loads_left_hour: after.loads_left_hour,
        loads_left_day: after.loads_left_day,
      },
    };
  }

  async waitStallRetryGap(site: ReaderSiteId, targetUrl?: string): Promise<number> {
    const { policy } = resolveBudgetKey(site, targetUrl);
    const waitMs = policy.minGapMs * 2;
    await this.clock.sleep(waitMs);
    return waitMs;
  }

  recordLoadSuccess(site: ReaderSiteId, targetUrl?: string): void {
    const { budgetKey } = resolveBudgetKey(site, targetUrl);
    this.db
      .prepare(
        `INSERT INTO pacing_state (budget_key, last_load_ms, consecutive_stalls)
         VALUES (?, ?, 0)
         ON CONFLICT(budget_key) DO UPDATE SET consecutive_stalls = 0`,
      )
      .run(budgetKey, this.clock.now());
  }

  recordStall(site: ReaderSiteId, targetUrl?: string): {
    consecutiveStalls: number;
    paused30m: boolean;
    triggerGuard: boolean;
    stalledUntilMs: number;
  } {
    const nowMs = this.clock.now();
    const today = formatIsoWithOffset(new Date(nowMs)).slice(0, 10);
    const { budgetKey } = resolveBudgetKey(site, targetUrl);
    const prev = this.db
      .prepare('SELECT consecutive_stalls, stall_pauses_day, stall_pauses_count FROM pacing_state WHERE budget_key = ?')
      .get(budgetKey) as { consecutive_stalls: number; stall_pauses_day: string; stall_pauses_count: number } | undefined;

    let consecutive = Number(prev?.consecutive_stalls ?? 0) + 1;
    let pausesToday = prev?.stall_pauses_day === today ? Number(prev.stall_pauses_count) : 0;
    let paused30m = false;
    let triggerGuard = false;
    let stalledUntilMs = 0;

    if (consecutive >= 3) {
      paused30m = true;
      consecutive = 0;
      pausesToday += 1;
      stalledUntilMs = nowMs + 30 * 60_000;
      if (pausesToday >= 3) {
        triggerGuard = true;
      }
    }

    this.db
      .prepare(
        `INSERT INTO pacing_state (budget_key, last_load_ms, consecutive_stalls, stalled_until_ms, stall_pauses_day, stall_pauses_count)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(budget_key) DO UPDATE SET
           last_load_ms = excluded.last_load_ms,
           consecutive_stalls = excluded.consecutive_stalls,
           stalled_until_ms = excluded.stalled_until_ms,
           stall_pauses_day = excluded.stall_pauses_day,
           stall_pauses_count = excluded.stall_pauses_count`,
      )
      .run(budgetKey, nowMs, consecutive, stalledUntilMs, today, pausesToday);

    return { consecutiveStalls: consecutive, paused30m, triggerGuard, stalledUntilMs };
  }
}
