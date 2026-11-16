import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';
import type { EngineCapabilities } from '../../../shared/capability-tier.js';
import type {
  CollectedPageSnapshot,
  EvidenceMode,
  ReaderCaller,
  ReaderCheckKind,
  ReaderGateState,
  ReaderSiteId,
} from '../../../shared/reader-schema.js';
import {
  DEFAULT_BROKER_HOST,
  DEFAULT_BROKER_PORT,
  PROTOCOL_VERSION,
  type BridgeGuardSyncMessage,
  type BridgeHelloOk,
  type BridgeRpcMessage,
  type BridgeWireMessage,
  type RpcRequest,
  type RpcResponse,
} from '../../../shared/rpc-envelope.js';
import { LinkedInSqliteCache } from '../db/sqlite-cache.js';
import { ReaderRuntime } from '../reader/reader-runtime.js';
import { renderFixtureRoute } from './fixture-pages.js';
import { loadOrCreatePairingToken } from './pairing.js';
import { checkAuthorizedRequest, checkHostAndOrigin, type GuardFailure } from './request-guard.js';

export interface BrokerOptions {
  host?: string;
  port?: number;
  token?: string;
  dbPath?: string;
  enableFixtures?: boolean;
}

export interface RunningBroker {
  host: string;
  port: number;
  token: string;
  cache: LinkedInSqliteCache;
  reader: ReaderRuntime;
  close(): Promise<void>;
  getExtensionCapabilities(): EngineCapabilities | null;
  isExtensionConnected(): boolean;
}

const SERVICE_ID = 'design-os-browser-agent';

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendGuardFailure(res: ServerResponse, failure: GuardFailure): void {
  sendJson(res, failure.status, {
    ok: false,
    outcome: 'BLOCKED',
    error: { code: failure.code, message: failure.message, retryable: false },
  });
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  return JSON.parse(raw) as Record<string, unknown>;
}

export async function startBrokerServer(options: BrokerOptions = {}): Promise<RunningBroker> {
  const host = options.host ?? DEFAULT_BROKER_HOST;
  let port = options.port ?? (Number(process.env.BROWSER_AGENT_PORT) || DEFAULT_BROKER_PORT);
  const token = loadOrCreatePairingToken(options.token);
  const cache = new LinkedInSqliteCache(options.dbPath);
  const enableFixtures =
    options.enableFixtures ?? process.env.BROWSER_AGENT_ENABLE_FIXTURE === '1';

  let activeSocket: WebSocket | null = null;
  let extensionCaps: EngineCapabilities | null = null;
  let extensionVersion: string | null = null;
  const pendingRpc = new Map<
    string,
    {
      action: string;
      resolve: (res: RpcResponse) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  const dispatchExtensionRpc = (rpcReq: RpcRequest): Promise<RpcResponse> => {
    if (!activeSocket || activeSocket.readyState !== activeSocket.OPEN) {
      return Promise.resolve({
        id: rpcReq.id,
        ok: false,
        outcome: 'BLOCKED',
        error: {
          code: 'EXTENSION_OFFLINE',
          message:
            'Browser extension is not attached to ws://127.0.0.1:' +
            `${port}/ws. Open the extension popup, paste the pairing token from \`browser-agent daemon token --reveal\`, and click Save & Connect.`,
          retryable: true,
        },
      });
    }
    const timeoutMs = rpcReq.timeoutMs ?? 15_000;
    return new Promise<RpcResponse>((resolve) => {
      const timer = setTimeout(() => {
        pendingRpc.delete(rpcReq.id);
        resolve({
          id: rpcReq.id,
          ok: false,
          outcome: 'UNCERTAIN',
          error: {
            code: 'RPC_BROKER_TIMEOUT',
            message: `Extension did not respond within ${timeoutMs}ms. Reconcile read-only state before retrying.`,
            retryable: false,
          },
        });
      }, timeoutMs);

      pendingRpc.set(rpcReq.id, { action: rpcReq.action, resolve, timer });
      const wire: BridgeRpcMessage = { type: 'rpc', request: rpcReq };
      activeSocket?.send(JSON.stringify(wire));
    });
  };

  const reader = new ReaderRuntime({
    cache,
    allowFixtureLoopback: enableFixtures,
    onGuardChange: (guards) => {
      if (activeSocket && activeSocket.readyState === activeSocket.OPEN) {
        const msg: BridgeGuardSyncMessage = { type: 'guard_sync', guards };
        activeSocket.send(JSON.stringify(msg));
      }
    },
    collectPage: async (req) => {
      const rpcRes = await dispatchExtensionRpc({
        id: randomUUID(),
        action: 'reader.collect',
        params: {
          url: req.targetUrl,
          scrollSteps: typeof req.params.scroll_steps === 'number' ? req.params.scroll_steps : 0,
          captureScreenshot: req.captureScreenshot,
        },
        callerOrigin: 'agent-rpc',
        timeoutMs: 20_000,
      });
      const payload = (rpcRes.data ?? {}) as {
        snapshot?: CollectedPageSnapshot;
        screenshotBase64?: string;
        gateReason?: string;
      };
      return {
        ok: rpcRes.ok,
        snapshot: payload.snapshot,
        screenshotBase64: payload.screenshotBase64,
        gate: rpcRes.humanGate as ReaderGateState | undefined,
        gateReason: payload.gateReason ?? rpcRes.error?.message,
        error_code: rpcRes.error?.code,
        message: rpcRes.error?.message,
      };
    },
  });

  const server = createServer(async (req, res) => {
    const reqUrl = new URL(req.url ?? '/', `http://${host}:${port}`);

    const hostOrigin = checkHostAndOrigin(req, port);
    if (hostOrigin) {
      sendGuardFailure(res, hostOrigin);
      return;
    }

    if (
      (req.method === 'POST' && (reqUrl.pathname === '/rpc' || reqUrl.pathname === '/cache/query')) ||
      reqUrl.pathname.startsWith('/reader/')
    ) {
      const authFailure = checkAuthorizedRequest(req, port, token);
      if (authFailure) {
        sendGuardFailure(res, authFailure);
        return;
      }
    }

    if (req.method === 'GET' && reqUrl.pathname === '/health') {
      sendJson(res, 200, {
        ok: true,
        service: SERVICE_ID,
        protocolVersion: PROTOCOL_VERSION,
        host,
        port,
        extensionConnected: Boolean(activeSocket && activeSocket.readyState === activeSocket.OPEN),
        extensionCapabilities: extensionCaps,
        extensionVersion,
        dbPath: cache.dbPath,
      });
      return;
    }

    if (req.method === 'POST' && reqUrl.pathname === '/reader/list') {
      const body = await readJsonBody(req).catch((): Record<string, unknown> => ({}));
      const site = typeof body.site === 'string' ? (body.site as ReaderSiteId) : undefined;
      sendJson(res, 200, { ok: true, views: reader.listViews(site) });
      return;
    }

    if (req.method === 'POST' && reqUrl.pathname === '/reader/read') {
      const body = await readJsonBody(req).catch((): Record<string, unknown> => ({}));
      const caller = (body.caller as ReaderCaller | undefined) ?? { bot: 'cli', routine: 'manual' };
      const envelope = await reader.read({
        site: String(body.site ?? 'generic') as ReaderSiteId,
        view: String(body.view ?? ''),
        target: typeof body.target === 'string' ? body.target : undefined,
        params: (body.params as Record<string, unknown> | undefined) ?? {},
        max_age_s: typeof body.max_age_s === 'number' ? body.max_age_s : undefined,
        evidence: (body.evidence as EvidenceMode | undefined) ?? 'json',
        caller,
      });
      sendJson(res, 200, envelope);
      return;
    }

    if (req.method === 'POST' && reqUrl.pathname === '/reader/check') {
      const body = await readJsonBody(req).catch((): Record<string, unknown> => ({}));
      const caller = (body.caller as ReaderCaller | undefined) ?? { bot: 'cli', routine: 'manual' };
      const envelope = await reader.check(
        String(body.check ?? '') as ReaderCheckKind,
        (body.params as Record<string, unknown> | undefined) ?? {},
        caller,
      );
      sendJson(res, 200, envelope);
      return;
    }

    if (req.method === 'POST' && reqUrl.pathname === '/reader/query') {
      try {
        const body = await readJsonBody(req);
        sendJson(res, 200, reader.queryCache(body as Parameters<ReaderRuntime['queryCache']>[0]));
      } catch (err) {
        sendJson(res, 400, { ok: false, error: { code: 'SQL_QUERY_REJECTED', message: err instanceof Error ? err.message : String(err) } });
      }
      return;
    }

    if (req.method === 'POST' && reqUrl.pathname === '/reader/pacing') {
      const body = await readJsonBody(req).catch((): Record<string, unknown> => ({}));
      const site = typeof body.site === 'string' ? (body.site as ReaderSiteId) : undefined;
      sendJson(res, 200, { ok: true, pacing: reader.pacingStatus(site) });
      return;
    }

    if (req.method === 'POST' && reqUrl.pathname === '/reader/guard') {
      const body = await readJsonBody(req).catch((): Record<string, unknown> => ({}));
      const site = typeof body.site === 'string' ? (body.site as ReaderSiteId) : undefined;
      sendJson(res, 200, { ok: true, guards: reader.guardStatus(site) });
      return;
    }

    if (req.method === 'POST' && reqUrl.pathname === '/reader/evidence') {
      const body = await readJsonBody(req).catch((): Record<string, unknown> => ({}));
      const result = reader.getEvidence(String(body.evidence_id ?? ''));
      sendJson(res, result.ok ? 200 : 404, result);
      return;
    }

    if (req.method === 'POST' && reqUrl.pathname === '/reader/audit') {
      const body = await readJsonBody(req).catch((): Record<string, unknown> => ({}));
      sendJson(res, 200, reader.queryAudit(body as Parameters<ReaderRuntime['queryAudit']>[0]));
      return;
    }

    if (req.method === 'POST' && reqUrl.pathname === '/cache/query') {
      try {
        const body = await readJsonBody(req);
        const rows = cache.queryReadOnlySql(String(body.sql ?? ''));
        sendJson(res, 200, { ok: true, count: rows.length, rows });
      } catch (err) {
        sendJson(res, 400, {
          ok: false,
          error: {
            code: 'SQL_QUERY_REJECTED',
            message: err instanceof Error ? err.message : String(err),
          },
        });
      }
      return;
    }

    if (req.method === 'POST' && reqUrl.pathname === '/rpc') {
      let body: Record<string, unknown>;
      try {
        body = await readJsonBody(req);
      } catch {
        sendJson(res, 400, {
          ok: false,
          outcome: 'BLOCKED',
          error: { code: 'INVALID_JSON', message: 'Invalid JSON request body.' },
        });
        return;
      }

      if (!activeSocket || activeSocket.readyState !== activeSocket.OPEN) {
        sendJson(res, 503, await dispatchExtensionRpc({ id: 'offline', action: '', params: {} }));
        return;
      }

      const id = String(body.id ?? randomUUID());
      const action = String(body.action ?? '');
      const rpcResponse = await dispatchExtensionRpc({
        id,
        action,
        params: (body.params as Record<string, unknown> | undefined) ?? {},
        ...(body.fence ? { fence: body.fence as RpcRequest['fence'] } : {}),
        callerOrigin: 'agent-rpc',
        timeoutMs: typeof body.timeoutMs === 'number' ? body.timeoutMs : 15_000,
      });

      sendJson(res, 200, rpcResponse);
      return;
    }

    if (req.method === 'GET' && enableFixtures && reqUrl.pathname.startsWith('/fixture/')) {
      const fixture = renderFixtureRoute(reqUrl.pathname);
      if (fixture) {
        res.writeHead(fixture.status, {
          'content-type': fixture.contentType,
          'content-length': Buffer.byteLength(fixture.body),
        });
        res.end(fixture.body);
        return;
      }
    }

    sendJson(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: 'Route not found.' } });
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const reqUrl = new URL(req.url ?? '/', `http://${host}:${port}`);
    if (reqUrl.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    const failure = checkHostAndOrigin(req, port);
    if (failure) {
      socket.end(`HTTP/1.1 ${failure.status} Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws);
    });
  });

  wss.on('connection', (ws) => {
    let authed = false;

    ws.on('message', (rawBuf) => {
      let msg: BridgeWireMessage;
      try {
        msg = JSON.parse(rawBuf.toString('utf8')) as BridgeWireMessage;
      } catch {
        return;
      }

      if (!authed) {
        if (msg.type !== 'hello' || msg.token !== token) {
          ws.close(4001, 'UNAUTHORIZED');
          return;
        }
        authed = true;
        if (activeSocket && activeSocket !== ws && activeSocket.readyState === activeSocket.OPEN) {
          activeSocket.close(1000, 'replaced_by_newer_session');
        }
        activeSocket = ws;
        extensionCaps = msg.capabilities;
        extensionVersion = typeof msg.extensionVersion === 'string' ? msg.extensionVersion : null;
        const okReply: BridgeHelloOk = {
          type: 'hello_ok',
          serverVersion: PROTOCOL_VERSION,
          protocolVersion: PROTOCOL_VERSION,
        };
        ws.send(JSON.stringify(okReply));
        const guardSync: BridgeGuardSyncMessage = {
          type: 'guard_sync',
          guards: reader.guard.listGuards(),
        };
        ws.send(JSON.stringify(guardSync));
        return;
      }

      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
        return;
      }

      if (msg.type === 'event') {
        if (
          msg.event === 'guard_resolved_by_human_popup' &&
          msg.payload?.callerOrigin === 'extension-popup' &&
          typeof msg.payload?.site === 'string'
        ) {
          reader.guard.resolveByHumanPopup(msg.payload.site as ReaderSiteId, 'extension-popup');
        }
        cache.recordEvent(msg.event, msg.payload);
        return;
      }

      if (msg.type === 'rpc_result') {
        const entry = pendingRpc.get(msg.response.id);
        if (!entry) return;
        clearTimeout(entry.timer);
        pendingRpc.delete(msg.response.id);
        if (msg.response.ok && msg.response.data !== undefined) {
          try {
            cache.upsertFromActionResult(entry.action, msg.response.data);
            if (entry.action.startsWith('linkedin.') && typeof msg.response.data === 'object' && msg.response.data !== null) {
              reader.mirrorLegacyLinkedInRead(entry.action, msg.response.data as Record<string, unknown>);
            }
          } catch {
            // Do not fail RPC delivery if SQLite cache indexing hits an unexpected shape
          }
        }
        entry.resolve(msg.response);
      }
    });

    ws.on('close', () => {
      if (activeSocket === ws) {
        activeSocket = null;
        extensionCaps = null;
        extensionVersion = null;
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException): void => {
      reject(
        err.code === 'EADDRINUSE'
          ? new Error(`PORT_IN_USE: 127.0.0.1:${port} is already bound. Check \`browser-agent daemon status\`.`)
          : err,
      );
    };
    server.once('error', onError);
    server.listen(port, host, () => {
      server.removeListener('error', onError);
      port = (server.address() as AddressInfo).port;
      resolve();
    });
  });

  return {
    host,
    port,
    token,
    cache,
    reader,
    getExtensionCapabilities: () => extensionCaps,
    isExtensionConnected: () => Boolean(activeSocket && activeSocket.readyState === activeSocket.OPEN),
    async close() {
      for (const [, pending] of pendingRpc) {
        clearTimeout(pending.timer);
      }
      pendingRpc.clear();
      for (const client of wss.clients) {
        try {
          client.close(1001, 'broker_shutdown');
        } catch {
          // ignore
        }
      }
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
      cache.close();
    },
  };
}
