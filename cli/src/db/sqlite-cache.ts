import { chmodSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';

function loadDatabaseSyncConstructor(): typeof DatabaseSyncType {
  const originalEmitWarning = process.emitWarning.bind(process);
  process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
    const msg = typeof warning === 'string' ? warning : warning?.message ?? '';
    if (msg.includes('SQLite is an experimental feature')) return;
    return (originalEmitWarning as (...a: unknown[]) => void)(warning, ...args);
  }) as typeof process.emitWarning;

  try {
    const req = createRequire(import.meta.url);
    const mod = req('node:sqlite') as { DatabaseSync: typeof DatabaseSyncType };
    return mod.DatabaseSync;
  } finally {
    process.emitWarning = originalEmitWarning;
  }
}

export function resolveDefaultDbPath(): string {
  return (
    process.env.BROWSER_AGENT_CACHE_PATH?.trim() ||
    process.env.BROWSER_AGENT_DB_PATH?.trim() ||
    join(homedir(), '.design-os-browser-extension', 'cache.sqlite')
  );
}

const FORBIDDEN_SQL_KEYWORD_RE =
  /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|ATTACH|DETACH|PRAGMA|VACUUM|REINDEX|BEGIN|COMMIT|ROLLBACK|SAVEPOINT)\b/i;

function stripSqlStringLiterals(sql: string): string {
  return sql.replace(/'(?:''|[^'])*'/g, "''").replace(/"(?:\"\"|[^"])*"/g, '""');
}

export function validateReadOnlySelectSql(rawSql: string): string {
  const trimmed = rawSql.trim().replace(/;+\s*$/, '');
  if (!trimmed) {
    throw new Error('SQL_EMPTY: Query cannot be empty.');
  }
  if (trimmed.includes(';') || trimmed.includes('--') || trimmed.includes('/*')) {
    throw new Error('SQL_READ_ONLY_VIOLATION: Multiple statements or SQL comments are disallowed.');
  }
  const stripped = stripSqlStringLiterals(trimmed);
  if (!/^(SELECT|WITH)\b/i.test(stripped)) {
    throw new Error('SQL_READ_ONLY_VIOLATION: Only SELECT or WITH ... SELECT queries are permitted.');
  }
  if (FORBIDDEN_SQL_KEYWORD_RE.test(stripped)) {
    throw new Error('SQL_READ_ONLY_VIOLATION: Write or administrative SQL keywords are disallowed.');
  }
  return trimmed;
}

export class LinkedInSqliteCache {
  readonly dbPath: string;
  private readonly db: DatabaseSyncType;

  constructor(dbPath: string = resolveDefaultDbPath()) {
    this.dbPath = dbPath;
    if (dbPath !== ':memory:') {
      mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });
    }
    const DatabaseSyncCtor = loadDatabaseSyncConstructor();
    this.db = new DatabaseSyncCtor(dbPath);
    this.initSchema();
    if (dbPath !== ':memory:') {
      try {
        chmodSync(dbPath, 0o600);
      } catch {
        // Best-effort permission lock on platforms supporting POSIX modes
      }
    }
  }

  getDatabase(): DatabaseSyncType {
    return this.db;
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS profiles (
        public_identifier TEXT PRIMARY KEY,
        urn TEXT,
        url TEXT NOT NULL,
        full_name TEXT NOT NULL,
        headline TEXT,
        location TEXT,
        about TEXT,
        source TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        captured_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS posts (
        post_urn TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        author_name TEXT NOT NULL,
        text TEXT NOT NULL,
        reactions_count INTEGER,
        comments_count INTEGER,
        source TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        captured_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS companies (
        slug TEXT PRIMARY KEY,
        urn TEXT,
        url TEXT NOT NULL,
        name TEXT NOT NULL,
        tagline TEXT,
        industry TEXT,
        size_text TEXT,
        source TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        captured_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS jobs (
        job_id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        title TEXT NOT NULL,
        company_name TEXT NOT NULL,
        location TEXT,
        salary_text TEXT,
        source TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        captured_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS threads (
        thread_id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        title TEXT NOT NULL,
        unread INTEGER NOT NULL,
        last_message_text TEXT,
        source TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        captured_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS search_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL,
        query TEXT NOT NULL,
        page_url TEXT NOT NULL,
        item_count INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        captured_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS copilot_queue (
        queue_id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        target TEXT NOT NULL,
        body TEXT NOT NULL,
        status TEXT NOT NULL,
        prefilled INTEGER NOT NULL,
        sent INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS reader_results (
        result_id TEXT PRIMARY KEY,
        site TEXT NOT NULL,
        view TEXT NOT NULL,
        target_key TEXT NOT NULL,
        target TEXT NOT NULL,
        captured_at TEXT NOT NULL,
        captured_ms INTEGER NOT NULL,
        schema TEXT NOT NULL,
        complete INTEGER NOT NULL,
        missing_required_json TEXT NOT NULL,
        data_json TEXT NOT NULL,
        evidence_id TEXT,
        audit_id TEXT NOT NULL,
        caller_bot TEXT NOT NULL,
        caller_routine TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_reader_results_lookup
        ON reader_results(site, view, target_key, captured_ms DESC);

      CREATE TABLE IF NOT EXISTS reader_latest (
        site TEXT NOT NULL,
        view TEXT NOT NULL,
        target_key TEXT NOT NULL,
        result_id TEXT NOT NULL,
        captured_at TEXT NOT NULL,
        captured_ms INTEGER NOT NULL,
        PRIMARY KEY (site, view, target_key)
      );

      CREATE TABLE IF NOT EXISTS reader_series (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        site TEXT NOT NULL,
        view TEXT NOT NULL,
        target_key TEXT NOT NULL,
        metric TEXT NOT NULL,
        period TEXT,
        captured_at TEXT NOT NULL,
        value REAL NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_reader_series_lookup
        ON reader_series(site, view, target_key, metric, captured_at);

      CREATE TABLE IF NOT EXISTS pacing_loads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        budget_key TEXT NOT NULL,
        site TEXT NOT NULL,
        ts_ms INTEGER NOT NULL,
        loads INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_pacing_loads_key_ts
        ON pacing_loads(budget_key, ts_ms DESC);

      CREATE TABLE IF NOT EXISTS pacing_state (
        budget_key TEXT PRIMARY KEY,
        last_load_ms INTEGER NOT NULL DEFAULT 0,
        consecutive_stalls INTEGER NOT NULL DEFAULT 0,
        stalled_until_ms INTEGER NOT NULL DEFAULT 0,
        stall_pauses_day TEXT NOT NULL DEFAULT '',
        stall_pauses_count INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS account_guards (
        site TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        reason TEXT,
        since TEXT,
        evidence_id TEXT,
        alert_emitted INTEGER NOT NULL DEFAULT 0,
        alert_line TEXT
      );

      CREATE TABLE IF NOT EXISTS audit_log (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        audit_id TEXT UNIQUE NOT NULL,
        attempt_id TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT NOT NULL,
        caller_bot TEXT NOT NULL,
        caller_routine TEXT NOT NULL,
        site TEXT NOT NULL,
        view TEXT NOT NULL,
        target TEXT NOT NULL,
        kind TEXT NOT NULL,
        cache TEXT NOT NULL,
        page_loads INTEGER NOT NULL,
        pacing_after_json TEXT NOT NULL,
        gate_before TEXT NOT NULL,
        gate_after TEXT NOT NULL,
        result TEXT NOT NULL,
        error_code TEXT,
        evidence_id TEXT,
        result_id TEXT,
        prev_hash TEXT NOT NULL,
        row_hash TEXT NOT NULL
      );
    `);
  }

  recordEvent(eventType: string, payload: unknown): void {
    this.db
      .prepare('INSERT INTO events (event_type, payload_json, created_at) VALUES (?, ?, ?)')
      .run(eventType, JSON.stringify(payload ?? {}), new Date().toISOString());
  }

  upsertFromActionResult(action: string, data: unknown): void {
    if (!data || typeof data !== 'object') return;
    const obj = data as Record<string, unknown>;
    const now = new Date().toISOString();
    // Never persist a read whose required fields are missing (pilot 2026-11-16 cached
    // `postUrn: "unknown"` and slug-as-name profiles).
    if (Array.isArray(obj.missingRequired) && obj.missingRequired.length > 0) return;

    if (action === 'linkedin.profile.get' && typeof obj.publicIdentifier === 'string') {
      this.db
        .prepare(
          `INSERT INTO profiles (public_identifier, urn, url, full_name, headline, location, about, source, payload_json, captured_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(public_identifier) DO UPDATE SET
             urn = COALESCE(excluded.urn, profiles.urn),
             url = excluded.url,
             full_name = excluded.full_name,
             headline = COALESCE(excluded.headline, profiles.headline),
             location = COALESCE(excluded.location, profiles.location),
             about = COALESCE(excluded.about, profiles.about),
             source = excluded.source,
             payload_json = excluded.payload_json,
             captured_at = excluded.captured_at`,
        )
        .run(
          obj.publicIdentifier,
          typeof obj.urn === 'string' ? obj.urn : null,
          String(obj.url ?? ''),
          String(obj.fullName ?? ''),
          typeof obj.headline === 'string' ? obj.headline : null,
          typeof obj.location === 'string' ? obj.location : null,
          typeof obj.about === 'string' ? obj.about : null,
          String(obj.source ?? 'dom'),
          JSON.stringify(obj),
          String(obj.capturedAt ?? now),
        );
      return;
    }

    if (action === 'linkedin.post.get' && typeof obj.postUrn === 'string') {
      this.db
        .prepare(
          `INSERT INTO posts (post_urn, url, author_name, text, reactions_count, comments_count, source, payload_json, captured_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(post_urn) DO UPDATE SET
             text = excluded.text,
             reactions_count = COALESCE(excluded.reactions_count, posts.reactions_count),
             comments_count = COALESCE(excluded.comments_count, posts.comments_count),
             source = excluded.source,
             payload_json = excluded.payload_json,
             captured_at = excluded.captured_at`,
        )
        .run(
          obj.postUrn,
          String(obj.url ?? ''),
          String(obj.authorName ?? ''),
          String(obj.text ?? ''),
          typeof obj.reactionsCount === 'number' ? obj.reactionsCount : null,
          typeof obj.commentsCount === 'number' ? obj.commentsCount : null,
          String(obj.source ?? 'dom'),
          JSON.stringify(obj),
          String(obj.capturedAt ?? now),
        );
      return;
    }

    if (action === 'linkedin.company.get' && typeof obj.slug === 'string') {
      this.db
        .prepare(
          `INSERT INTO companies (slug, urn, url, name, tagline, industry, size_text, source, payload_json, captured_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(slug) DO UPDATE SET
             name = excluded.name,
             tagline = COALESCE(excluded.tagline, companies.tagline),
             industry = COALESCE(excluded.industry, companies.industry),
             size_text = COALESCE(excluded.size_text, companies.size_text),
             source = excluded.source,
             payload_json = excluded.payload_json,
             captured_at = excluded.captured_at`,
        )
        .run(
          obj.slug,
          typeof obj.urn === 'string' ? obj.urn : null,
          String(obj.url ?? ''),
          String(obj.name ?? ''),
          typeof obj.tagline === 'string' ? obj.tagline : null,
          typeof obj.industry === 'string' ? obj.industry : null,
          typeof obj.sizeText === 'string' ? obj.sizeText : null,
          String(obj.source ?? 'dom'),
          JSON.stringify(obj),
          String(obj.capturedAt ?? now),
        );
      return;
    }

    if (action === 'linkedin.job.get' && typeof obj.jobId === 'string') {
      this.db
        .prepare(
          `INSERT INTO jobs (job_id, url, title, company_name, location, salary_text, source, payload_json, captured_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(job_id) DO UPDATE SET
             title = excluded.title,
             company_name = excluded.company_name,
             location = COALESCE(excluded.location, jobs.location),
             salary_text = COALESCE(excluded.salary_text, jobs.salary_text),
             source = excluded.source,
             payload_json = excluded.payload_json,
             captured_at = excluded.captured_at`,
        )
        .run(
          obj.jobId,
          String(obj.url ?? ''),
          String(obj.title ?? ''),
          String(obj.companyName ?? ''),
          typeof obj.location === 'string' ? obj.location : null,
          typeof obj.salaryText === 'string' ? obj.salaryText : null,
          String(obj.source ?? 'dom'),
          JSON.stringify(obj),
          String(obj.capturedAt ?? now),
        );
      return;
    }

    if (action === 'linkedin.inbox.thread' && typeof obj.threadId === 'string') {
      this.upsertThread(obj, now);
      return;
    }

    if (action === 'linkedin.inbox.list' && Array.isArray(data)) {
      for (const item of data) {
        if (item && typeof item === 'object' && typeof (item as Record<string, unknown>).threadId === 'string') {
          this.upsertThread(item as Record<string, unknown>, now);
        }
      }
      return;
    }

    if (action === 'linkedin.search' && Array.isArray(obj.items)) {
      this.db
        .prepare(
          `INSERT INTO search_runs (category, query, page_url, item_count, payload_json, captured_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          String(obj.category ?? 'people'),
          String(obj.query ?? ''),
          String(obj.pageUrl ?? ''),
          obj.items.length,
          JSON.stringify(obj),
          String(obj.capturedAt ?? now),
        );
      return;
    }

    if (action === 'linkedin.draft.create' && typeof obj.queueId === 'string') {
      this.upsertQueueItem(obj, now);
    }
  }

  private upsertThread(obj: Record<string, unknown>, now: string): void {
    this.db
      .prepare(
        `INSERT INTO threads (thread_id, url, title, unread, last_message_text, source, payload_json, captured_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(thread_id) DO UPDATE SET
           title = excluded.title,
           unread = excluded.unread,
           last_message_text = COALESCE(excluded.last_message_text, threads.last_message_text),
           payload_json = excluded.payload_json,
           captured_at = excluded.captured_at`,
      )
      .run(
        String(obj.threadId),
        String(obj.url ?? ''),
        String(obj.title ?? ''),
        obj.unread ? 1 : 0,
        typeof obj.lastMessageText === 'string' ? obj.lastMessageText : null,
        String(obj.source ?? 'dom'),
        JSON.stringify(obj),
        String(obj.capturedAt ?? now),
      );
  }

  private upsertQueueItem(obj: Record<string, unknown>, now: string): void {
    this.db
      .prepare(
        `INSERT INTO copilot_queue (queue_id, kind, target, body, status, prefilled, sent, payload_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
         ON CONFLICT(queue_id) DO UPDATE SET
           status = excluded.status,
           prefilled = excluded.prefilled,
           payload_json = excluded.payload_json,
           updated_at = excluded.updated_at`,
      )
      .run(
        String(obj.queueId),
        String(obj.kind ?? 'message'),
        String(obj.target ?? ''),
        String(obj.body ?? ''),
        String(obj.status ?? 'pending'),
        obj.prefilled ? 1 : 0,
        JSON.stringify(obj),
        String(obj.updatedAt ?? now),
      );
  }

  queryReadOnlySql(rawSql: string): Record<string, unknown>[] {
    const clean = validateReadOnlySelectSql(rawSql);
    return this.db.prepare(clean).all() as Record<string, unknown>[];
  }

  close(): void {
    this.db.close();
  }
}
