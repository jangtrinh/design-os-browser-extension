import { PROTOCOL_VERSION } from '../../../shared/rpc-envelope.js';
import { fetchBrokerHealth, resolveBrokerBaseUrl, type BrokerClientConfig } from '../daemon/client.js';
import { readPairingToken, resolvePairingFilePath } from '../daemon/pairing.js';
import { TOKEN_HEADER } from '../daemon/request-guard.js';

export interface DoctorCheck {
  id: 'broker_reachable' | 'token_present' | 'token_valid' | 'extension_paired' | 'protocol_version' | 'extension_version';
  ok: boolean;
  detail: string;
  fix?: string;
}

export interface DoctorReport {
  ok: boolean;
  brokerUrl: string;
  checks: DoctorCheck[];
}

/** Probes the token with a harmless authenticated read; returns the HTTP status. */
async function probeToken(baseUrl: string, token: string): Promise<number> {
  try {
    const res = await fetch(`${baseUrl}/cache/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [TOKEN_HEADER]: token },
      body: JSON.stringify({ sql: 'SELECT 1 AS ok' }),
      signal: AbortSignal.timeout(2500),
    });
    return res.status;
  } catch {
    return 0;
  }
}

/**
 * Read-only health check: broker reachable, token present and accepted, extension paired,
 * protocol and extension versions match this CLI. Never prints the token.
 */
export async function runDoctor(cfg: BrokerClientConfig = {}): Promise<DoctorReport> {
  const baseUrl = resolveBrokerBaseUrl(cfg);
  const checks: DoctorCheck[] = [];
  const health = await fetchBrokerHealth(cfg);
  const data = health.data ?? {};

  checks.push(
    health.reachable
      ? { id: 'broker_reachable', ok: true, detail: `${baseUrl} answered /health.` }
      : {
          id: 'broker_reachable',
          ok: false,
          detail: `${baseUrl} did not answer (${health.error ?? 'not the browser-agent service'}).`,
          fix: 'Start it with `browser-agent daemon start` (add --port if you changed BROWSER_AGENT_PORT).',
        },
  );

  const token = readPairingToken();
  const tokenSource = process.env.BROWSER_AGENT_PAIRING_TOKEN?.trim()
    ? 'the BROWSER_AGENT_PAIRING_TOKEN environment variable'
    : resolvePairingFilePath();
  checks.push(
    token
      ? { id: 'token_present', ok: true, detail: `Pairing token found in ${tokenSource}.` }
      : {
          id: 'token_present',
          ok: false,
          detail: `No pairing token in ${tokenSource}.`,
          fix: 'Run `browser-agent daemon token` to create one, then restart the daemon.',
        },
  );

  if (health.reachable && token) {
    const status = await probeToken(baseUrl, token);
    checks.push(
      status === 200
        ? { id: 'token_valid', ok: true, detail: 'The daemon accepted the token.' }
        : {
            id: 'token_valid',
            ok: false,
            detail: `The daemon answered ${status || 'nothing'} to an authenticated read.`,
            fix:
              status === 401
                ? 'The CLI and the daemon use different tokens. Check BROWSER_AGENT_PAIRING_TOKEN / BROWSER_AGENT_PAIRING_FILE match the daemon, or restart the daemon.'
                : 'Check that you are calling 127.0.0.1 or localhost on the broker port.',
          },
    );
  }

  if (health.reachable) {
    const paired = data.extensionConnected === true;
    checks.push(
      paired
        ? { id: 'extension_paired', ok: true, detail: 'The browser extension is connected over WebSocket.' }
        : {
            id: 'extension_paired',
            ok: false,
            detail: 'No browser extension is connected.',
            fix: 'Open the extension popup, paste the token from `browser-agent daemon token --reveal`, and click Save & Connect.',
          },
    );

    const brokerProtocol = String(data.protocolVersion ?? 'unknown');
    checks.push(
      brokerProtocol === PROTOCOL_VERSION
        ? { id: 'protocol_version', ok: true, detail: `Daemon and CLI both speak ${PROTOCOL_VERSION}.` }
        : {
            id: 'protocol_version',
            ok: false,
            detail: `Daemon speaks ${brokerProtocol}, CLI speaks ${PROTOCOL_VERSION}.`,
            fix: 'Stop the old daemon and start it again from this build (`npm run build`, then `browser-agent daemon start`).',
          },
    );

    if (paired) {
      const ext = typeof data.extensionVersion === 'string' ? data.extensionVersion : 'unknown';
      checks.push(
        ext === PROTOCOL_VERSION
          ? { id: 'extension_version', ok: true, detail: `Extension ${ext} matches the CLI.` }
          : {
              id: 'extension_version',
              ok: false,
              detail: `Extension reports ${ext}, CLI expects ${PROTOCOL_VERSION}.`,
              fix: 'Run `npm run build` and reload the unpacked extension from extension/dist/<browser>.',
            },
      );
    }
  }

  return { ok: checks.every((c) => c.ok), brokerUrl: baseUrl, checks };
}
