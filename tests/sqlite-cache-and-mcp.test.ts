import { describe, expect, it } from 'vitest';
import {
  LinkedInSqliteCache,
  validateReadOnlySelectSql,
} from '../cli/src/db/sqlite-cache.js';
import {
  handleMcpJsonRpcMessage,
  MCP_TOOLS,
} from '../cli/src/mcp/stdio-server.js';
import {
  decodeNativeFrame,
  encodeNativeFrame,
} from '../shared/native-framing.js';

describe('Native framing, SQLite cache, and MCP stdio server', () => {
  it('encodes 32-bit UTF-8 byte length accurately for multibyte JSON payloads', () => {
    const sample = { op: 'snapshot', label: 'Tìm kiếm hồ sơ tiếng Việt' };
    const encoded = encodeNativeFrame(sample);
    const decoded = decodeNativeFrame(encoded);
    expect(decoded.payload).toEqual(sample);
    expect(decoded.byteLength).toBeGreaterThan(JSON.stringify(sample).length);
    expect(decoded.bytesConsumed).toBe(encoded.byteLength);
  });

  it('stores LinkedIn reads in SQLite and blocks write/multi-statement SQL queries', () => {
    const cache = new LinkedInSqliteCache(':memory:');
    try {
      cache.upsertFromActionResult('linkedin.profile.get', {
        publicIdentifier: 'linh-nguyen',
        url: 'https://www.linkedin.com/in/linh-nguyen/',
        fullName: 'Linh Nguyen',
        headline: 'Staff AI Systems Engineer',
        source: 'hybrid',
        capturedAt: '2026-11-16T00:00:00.000Z',
      });

      const rows = cache.queryReadOnlySql(
        "SELECT public_identifier, full_name, source FROM profiles WHERE full_name LIKE '%Linh%'",
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].full_name).toBe('Linh Nguyen');

      // String literal containing keyword 'UPDATE' is safe inside SELECT
      expect(() =>
        validateReadOnlySelectSql("SELECT * FROM profiles WHERE headline = 'UPDATE'"),
      ).not.toThrow();

      // Write statements and chained queries are strictly rejected
      expect(() => validateReadOnlySelectSql('DELETE FROM profiles')).toThrow(/SQL_READ_ONLY_VIOLATION/);
      expect(() => validateReadOnlySelectSql('SELECT * FROM profiles; DROP TABLE profiles')).toThrow(
        /SQL_READ_ONLY_VIOLATION/,
      );
      expect(() => validateReadOnlySelectSql('PRAGMA table_info(profiles)')).toThrow(
        /SQL_READ_ONLY_VIOLATION/,
      );
    } finally {
      cache.close();
    }
  });

  it('answers MCP initialize and tools/list across all 22 tools', async () => {
    const initReply = await handleMcpJsonRpcMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {},
    });
    expect((initReply?.result as Record<string, unknown>)?.protocolVersion).toBe('2025-03-26');

    const listReply = await handleMcpJsonRpcMessage({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    });
    const tools = (listReply?.result as { tools: typeof MCP_TOOLS }).tools;
    expect(tools).toHaveLength(22);
    expect(tools.map((t) => t.name)).toContain('reader_list');
    expect(tools.map((t) => t.name)).toContain('reader_read');
    expect(tools.map((t) => t.name)).toContain('reader_query_cache');
    expect(tools.map((t) => t.name)).toContain('reader_check');
    expect(tools.map((t) => t.name)).toContain('pacing_status');
    expect(tools.map((t) => t.name)).toContain('guard_status');
    expect(tools.map((t) => t.name)).toContain('evidence_get');
    expect(tools.map((t) => t.name)).toContain('audit_query');
    expect(tools.map((t) => t.name)).toContain('linkedin_read_analytics');
    expect(tools.map((t) => t.name)).toContain('linkedin_read_comments');
    expect(tools.map((t) => t.name)).toContain('linkedin_get_profile');
    expect(tools.map((t) => t.name)).toContain('linkedin_draft_write');
    expect(tools.map((t) => t.name)).toContain('linkedin_query_cache');
  });
});
