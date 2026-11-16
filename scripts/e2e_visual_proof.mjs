import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function findChromeForTesting() {
  if (process.env.CHROME_FOR_TESTING_PATH) return process.env.CHROME_FOR_TESTING_PATH;
  const cacheRoot = join(homedir(), 'Library', 'Caches', 'ms-playwright');
  if (!existsSync(cacheRoot)) return undefined;
  const dirs = readdirSync(cacheRoot).filter((d) => d.startsWith('chromium-')).sort().reverse();
  for (const dir of dirs) {
    const candidate = join(
      cacheRoot,
      dir,
      'chrome-mac-arm64',
      'Google Chrome for Testing.app',
      'Contents',
      'MacOS',
      'Google Chrome for Testing',
    );
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

const CHROME_PATH = findChromeForTesting();

function resolveOutDir() {
  const idx = process.argv.indexOf('--out-dir');
  if (idx !== -1 && process.argv[idx + 1]) {
    return resolve(process.argv[idx + 1]);
  }
  return resolve(ROOT, '.tmp-e2e-proof');
}

function parseCliOutput(rawText) {
  const lines = rawText.trim().split('\n');
  const last = lines[lines.length - 1] ?? '';
  const verdict = last.match(/^AGENT_(?:OK|FAIL)\s+(\{.*\})$/);
  if (verdict) return JSON.parse(verdict[1]);
  return JSON.parse(rawText);
}

function runCli(args, env, allowFailure = false) {
  try {
    const stdout = execFileSync(process.execPath, [resolve(ROOT, 'cli/dist/browser-agent.js'), ...args], {
      cwd: ROOT,
      env: { ...process.env, ...env },
      encoding: 'utf8',
    });
    return { code: 0, json: parseCliOutput(stdout) };
  } catch (err) {
    if (!allowFailure) throw err;
    const e = err;
    const raw = String(e.stdout || e.stderr || '{}');
    return { code: e.status ?? 1, json: parseCliOutput(raw) };
  }
}

async function runMcpCheck(env) {
  return await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [resolve(ROOT, 'cli/dist/browser-agent.js'), 'mcp'], {
      cwd: ROOT,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const responses = [];
    let buffer = '';
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        responses.push(JSON.parse(line));
        if (responses.length === 3) {
          child.kill('SIGTERM');
          resolvePromise(responses);
        }
      }
    });
    child.on('error', rejectPromise);
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })}\n`,
    );
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })}\n`,
    );
    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'linkedin_query_cache',
          arguments: { sql: 'SELECT public_identifier, full_name, source FROM profiles' },
        },
      })}\n`,
    );
  });
}

function startDaemonProcess(cliEnv, port) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(
      process.execPath,
      [resolve(ROOT, 'cli/dist/browser-agent.js'), 'daemon', 'start', '--port', String(port), '--fixtures'],
      {
        cwd: ROOT,
        env: { ...process.env, ...cliEnv },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let settled = false;
    let errBuf = '';
    child.stderr.on('data', (d) => {
      errBuf += d.toString('utf8');
    });
    child.stdout.on('data', (chunk) => {
      if (settled) return;
      const lines = chunk.toString('utf8').split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.ok) {
            settled = true;
            resolvePromise(child);
            return;
          }
        } catch {
          // ignore non-json
        }
      }
    });
    child.once('exit', (code) => {
      if (!settled) {
        rejectPromise(new Error(`Daemon exited early with code ${code}: ${errBuf}`));
      }
    });
    setTimeout(() => {
      if (!settled) {
        child.kill('SIGTERM');
        rejectPromise(new Error(`Daemon startup timeout: ${errBuf}`));
      }
    }, 8000);
  });
}

async function isExtensionAttached(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    const body = await res.json();
    return Boolean(body.extensionConnected);
  } catch {
    return false;
  }
}

async function main() {
  const extDir = resolve(ROOT, 'extension/dist/chromium');
  assert(existsSync(resolve(extDir, 'manifest.json')), 'Run `npm run build` before test:e2e');

  const outDir = resolveOutDir();
  mkdirSync(outDir, { recursive: true });

  const sandboxDir = mkdtempSync(join(tmpdir(), 'dos-browser-agent-e2e-'));
  const userDataDir = join(sandboxDir, 'chrome-profile');
  const dbPath = join(sandboxDir, 'e2e-cache.sqlite');
  const pairingFile = join(sandboxDir, 'pairing.json');
  const token = 'dos_e2e_deterministic_token_2026';
  const port = 4347;

  const cliEnv = {
    BROWSER_AGENT_PORT: String(port),
    BROWSER_AGENT_DB_PATH: dbPath,
    BROWSER_AGENT_PAIRING_FILE: pairingFile,
    BROWSER_AGENT_PAIRING_TOKEN: token,
  };

  let daemonProc = null;
  let context = null;

  try {
    daemonProc = await startDaemonProcess(cliEnv, port);

    const launchArgs = [
      '--headless=new',
      `--disable-extensions-except=${extDir}`,
      `--load-extension=${extDir}`,
      '--no-first-run',
      '--no-default-browser-check',
    ];

    context = await chromium.launchPersistentContext(userDataDir, {
      executablePath: CHROME_PATH,
      headless: false,
      args: launchArgs,
      viewport: { width: 1280, height: 840 },
    });

    let serviceWorker = context.serviceWorkers()[0];
    if (!serviceWorker) {
      serviceWorker = await context.waitForEvent('serviceworker', { timeout: 15_000 });
    }
    const extId = new URL(serviceWorker.url()).host;
    assert(extId.length > 0, 'Extension ID should resolve from MV3 service worker URL');

    // Step A: Open real popup and pair through interactive controls
    const popupPage = await context.newPage();
    await popupPage.setViewportSize({ width: 375, height: 760 });
    await popupPage.goto(`chrome-extension://${extId}/popup.html`, { waitUntil: 'domcontentloaded' });
    await popupPage.fill('#broker-url-input', `ws://127.0.0.1:${port}/ws`);
    await popupPage.fill('#pairing-token-input', token);
    await popupPage.click('#save-pairing-btn');

    const attachDeadline = Date.now() + 10_000;
    while (!(await isExtensionAttached(port)) && Date.now() < attachDeadline) {
      await new Promise((r) => setTimeout(r, 150));
    }
    assert(await isExtensionAttached(port), 'Extension MV3 service worker must connect over ws://127.0.0.1:4347/ws');

    // The pairing token must not stay visible in the popup after a successful connect.
    const tokenField = await popupPage.evaluate(() => {
      const input = document.getElementById('pairing-token-input');
      return { type: input?.getAttribute('type'), empty: input?.value === '' };
    });
    assert.equal(tokenField.type, 'password', 'Pairing token input must be a masked password field');
    assert.equal(tokenField.empty, true, 'Pairing token input must be cleared after a successful connect');

    // Verify popup craft-floor metrics at 375px width
    const uiProbe = await popupPage.evaluate(() => {
      const overflow = document.documentElement.scrollWidth > window.innerWidth;
      const buttons = Array.from(document.querySelectorAll('button, input'));
      const minTargetHeight = Math.min(...buttons.map((b) => Math.round(b.getBoundingClientRect().height)));
      return { overflow, minTargetHeight };
    });
    assert.equal(uiProbe.overflow, false, 'Popup must have zero horizontal overflow at 375px');
    assert(uiProbe.minTargetHeight >= 44, `Popup interactive height >= 44px, got ${uiProbe.minTargetHeight}`);

    // Step B: Open LinkedIn Profile Fixture -> verify accessibility-tree profile read
    const workTab = await context.newPage();
    await workTab.setViewportSize({ width: 1080, height: 720 });
    await workTab.goto(`http://127.0.0.1:${port}/fixture/in/linh-nguyen-staff-ai`, {
      waitUntil: 'networkidle',
    });
    await workTab.waitForTimeout(300);

    const profileRes = runCli(['linkedin', 'profile', '--public-id', 'linh-nguyen-staff-ai', '--json'], cliEnv);
    assert.equal(profileRes.json.ok, true);
    assert.equal(profileRes.json.data.source, 'dom');
    assert.equal(profileRes.json.data.fullName, 'Linh Nguyen');
    assert.equal(profileRes.json.data.headline, 'Staff AI Systems Engineer · Local-First Browser Automation');
    assert.equal(profileRes.json.data.followersCount, 14820);

    // Step C: Search fixture
    await workTab.goto(`http://127.0.0.1:${port}/fixture/search/results/people`, {
      waitUntil: 'networkidle',
    });
    const searchRes = runCli(
      ['linkedin', 'search', '--category', 'people', '--query', 'AI', '--json'],
      cliEnv,
    );
    assert.equal(searchRes.json.ok, true);
    assert.equal(searchRes.json.data.items.length, 2);

    // Step D: Messaging composer Copilot Prefill (NEVER clicks Send!)
    await workTab.goto(`http://127.0.0.1:${port}/fixture/messaging/thread/42`, {
      waitUntil: 'networkidle',
    });
    const draftBody =
      'Hi Linh — reviewed your WebExtensions architecture notes; happy to compare our fenced RPC benchmarks when convenient.';
    const draftRes = runCli(
      [
        'linkedin',
        'draft',
        '--kind',
        'message',
        '--target',
        'linh-nguyen-staff-ai',
        '--body',
        draftBody,
        '--prefill',
        '--json',
      ],
      cliEnv,
    );
    assert.equal(draftRes.json.ok, true);
    assert.equal(draftRes.json.outcome, 'QUEUED_COPILOT');
    assert.equal(draftRes.json.data.prefilled, true);
    assert.equal(draftRes.json.data.sent, false);

    const composerState = await workTab.evaluate(() => ({
      value: document.querySelector('#composer')?.value ?? '',
      sendClicks: window.__sendClickCount,
      prefilledAttr: document.querySelector('#composer')?.getAttribute('data-design-os-prefilled'),
    }));
    assert.equal(composerState.value, draftBody);
    assert.equal(composerState.sendClicks, 0);
    assert.equal(composerState.prefilledAttr, 'true');

    const composerScreenshot = await workTab.screenshot({ type: 'png' });

    // Refresh popup while ONLINE + Queue Pending
    await popupPage.click('#refresh-btn');
    await popupPage.waitForFunction(
      () => document.getElementById('bridge-status-text')?.textContent === 'Broker Online',
      { timeout: 5000 },
    );
    await popupPage.waitForFunction(
      () => document.getElementById('queue-count')?.textContent === '1',
      { timeout: 5000 },
    );
    const popupOnlineShot = await popupPage.screenshot({ type: 'png', fullPage: true });

    // Step E: Query SQLite Cache + MCP stdio server
    const cacheRes = runCli(
      ['linkedin', 'cache', '--sql', 'SELECT public_identifier, full_name, source FROM profiles', '--json'],
      cliEnv,
    );
    assert.equal(cacheRes.json.ok, true);
    assert.equal(cacheRes.json.rows.length, 1);

    const mcpReplies = await runMcpCheck(cliEnv);
    assert.equal(mcpReplies[1].result.tools.length, 22);
    assert.equal(mcpReplies[2].result.isError, false);

    const readerListRes = runCli(['reader', 'list', '--json'], cliEnv);
    assert.equal(readerListRes.json.ok, true);
    assert(readerListRes.json.views.length >= 25);

    const readerProfileRes = runCli(
      [
        'reader',
        'read',
        '--site',
        'linkedin',
        '--view',
        'profile.self',
        '--target',
        `http://127.0.0.1:${port}/fixture/in/linh-nguyen-staff-ai`,
        '--params',
        '{"public_id":"linh-nguyen-staff-ai"}',
        '--json',
      ],
      cliEnv,
    );
    assert.equal(readerProfileRes.json.ok, true);
    assert.equal(readerProfileRes.json.schema, 'dos.reader.v1');
    assert.equal(readerProfileRes.json.source, 'cache');

    // Step F: Security Checkpoint -> immediate BLOCKED_CHALLENGE halt with 0 retries
    await workTab.goto(`http://127.0.0.1:${port}/fixture/checkpoint/challenge`, {
      waitUntil: 'domcontentloaded',
    });
    const blockedStatus = runCli(['linkedin', 'status', '--json'], cliEnv, true);
    assert.equal(blockedStatus.code, 1);
    assert.equal(blockedStatus.json.humanGate, 'BLOCKED_CHALLENGE');

    const blockedRead = runCli(['linkedin', 'profile', '--json'], cliEnv, true);
    assert.equal(blockedRead.code, 1);
    assert.equal(blockedRead.json.humanGate, 'BLOCKED_CHALLENGE');

    const guardTriggerRes = runCli(
      [
        'reader',
        'read',
        '--site',
        'linkedin',
        '--view',
        'profile.self',
        '--target',
        `http://127.0.0.1:${port}/fixture/checkpoint/challenge`,
        '--max-age-s',
        '0',
        '--bot',
        'J',
        '--routine',
        'nightly',
        '--json',
      ],
      cliEnv,
      true,
    );
    assert.equal(guardTriggerRes.json.gate, 'PAUSED_BY_GUARD');

    const guardSecondCaller = runCli(
      [
        'reader',
        'read',
        '--site',
        'linkedin',
        '--view',
        'analytics.content',
        '--max-age-s',
        '0',
        '--bot',
        'Community',
        '--routine',
        'triage',
        '--json',
      ],
      cliEnv,
      true,
    );
    assert.equal(guardSecondCaller.json.gate, 'PAUSED_BY_GUARD');
    assert.equal(guardSecondCaller.json.source, 'cache');

    await popupPage.click('#refresh-btn');
    await popupPage.waitForFunction(
      () =>
        document.getElementById('human-gate-alert')?.hidden === false &&
        document.getElementById('guard-panel')?.hidden === false,
      { timeout: 5000 },
    );
    const guardOverflow = await popupPage.evaluate(() => document.documentElement.scrollWidth > 375);
    assert.equal(guardOverflow, false, 'Popup must have zero horizontal overflow at 375px while #guard-panel is visible');
    const popupBlockedShot = await popupPage.screenshot({ type: 'png', fullPage: true });

    await popupPage.click('#guard-list button');
    await popupPage.waitForFunction(
      () => document.getElementById('guard-panel')?.hidden === true,
      { timeout: 5000 },
    );

    let guardAuditRes;
    const auditStart = Date.now();
    while (Date.now() - auditStart < 3000) {
      const candidate = runCli(
        ['reader', 'audit', '--caller', 'human-popup', '--site', 'linkedin', '--json'],
        cliEnv,
      );
      if (candidate.json?.rows?.length >= 1 && candidate.json.rows[0].gate_after === 'CLEAR') {
        guardAuditRes = candidate;
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    assert(guardAuditRes, 'Expected human-popup audit row with gate_after === CLEAR within 3s');

    // Render visual proof board 1: Dual live Chrome extension Popup states
    const popupBoard = await context.newPage();
    await popupBoard.setViewportSize({ width: 920, height: 840 });
    await popupBoard.setContent(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><style>
  body { margin: 0; background: #ECEAE4; color: #171716; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; padding: 24px; }
  h1 { margin: 0 0 6px; font-size: 18px; }
  p { margin: 0 0 18px; font-size: 13px; color: #52514E; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; align-items: start; }
  .col { background: #FFFFFF; border: 1px solid #DCD9D2; border-radius: 12px; padding: 14px; }
  .label { font-size: 12px; font-weight: 600; color: #52514E; margin-bottom: 10px; }
  img { width: 100%; height: auto; border-radius: 8px; border: 1px solid #E5E3DD; display: block; }
</style></head><body>
  <h1>DESIGN:OS Browser Agent — Live Chrome MV3 Extension Popup Proof</h1>
  <p>Captured from Google Chrome for Testing (extId=${extId}) on ws://127.0.0.1:${port}/ws · Scroll overflow at 375px: false · Min target: ${uiProbe.minTargetHeight}px</p>
  <div class="grid">
    <div class="col">
      <div class="label">State 1 · Broker Online + Copilot Approval Queue (1 Pending)</div>
      <img src="data:image/png;base64,${popupOnlineShot.toString('base64')}" alt="Online popup">
    </div>
    <div class="col">
      <div class="label">State 2 · BLOCKED_CHALLENGE Human Gate Handoff (0 Retries)</div>
      <img src="data:image/png;base64,${popupBlockedShot.toString('base64')}" alt="Blocked popup">
    </div>
  </div>
</body></html>`);
    await popupBoard.screenshot({
      path: resolve(outDir, 'linkedin-extension-popup-copilot.png'),
      fullPage: true,
    });

    // Render visual proof board 2: Prefilled Composer + Zero-Drift Hybrid JSON + Cache/MCP Proof
    const e2eBoard = await context.newPage();
    await e2eBoard.setViewportSize({ width: 1280, height: 820 });
    await e2eBoard.setContent(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><style>
  body { margin: 0; background: #ECEAE4; color: #171716; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; padding: 24px; }
  h1 { margin: 0 0 6px; font-size: 18px; }
  .sub { margin: 0 0 18px; font-size: 13px; color: #52514E; }
  .grid { display: grid; grid-template-columns: 1.05fr 0.95fr; gap: 18px; }
  .card { background: #FFFFFF; border: 1px solid #DCD9D2; border-radius: 12px; padding: 14px; }
  .label { font-size: 12px; font-weight: 600; color: #0A66C2; margin-bottom: 10px; }
  img { width: 100%; border-radius: 8px; border: 1px solid #E5E3DD; display: block; }
  pre { margin: 0; padding: 12px; background: #1C1C1A; color: #EAE8E1; border-radius: 8px; font-size: 12px; line-height: 1.45; overflow: hidden; white-space: pre-wrap; word-break: break-word; }
</style></head><body>
  <h1>LinkedIn Zero-Drift Hybrid Reader + Copilot Safe Prefill E2E</h1>
  <p class="sub">Real Chromium MV3 service worker (no chrome.debugger) · Profile read from the accessibility tree · Send click count = ${composerState.sendClicks}</p>
  <div class="grid">
    <div class="card">
      <div class="label">Live Tab: Messaging Composer Prefilled Without Sending</div>
      <img src="data:image/png;base64,${composerScreenshot.toString('base64')}" alt="Prefilled composer">
    </div>
    <div class="card">
      <div class="label">CLI (--json), SQLite Cache &amp; MCP stdio Verification Output</div>
      <pre>${JSON.stringify(
        {
          hybridProfile: {
            fullName: profileRes.json.data.fullName,
            source: profileRes.json.data.source,
            followersCount: profileRes.json.data.followersCount,
            skills: profileRes.json.data.skills,
          },
          searchResultsCount: searchRes.json.data.items.length,
          copilotDraft: {
            outcome: draftRes.json.outcome,
            prefilled: draftRes.json.data.prefilled,
            sent: draftRes.json.data.sent,
          },
          sqliteCacheRows: cacheRes.json.rows,
          mcpToolsCount: mcpReplies[1].result.tools.length,
          checkpointGate: blockedRead.json.humanGate,
          sharedReader: {
            schema: readerProfileRes.json.schema,
            viewsCount: readerListRes.json.views.length,
            profileSource: readerProfileRes.json.source,
            guardPausedGate: guardTriggerRes.json.gate,
            humanPopupClearRows: guardAuditRes.json.count,
          },
        },
        null,
        2,
      )
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')}</pre>
    </div>
  </div>
</body></html>`);
    await e2eBoard.screenshot({
      path: resolve(outDir, 'linkedin-e2e-zero-drift-proof.png'),
      fullPage: true,
    });

    // Also verify emoji probe constraint doesn't exist in popup HTML
    const popupHtml = readFileSync(resolve(ROOT, 'extension/src/popup/popup.html'), 'utf8');
    assert(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(popupHtml));

    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        extensionId: extId,
        port,
        proofs: [
          resolve(outDir, 'linkedin-extension-popup-copilot.png'),
          resolve(outDir, 'linkedin-e2e-zero-drift-proof.png'),
        ],
      })}\n`,
    );
  } finally {
    if (context) await context.close().catch(() => {});
    if (daemonProc && daemonProc.exitCode === null) {
      daemonProc.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 300));
    }
    rmSync(sandboxDir, { recursive: true, force: true });
  }
}

void main();
