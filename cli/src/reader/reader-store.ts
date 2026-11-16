import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { mintUlid } from '../../../shared/hash.js';
import type { ReaderCaller, ReaderSiteId } from '../../../shared/reader-schema.js';

export interface StoredReaderRow {
  result_id: string;
  site: ReaderSiteId;
  view: string;
  target_key: string;
  target: string;
  captured_at: string;
  captured_ms: number;
  schema: string;
  complete: number;
  missing_required_json: string;
  data_json: string;
  evidence_id: string | null;
  audit_id: string;
  caller_bot: string;
  caller_routine: string;
}

export function extractNumericSeries(data: unknown): Array<{ metric: string; period: string; value: number }> {
  const out: Array<{ metric: string; period: string; value: number }> = [];
  if (!data || typeof data !== 'object') return out;
  const rec = data as Record<string, unknown>;
  const period = typeof rec.period === 'string' ? rec.period : '';

  const walk = (obj: Record<string, unknown>, prefix = '', localPeriod = period): void => {
    const p = typeof obj.period === 'string' ? obj.period : localPeriod;
    for (const [k, v] of Object.entries(obj)) {
      if (k === 'position' || k === 'id' || k === 'url') continue;
      if (typeof v === 'number' && Number.isFinite(v)) {
        out.push({ metric: prefix ? `${prefix}.${k}` : k, period: p, value: v });
      } else if (v && typeof v === 'object' && !Array.isArray(v)) {
        walk(v as Record<string, unknown>, prefix ? `${prefix}.${k}` : k, p);
      }
    }
  };
  walk(rec);
  return out;
}

export class SharedReaderStore {
  private readonly db: DatabaseSyncType;

  constructor(db: DatabaseSyncType) {
    this.db = db;
  }

  saveResult(params: {
    site: ReaderSiteId;
    view: string;
    target_key: string;
    target: string;
    captured_at: string;
    captured_ms: number;
    schema: string;
    complete: boolean;
    missing_required: string[];
    data: unknown;
    evidence_id: string | null;
    audit_id: string;
    caller: ReaderCaller;
  }): { result_id: string; promotedToLatest: boolean } {
    const result_id = mintUlid('res', params.captured_ms);
    const isComplete = params.complete && params.missing_required.length === 0;

    this.db
      .prepare(
        `INSERT INTO reader_results (
          result_id, site, view, target_key, target, captured_at, captured_ms,
          schema, complete, missing_required_json, data_json,
          evidence_id, audit_id, caller_bot, caller_routine
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        result_id,
        params.site,
        params.view,
        params.target_key,
        params.target,
        params.captured_at,
        params.captured_ms,
        params.schema,
        isComplete ? 1 : 0,
        JSON.stringify(params.missing_required),
        JSON.stringify(params.data ?? {}),
        params.evidence_id,
        params.audit_id,
        params.caller.bot,
        params.caller.routine,
      );

    if (!isComplete) {
      return { result_id, promotedToLatest: false };
    }

    this.db
      .prepare(
        `INSERT INTO reader_latest (site, view, target_key, result_id, captured_at, captured_ms)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(site, view, target_key) DO UPDATE SET
           result_id = excluded.result_id,
           captured_at = excluded.captured_at,
           captured_ms = excluded.captured_ms`,
      )
      .run(params.site, params.view, params.target_key, result_id, params.captured_at, params.captured_ms);

    const series = extractNumericSeries(params.data);
    const stmt = this.db.prepare(
      `INSERT INTO reader_series (site, view, target_key, metric, period, captured_at, value)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const point of series) {
      stmt.run(params.site, params.view, params.target_key, point.metric, point.period, params.captured_at, point.value);
    }

    return { result_id, promotedToLatest: true };
  }

  getLatest(site: ReaderSiteId, view: string, target_key: string): StoredReaderRow | null {
    const row = this.db
      .prepare(
        `SELECT r.*
         FROM reader_latest l
         JOIN reader_results r ON r.result_id = l.result_id
         WHERE l.site = ? AND l.view = ? AND l.target_key = ?`,
      )
      .get(site, view, target_key) as StoredReaderRow | undefined;
    return row ?? null;
  }

  queryByFilter(filters: { site?: string; view?: string; target_key?: string; since?: string; limit?: number }): Record<string, unknown>[] {
    const clauses: string[] = [];
    const args: (string | number)[] = [];
    if (filters.site) {
      clauses.push('site = ?');
      args.push(filters.site);
    }
    if (filters.view) {
      clauses.push('view = ?');
      args.push(filters.view);
    }
    if (filters.target_key) {
      clauses.push('target_key = ?');
      args.push(filters.target_key);
    }
    if (filters.since) {
      clauses.push('captured_at >= ?');
      args.push(filters.since);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    args.push(Math.min(Math.max(1, filters.limit ?? 50), 200));
    return this.db
      .prepare(`SELECT result_id, site, view, target_key, target, captured_at, schema, complete, data_json, evidence_id FROM reader_results ${where} ORDER BY captured_ms DESC LIMIT ?`)
      .all(...args) as Record<string, unknown>[];
  }
}
