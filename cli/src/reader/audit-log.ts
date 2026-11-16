import { appendFileSync, chmodSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { formatIsoWithOffset, mintUlid, sha256Hex } from '../../../shared/hash.js';
import type { ReaderGateState, ReaderPacingInfo, ReaderSiteId } from '../../../shared/reader-schema.js';

export interface AuditRowInput {
  audit_id?: string;
  attempt_id?: string;
  started_at: string;
  ended_at: string;
  caller_bot: string;
  caller_routine: string;
  site: ReaderSiteId;
  view: string;
  target: string;
  kind: 'read' | 'check' | 'guard';
  cache: 'hit' | 'miss' | 'stale-allowed' | 'n/a';
  page_loads: number;
  pacing_after: ReaderPacingInfo;
  gate_before: ReaderGateState | 'PAUSED';
  gate_after: ReaderGateState | 'CLEAR' | 'PAUSED';
  result: 'AGENT_OK' | 'AGENT_FAIL';
  error_code: string | null;
  evidence_id: string | null;
  result_id: string | null;
}

export interface StoredAuditRow {
  seq: number;
  audit_id: string;
  attempt_id: string;
  started_at: string;
  ended_at: string;
  caller_bot: string;
  caller_routine: string;
  site: string;
  view: string;
  target: string;
  kind: string;
  cache: string;
  page_loads: number;
  pacing_after_json: string;
  gate_before: string;
  gate_after: string;
  result: string;
  error_code: string | null;
  evidence_id: string | null;
  result_id: string | null;
  prev_hash: string;
  row_hash: string;
}

export function resolveAuditDir(): string {
  return (
    process.env.BROWSER_AGENT_AUDIT_DIR?.trim() ||
    join(homedir(), '.design-os-browser-extension', 'audit')
  );
}

function canonicalAuditPayload(row: Omit<StoredAuditRow, 'seq' | 'row_hash'>): string {
  return JSON.stringify([
    row.audit_id,
    row.attempt_id,
    row.started_at,
    row.ended_at,
    row.caller_bot,
    row.caller_routine,
    row.site,
    row.view,
    row.target,
    row.kind,
    row.cache,
    row.page_loads,
    row.pacing_after_json,
    row.gate_before,
    row.gate_after,
    row.result,
    row.error_code,
    row.evidence_id,
    row.result_id,
    row.prev_hash,
  ]);
}

export class ReaderAuditLog {
  private readonly db: DatabaseSyncType;
  private readonly mirrorToFile: boolean;

  constructor(db: DatabaseSyncType, mirrorToFile = true) {
    this.db = db;
    this.mirrorToFile = mirrorToFile;
  }

  append(input: AuditRowInput): StoredAuditRow {
    const audit_id = input.audit_id ?? mintUlid('au');
    const attempt_id = input.attempt_id ?? mintUlid('at');
    const last = this.db
      .prepare('SELECT row_hash FROM audit_log ORDER BY seq DESC LIMIT 1')
      .get() as { row_hash: string } | undefined;
    const prev_hash = last?.row_hash ?? 'GENESIS';

    const baseRow = {
      audit_id,
      attempt_id,
      started_at: input.started_at,
      ended_at: input.ended_at,
      caller_bot: input.caller_bot,
      caller_routine: input.caller_routine,
      site: input.site,
      view: input.view,
      target: input.target,
      kind: input.kind,
      cache: input.cache,
      page_loads: input.page_loads,
      pacing_after_json: JSON.stringify(input.pacing_after),
      gate_before: input.gate_before,
      gate_after: input.gate_after,
      result: input.result,
      error_code: input.error_code,
      evidence_id: input.evidence_id,
      result_id: input.result_id,
      prev_hash,
    };
    const row_hash = sha256Hex(canonicalAuditPayload(baseRow));

    const info = this.db
      .prepare(
        `INSERT INTO audit_log (
          audit_id, attempt_id, started_at, ended_at, caller_bot, caller_routine,
          site, view, target, kind, cache, page_loads, pacing_after_json,
          gate_before, gate_after, result, error_code, evidence_id, result_id,
          prev_hash, row_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        baseRow.audit_id,
        baseRow.attempt_id,
        baseRow.started_at,
        baseRow.ended_at,
        baseRow.caller_bot,
        baseRow.caller_routine,
        baseRow.site,
        baseRow.view,
        baseRow.target,
        baseRow.kind,
        baseRow.cache,
        baseRow.page_loads,
        baseRow.pacing_after_json,
        baseRow.gate_before,
        baseRow.gate_after,
        baseRow.result,
        baseRow.error_code,
        baseRow.evidence_id,
        baseRow.result_id,
        baseRow.prev_hash,
        row_hash,
      );

    const stored: StoredAuditRow = { seq: Number(info.lastInsertRowid), ...baseRow, row_hash };
    if (this.mirrorToFile) {
      this.appendJsonlMirror(stored);
    }
    return stored;
  }

  private appendJsonlMirror(row: StoredAuditRow): void {
    const dir = resolveAuditDir();
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
    const day = (row.ended_at || formatIsoWithOffset()).slice(0, 10);
    const file = join(dir, `${day}.jsonl`);
    appendFileSync(file, `${JSON.stringify(row)}\n`, { encoding: 'utf8', mode: 0o600 });
    chmodSync(file, 0o600);
  }

  verifyChain(): { ok: boolean; count: number; brokenSeq?: number; reason?: string } {
    const rows = this.db.prepare('SELECT * FROM audit_log ORDER BY seq ASC').all() as unknown as StoredAuditRow[];
    let expectedPrev = 'GENESIS';
    for (const row of rows) {
      if (row.prev_hash !== expectedPrev) {
        return { ok: false, count: rows.length, brokenSeq: row.seq, reason: 'AUDIT_CHAIN_PREV_HASH_MISMATCH' };
      }
      const expectedHash = sha256Hex(canonicalAuditPayload(row));
      if (row.row_hash !== expectedHash) {
        return { ok: false, count: rows.length, brokenSeq: row.seq, reason: 'AUDIT_CHAIN_ROW_HASH_MISMATCH' };
      }
      expectedPrev = row.row_hash;
    }
    return { ok: true, count: rows.length };
  }

  query(filters: { since?: string; site?: string; caller?: string; limit?: number } = {}): StoredAuditRow[] {
    const clauses: string[] = [];
    const args: (string | number)[] = [];
    if (filters.since) {
      clauses.push('ended_at >= ?');
      args.push(filters.since);
    }
    if (filters.site) {
      clauses.push('site = ?');
      args.push(filters.site);
    }
    if (filters.caller) {
      clauses.push('caller_bot = ?');
      args.push(filters.caller);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const limit = Math.min(Math.max(1, filters.limit ?? 100), 500);
    args.push(limit);
    return this.db
      .prepare(`SELECT * FROM audit_log ${where} ORDER BY seq DESC LIMIT ?`)
      .all(...args) as unknown as StoredAuditRow[];
  }
}
