import {
  DEFAULT_BROKER_HOST,
  DEFAULT_BROKER_PORT,
  type RpcRequest,
  type RpcResponse,
} from '../../../shared/rpc-envelope.js';
import { LinkedInSqliteCache } from '../db/sqlite-cache.js';
import { readPairingToken } from './pairing.js';
import { TOKEN_HEADER } from './request-guard.js';

function authHeaders(): Record<string, string> {
  const token = readPairingToken();
  return { 'content-type': 'application/json', ...(token ? { [TOKEN_HEADER]: token } : {}) };
}

export interface BrokerClientConfig {
  host?: string;
  port?: number;
}

export function resolveBrokerBaseUrl(cfg: BrokerClientConfig = {}): string {
  const host = cfg.host ?? DEFAULT_BROKER_HOST;
  const port = cfg.port ?? (Number(process.env.BROWSER_AGENT_PORT) || DEFAULT_BROKER_PORT);
  return `http://${host}:${port}`;
}

export async function fetchBrokerHealth(cfg: BrokerClientConfig = {}): Promise<{
  reachable: boolean;
  service?: string;
  data?: Record<string, unknown>;
  error?: string;
}> {
  const baseUrl = resolveBrokerBaseUrl(cfg);
  try {
    const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(2500) });
    const data = (await res.json()) as Record<string, unknown>;
    return {
      reachable: res.ok && data.service === 'design-os-browser-agent',
      service: typeof data.service === 'string' ? data.service : undefined,
      data,
    };
  } catch (err) {
    return {
      reachable: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function callBrokerRpc(
  action: string,
  params: Record<string, unknown> = {},
  options: {
    host?: string;
    port?: number;
    fence?: RpcRequest['fence'];
    timeoutMs?: number;
  } = {},
): Promise<RpcResponse> {
  const baseUrl = resolveBrokerBaseUrl(options);
  try {
    const res = await fetch(`${baseUrl}/rpc`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        action,
        params,
        ...(options.fence ? { fence: options.fence } : {}),
        ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
      }),
      signal: AbortSignal.timeout((options.timeoutMs ?? 15_000) + 1500),
    });
    return (await res.json()) as RpcResponse;
  } catch (err) {
    return {
      id: 'cli_offline',
      ok: false,
      outcome: 'BLOCKED',
      error: {
        code: 'BROKER_UNREACHABLE',
        message:
          `Cannot reach ${baseUrl}. Start the daemon with \`browser-agent daemon start\`. (${err instanceof Error ? err.message : String(err)})`,
        retryable: true,
      },
    };
  }
}

export async function queryCacheWithFallback(
  sql: string,
  cfg: BrokerClientConfig = {},
): Promise<{ ok: boolean; count?: number; rows?: Record<string, unknown>[]; error?: { code: string; message: string } }> {
  const baseUrl = resolveBrokerBaseUrl(cfg);
  try {
    const res = await fetch(`${baseUrl}/cache/query`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ sql }),
      signal: AbortSignal.timeout(3000),
    });
    return (await res.json()) as { ok: boolean; count?: number; rows?: Record<string, unknown>[] };
  } catch {
    // Allow read-only SQLite cache queries directly even when browser broker daemon is offline.
    const cache = new LinkedInSqliteCache();
    try {
      const rows = cache.queryReadOnlySql(sql);
      return { ok: true, count: rows.length, rows };
    } catch (err) {
      return {
        ok: false,
        error: {
          code: 'SQL_QUERY_REJECTED',
          message: err instanceof Error ? err.message : String(err),
        },
      };
    } finally {
      cache.close();
    }
  }
}
