/**
 * Vitest setup: keep every test file out of the real user data dir
 * (~/.design-os-browser-extension). Each test file gets its own temp root;
 * evidence bundles, the SQLite cache, the audit log and the pairing file
 * all resolve inside it. Tests that set these env vars themselves still
 * win, and they restore back to the temp values, never to the real dir.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'vitest';

const root = mkdtempSync(join(tmpdir(), 'browser-agent-test-'));

const isolated: Record<string, string> = {
  BROWSER_AGENT_EVIDENCE_DIR: join(root, 'evidence'),
  BROWSER_AGENT_CACHE_PATH: join(root, 'cache.sqlite'),
  BROWSER_AGENT_AUDIT_DIR: join(root, 'audit'),
  BROWSER_AGENT_PAIRING_FILE: join(root, 'pairing.json'),
};

const previous: Record<string, string | undefined> = {};
for (const [key, value] of Object.entries(isolated)) {
  previous[key] = process.env[key];
  process.env[key] = value;
}
// BROWSER_AGENT_DB_PATH is a legacy alias read after CACHE_PATH; drop any
// inherited value so it cannot point a test at a real database.
previous.BROWSER_AGENT_DB_PATH = process.env.BROWSER_AGENT_DB_PATH;
delete process.env.BROWSER_AGENT_DB_PATH;

afterAll(() => {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(root, { recursive: true, force: true });
});
