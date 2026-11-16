import { request } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { dispatchCli } from '../cli/src/commands/dispatch.js';
import { isAllowedOrigin, redactToken, tokenMatches } from '../cli/src/daemon/request-guard.js';
import { startBrokerServer, type RunningBroker } from '../cli/src/daemon/ws-broker.js';

const TOKEN = 'dos_test_token_0123456789abcdef0123';
let broker: RunningBroker;

function post(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: Record<string, unknown> }> {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: broker.port,
        path,
        method: 'POST',
        headers: { host: `127.0.0.1:${broker.port}`, 'content-type': 'application/json', ...headers },
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, json: JSON.parse(raw || '{}') }));
      },
    );
    req.on('error', reject);
    req.end(payload);
  });
}

const auth = { 'x-browser-agent-token': TOKEN };

beforeAll(async () => {
  // Ephemeral port for the test only; the product still binds 127.0.0.1:4347.
  broker = await startBrokerServer({ port: 0, token: TOKEN, dbPath: ':memory:' });
});
afterAll(async () => {
  await broker.close();
});

describe('Broker /rpc and /cache/query authentication (pilot gap 5)', () => {
  it('rejects /rpc without a token (401)', async () => {
    const res = await post('/rpc', { action: 'browser.capabilities' });
    expect(res.status).toBe(401);
    expect((res.json.error as { code: string }).code).toBe('UNAUTHORIZED');
  });

  it('rejects /rpc with a wrong token of equal and different length (401)', async () => {
    const same = TOKEN.slice(0, -1) + (TOKEN.endsWith('3') ? '4' : '3');
    expect((await post('/rpc', {}, { 'x-browser-agent-token': same })).status).toBe(401);
    expect((await post('/rpc', {}, { authorization: 'Bearer short' })).status).toBe(401);
  });

  it('rejects /cache/query without a token (401) and serves it with one (200)', async () => {
    expect((await post('/cache/query', { sql: 'SELECT 1 AS one' })).status).toBe(401);
    const ok = await post('/cache/query', { sql: 'SELECT 1 AS one' }, auth);
    expect(ok.status).toBe(200);
    expect(ok.json.rows).toEqual([{ one: 1 }]);
  });

  it('accepts Authorization: Bearer as well', async () => {
    const ok = await post('/cache/query', { sql: 'SELECT 2 AS two' }, { authorization: `Bearer ${TOKEN}` });
    expect(ok.status).toBe(200);
  });

  it('rejects a web-page Origin even with the right token (403, drive-by POST)', async () => {
    for (const origin of ['https://evil.example', 'http://127.0.0.1:8080', 'null']) {
      const res = await post('/rpc', { action: 'browser.capabilities' }, { ...auth, origin });
      expect(res.status).toBe(403);
      expect((res.json.error as { code: string }).code).toBe('ORIGIN_REJECTED');
    }
  });

  it('rejects a foreign Host header even with the right token (403, DNS rebinding)', async () => {
    const res = await post('/cache/query', { sql: 'SELECT 1' }, { ...auth, host: `rebind.evil.example:${broker.port}` });
    expect(res.status).toBe(403);
    expect((res.json.error as { code: string }).code).toBe('HOST_REJECTED');
  });

  it('happy path: extension origin + token reaches the paired extension and gets its reply', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${broker.port}/ws`, { origin: 'chrome-extension://abcdefghijklmnop' });
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', token: TOKEN, capabilities: { tier: 'test' } })));
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'hello_ok') resolve();
        if (msg.type === 'rpc') {
          ws.send(JSON.stringify({ type: 'rpc_result', response: { id: msg.request.id, ok: true, outcome: 'COMMITTED', data: { pong: true } } }));
        }
      });
      ws.on('error', reject);
    });
    const res = await post('/rpc', { action: 'browser.capabilities' }, { ...auth, origin: 'chrome-extension://abcdefghijklmnop' });
    expect(res.status).toBe(200);
    expect(res.json.ok).toBe(true);
    expect(res.json.data).toEqual({ pong: true });
    ws.close();
  });

  it('refuses a WebSocket upgrade from a web page origin', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${broker.port}/ws`, { origin: 'https://evil.example' });
    const status = await new Promise<number>((resolve) => {
      ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
      ws.on('error', () => resolve(-1));
    });
    expect(status).toBe(403);
  });

  it('keeps /health reachable for loopback clients without a token', async () => {
    const res = await fetch(`http://127.0.0.1:${broker.port}/health`);
    expect(res.status).toBe(200);
  });
});

describe('Guard helpers and token output (pilot gap 7)', () => {
  it('compares tokens in constant time and handles missing values', () => {
    expect(tokenMatches(TOKEN, TOKEN)).toBe(true);
    expect(tokenMatches(undefined, TOKEN)).toBe(false);
    expect(tokenMatches('', TOKEN)).toBe(false);
    expect(tokenMatches('x', TOKEN)).toBe(false);
  });

  it('allows only extension origins, optionally pinned by ID', () => {
    expect(isAllowedOrigin(undefined)).toBe(true);
    expect(isAllowedOrigin('moz-extension://1234-abcd', '')).toBe(true);
    expect(isAllowedOrigin('chrome-extension://aaaa', 'bbbb')).toBe(false);
    expect(isAllowedOrigin('chrome-extension://bbbb', 'aaaa,bbbb')).toBe(true);
    expect(isAllowedOrigin('https://www.linkedin.com', '')).toBe(false);
  });

  it('redacts the token', () => {
    const shown = redactToken(TOKEN);
    expect(shown).not.toContain(TOKEN);
    expect(shown).toMatch(/redacted/);
  });

  it('`daemon token` hides the token unless --reveal is passed', async () => {
    const prev = process.env.BROWSER_AGENT_PAIRING_TOKEN;
    process.env.BROWSER_AGENT_PAIRING_TOKEN = TOKEN;
    const writes: string[] = [];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    });
    try {
      await dispatchCli(['daemon', 'token', '--json']);
      expect(writes.join('')).not.toContain(TOKEN);
      expect(writes.join('')).toContain('tokenRedacted');
      writes.length = 0;
      await dispatchCli(['daemon', 'token', '--reveal', '--json']);
      expect(writes.join('')).toContain(TOKEN);
    } finally {
      spy.mockRestore();
      if (prev === undefined) delete process.env.BROWSER_AGENT_PAIRING_TOKEN;
      else process.env.BROWSER_AGENT_PAIRING_TOKEN = prev;
    }
  });
});
