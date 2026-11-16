import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

/** Header carrying the pairing token on HTTP routes (`Authorization: Bearer <token>` also accepted). */
export const TOKEN_HEADER = 'x-browser-agent-token';

const EXTENSION_ORIGIN_RE = /^(chrome-extension|moz-extension|safari-web-extension):\/\/[a-z0-9-]+$/i;

export type GuardFailure = { status: 401 | 403; code: string; message: string };

/**
 * Host must be the loopback name the broker listens on. Rejecting any other Host header
 * defeats DNS rebinding, where an attacker's domain resolves to 127.0.0.1.
 */
export function isAllowedHost(hostHeader: string | undefined, port: number): boolean {
  if (!hostHeader) return false;
  const allowed = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
  return allowed.has(hostHeader.trim().toLowerCase());
}

/**
 * Browsers always send Origin on cross-origin POST and on WebSocket upgrades. Only the
 * extension's own origin is accepted; web pages (http/https, `null`) are refused. Requests
 * with no Origin come from non-browser clients (the CLI, MCP server, curl) and still need
 * the token. `BROWSER_AGENT_ALLOWED_EXTENSION_IDS` (comma separated) can pin the extension ID.
 */
export function isAllowedOrigin(origin: string | undefined, pinnedIds = process.env.BROWSER_AGENT_ALLOWED_EXTENSION_IDS): boolean {
  if (origin === undefined) return true;
  const trimmed = origin.trim();
  if (!EXTENSION_ORIGIN_RE.test(trimmed)) return false;
  const ids = (pinnedIds ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) return true;
  return ids.includes(trimmed.split('://')[1] ?? '');
}

/** Constant-time comparison; hashing first makes the comparison independent of length. */
export function tokenMatches(provided: string | undefined, expected: string): boolean {
  if (!provided || !expected) return false;
  const a = createHash('sha256').update(provided, 'utf8').digest();
  const b = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(a, b);
}

export function extractToken(req: IncomingMessage): string | undefined {
  const header = req.headers[TOKEN_HEADER];
  if (typeof header === 'string' && header.trim()) return header.trim();
  const auth = req.headers.authorization;
  const m = typeof auth === 'string' ? auth.match(/^Bearer\s+(.+)$/i) : null;
  return m?.[1]?.trim() || undefined;
}

/** Host and Origin checks shared by every HTTP route and the WebSocket upgrade. */
export function checkHostAndOrigin(req: IncomingMessage, port: number): GuardFailure | null {
  if (!isAllowedHost(req.headers.host, port)) {
    return { status: 403, code: 'HOST_REJECTED', message: 'Host header must be 127.0.0.1 or localhost on the broker port.' };
  }
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
  if (!isAllowedOrigin(origin)) {
    return { status: 403, code: 'ORIGIN_REJECTED', message: 'Only the browser extension origin or non-browser clients may call the broker.' };
  }
  return null;
}

/** Host + Origin + pairing token, for routes that read data or drive the browser. */
export function checkAuthorizedRequest(req: IncomingMessage, port: number, token: string): GuardFailure | null {
  const hostOrigin = checkHostAndOrigin(req, port);
  if (hostOrigin) return hostOrigin;
  if (!tokenMatches(extractToken(req), token)) {
    return {
      status: 401,
      code: 'UNAUTHORIZED',
      message: `Missing or wrong pairing token. Send it in the ${TOKEN_HEADER} header (the CLI reads it from the pairing file).`,
    };
  }
  return null;
}

/** "dos_1a2b…9f0e" style display form; never the full secret. */
export function redactToken(token: string): string {
  if (token.length <= 12) return '[redacted]';
  return `${token.slice(0, 4)}…${token.slice(-4)} (redacted)`;
}
