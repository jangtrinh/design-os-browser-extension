import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface PairingConfig {
  token: string;
  createdAt: string;
}

export function resolvePairingFilePath(): string {
  return (
    process.env.BROWSER_AGENT_PAIRING_FILE?.trim() ||
    join(homedir(), '.design-os-browser-extension', 'pairing.json')
  );
}

export function loadOrCreatePairingToken(explicitToken?: string): string {
  if (explicitToken && explicitToken.trim()) {
    return explicitToken.trim();
  }
  const envToken = process.env.BROWSER_AGENT_PAIRING_TOKEN?.trim();
  if (envToken) {
    return envToken;
  }

  const filePath = resolvePairingFilePath();
  if (existsSync(filePath)) {
    try {
      const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<PairingConfig>;
      if (parsed.token && parsed.token.length >= 16) {
        return parsed.token;
      }
    } catch {
      // Regenerate malformed pairing file cleanly
    }
  }

  const token = `dos_${randomBytes(18).toString('hex')}`;
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
  const record: PairingConfig = { token, createdAt: new Date().toISOString() };
  writeFileSync(filePath, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  return token;
}
