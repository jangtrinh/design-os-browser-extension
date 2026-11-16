import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { EngineCapabilities } from '../../../shared/capability-tier.js';
import {
  DEFAULT_BROKER_HOST,
  DEFAULT_BROKER_PORT,
  PROTOCOL_VERSION,
  type BridgeHelloOk,
  type BridgeRpcMessage,
  type BridgeWireMessage,
  type RpcRequest,
  type RpcResponse,
} from '../../../shared/rpc-envelope.js';
import { LinkedInSqliteCache } from '../db/sqlite-cache.js';
import { renderFixtureRoute } from './fixture-pages.js';
import { loadOrCreatePairingToken } from './pairing.js';

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
  const port = options.port ?? (Number(process.env.BROWSER_AGENT_PORT) || DEFAULT_BROKER_PORT);
  const token = loadOrCreatePairingToken(options.token);
  const cache = new LinkedInSqliteCache(options.dbPath);
  const enableFixtures =
    options.enableFixtures ?? process.env.BROWSER_AGENT_ENABLE_FIXTURE === '1';

  let activeSocket: WebSocket | null = null;
  let extensionCaps: EngineCapabilities | null = null;
  const pendingRpc = new Map<
    string,
    {
      action: string;
      resolve: (res: RpcResponse) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  const server = createServer(async (req, res) => {
    const reqUrl = new URL(req.url ?? '/', `http://${host}:${port}`);

    if (req.method === 'GET' && reqUrl.pathname === '/health') {
      sendJson(res, 200, {
        ok: true,
        service: SERVICE_ID,
        protocolVersion: PROTOCOL_VERSION,
        host,
        port,
        extensionConnected: Boolean(activeSocket && activeSocket.readyState === activeSocket.OPEN),
        extensionCapabilities: extensionCaps,
        dbPath: cache.dbPath,
      });
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
        sendJson(res, 503, {
          ok: false,
          outcome: 'BLOCKED',
          error: {
            code: 'EXTENSION_OFFLINE',
            message:
              'Browser extension is not attached to ws://127.0.0.1:' +
              `${port}/ws. Open the extension popup, paste the pairing token from \`browser-agent daemon token\`, and click Save & Connect.`,
            retryable: true,
          },
        });
        return;
      }

      const id = String(body.id ?? randomUUID());
      const action = String(body.action ?? '');
      const rpcReq: RpcRequest = {
        id,
        action,
        params: (body.params as Record<string, unknown> | undefined) ?? {},
        ...(body.fence ? { fence: body.fence as RpcRequest['fence'] } : {}),
        // Force external callers to 'agent-rpc' so human popup approval cannot be forged.
        callerOrigin: 'agent-rpc',
        timeoutMs: typeof body.timeoutMs === 'number' ? body.timeoutMs : 15_000,
      };

      const timeoutMs = rpcReq.timeoutMs ?? 15_000;
      const rpcResponse = await new Promise<RpcResponse>((resolve) => {
        const timer = setTimeout(() => {
          pendingRpc.delete(id);
          resolve({
            id,
            ok: false,
            outcome: 'UNCERTAIN',
            error: {
              code: 'RPC_BROKER_TIMEOUT',
              message: `Extension did not respond within ${timeoutMs}ms. Reconcile read-only state before retrying.`,
              retryable: false,
            },
          });
        }, timeoutMs);

        pendingRpc.set(id, { action, resolve, timer });
        const wire: BridgeRpcMessage = { type: 'rpc', request: rpcReq };
        activeSocket?.send(JSON.stringify(wire));
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
        const okReply: BridgeHelloOk = {
          type: 'hello_ok',
          serverVersion: PROTOCOL_VERSION,
          protocolVersion: PROTOCOL_VERSION,
        };
        ws.send(JSON.stringify(okReply));
        return;
      }

      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
        return;
      }

      if (msg.type === 'event') {
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
      resolve();
    });
  });

  return {
    host,
    port,
    token,
    cache,
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
