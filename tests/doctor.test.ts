import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { runDoctor } from '../cli/src/commands/doctor.js';
import { startBrokerServer, type RunningBroker } from '../cli/src/daemon/ws-broker.js';
import { PROTOCOL_VERSION } from '../shared/rpc-envelope.js';

const TOKEN = 'dos_doctor_test_token_00112233445566';
let broker: RunningBroker;
const prevEnv = process.env.BROWSER_AGENT_PAIRING_TOKEN;

function pairFakeExtension(port: number, extensionVersion: string): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: 'chrome-extension://doctortest' });
  return new Promise((resolve, reject) => {
    ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', token: TOKEN, extensionVersion, capabilities: {} })));
    ws.on('message', (raw) => {
      if (JSON.parse(raw.toString()).type === 'hello_ok') resolve(ws);
    });
    ws.on('error', reject);
  });
}

const byId = (r: Awaited<ReturnType<typeof runDoctor>>) => Object.fromEntries(r.checks.map((c) => [c.id, c]));

beforeAll(async () => {
  broker = await startBrokerServer({ port: 0, token: TOKEN, dbPath: ':memory:' });
});
afterAll(async () => {
  await broker.close();
});
afterEach(() => {
  if (prevEnv === undefined) delete process.env.BROWSER_AGENT_PAIRING_TOKEN;
  else process.env.BROWSER_AGENT_PAIRING_TOKEN = prevEnv;
});

describe('browser-agent doctor (pilot gap 7: doctor was UNKNOWN_COMMAND)', () => {
  it('reports an unpaired extension with a fix, and never prints the token', async () => {
    process.env.BROWSER_AGENT_PAIRING_TOKEN = TOKEN;
    const report = await runDoctor({ port: broker.port });
    const c = byId(report);
    expect(report.ok).toBe(false);
    expect(c.broker_reachable.ok).toBe(true);
    expect(c.token_present.ok).toBe(true);
    expect(c.token_valid.ok).toBe(true);
    expect(c.protocol_version.ok).toBe(true);
    expect(c.extension_paired).toMatchObject({ ok: false });
    expect(c.extension_paired.fix).toMatch(/daemon token --reveal/);
    expect(JSON.stringify(report)).not.toContain(TOKEN);
  });

  it('all green once the extension pairs with a matching version', async () => {
    process.env.BROWSER_AGENT_PAIRING_TOKEN = TOKEN;
    const ws = await pairFakeExtension(broker.port, PROTOCOL_VERSION);
    try {
      const report = await runDoctor({ port: broker.port });
      expect(report.checks.filter((c) => !c.ok)).toEqual([]);
      expect(report.ok).toBe(true);
    } finally {
      ws.close();
    }
  });

  it('flags an extension version mismatch', async () => {
    process.env.BROWSER_AGENT_PAIRING_TOKEN = TOKEN;
    const ws = await pairFakeExtension(broker.port, '0.1.9');
    try {
      const c = byId(await runDoctor({ port: broker.port }));
      expect(c.extension_version).toMatchObject({ ok: false });
      expect(c.extension_version.fix).toMatch(/reload the unpacked extension/);
    } finally {
      ws.close();
    }
  });

  it('flags a token the daemon rejects', async () => {
    process.env.BROWSER_AGENT_PAIRING_TOKEN = 'dos_wrong_token_aaaaaaaaaaaaaaaaaaaa';
    const report = await runDoctor({ port: broker.port });
    expect(byId(report).token_valid).toMatchObject({ ok: false });
    expect(byId(report).token_valid.fix).toMatch(/different tokens/);
    expect(JSON.stringify(report)).not.toContain('dos_wrong_token_aaaaaaaaaaaaaaaaaaaa');
  });

  it('flags an unreachable broker and tells how to start it', async () => {
    process.env.BROWSER_AGENT_PAIRING_TOKEN = TOKEN;
    const report = await runDoctor({ port: 1 });
    expect(byId(report).broker_reachable).toMatchObject({ ok: false });
    expect(byId(report).broker_reachable.fix).toMatch(/daemon start/);
    expect(report.checks.map((c) => c.id)).toEqual(['broker_reachable', 'token_present']);
  });
});
