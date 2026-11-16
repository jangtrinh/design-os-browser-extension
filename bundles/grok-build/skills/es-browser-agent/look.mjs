#!/usr/bin/env node
/** Render a 4-panel visual look sheet for an `es-browser-agent` run and enforce L1-L4 checks. */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';

function usage() {
  process.stdout.write('Usage: node look.mjs --repo-root <dir> --output-dir <run-dir> --sheet <out.png>\n');
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    if (k === '--help' || k === '-h') return { help: true };
    if (k.startsWith('--') && argv[i + 1]) {
      args[k.slice(2)] = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

function findChromium() {
  if (process.env.CHROME_FOR_TESTING_PATH && existsSync(process.env.CHROME_FOR_TESTING_PATH)) {
    return process.env.CHROME_FOR_TESTING_PATH;
  }
  const cacheRoot = join(homedir(), 'Library', 'Caches', 'ms-playwright');
  if (!existsSync(cacheRoot)) return undefined;
  const dirs = readdirSync(cacheRoot).filter((d) => d.startsWith('chromium-')).sort().reverse();
  for (const dir of dirs) {
    const bin = join(
      cacheRoot,
      dir,
      'chrome-mac-arm64',
      'Google Chrome for Testing.app',
      'Contents',
      'MacOS',
      'Google Chrome for Testing',
    );
    if (existsSync(bin)) return bin;
  }
  return undefined;
}

function escapeHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    process.exit(0);
  }
  if (!args['repo-root'] || !args['output-dir'] || !args.sheet) {
    usage();
    process.exit(2);
  }

  const repoRoot = resolve(args['repo-root']);
  const runDir = resolve(args['output-dir']);
  const sheetPath = resolve(args.sheet);

  const browserPath = findChromium();
  if (!browserPath) {
    process.stdout.write('LOOK: NOT RUN — browser runtime or local Chromium cache is unavailable.\n');
    process.exit(2);
  }

  const require = createRequire(import.meta.url);
  let playwright;
  try {
    playwright = require(join(repoRoot, 'node_modules/playwright-core'));
  } catch {
    process.stdout.write('LOOK: NOT RUN — browser runtime or local Chromium cache is unavailable.\n');
    process.exit(2);
  }

  const receipt = JSON.parse(readFileSync(join(runDir, 'receipt.json'), 'utf8'));
  const stepsData = JSON.parse(readFileSync(join(runDir, 'steps-output.json'), 'utf8'));
  const cacheRows = JSON.parse(readFileSync(join(runDir, 'cache-rows.json'), 'utf8'));

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>es-browser-agent Look Sheet</title>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  body { margin: 0; background: #ECEAE4; color: #171716; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 15px; line-height: 1.45; }
  main { width: 1360px; margin: 0 auto; padding: 24px; }
  header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 16px; }
  h1 { margin: 0; font-size: 22px; }
  .meta { font-size: 14px; color: #52514E; }
  .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
  .panel { background: #FFFFFF; border: 1px solid #DCD9D2; border-radius: 12px; padding: 16px; }
  .panel h2 { margin: 0 0 10px; font-size: 16px; color: #0A66C2; }
  .pill { display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; background: #E8F5EE; color: #125E3A; }
  .pill-blocked { background: #FCECE9; color: #9E1F15; }
  pre { margin: 8px 0 0; padding: 12px; background: #1C1C1A; color: #EAE8E1; border-radius: 8px; font-size: 12px; line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; }
</style></head><body>
<main>
  <header>
    <h1>es-browser-agent — Skill Run Inspection Sheet</h1>
    <span class="meta">spec=${escapeHtml(receipt.specName)} · mode=${escapeHtml(receipt.mode)} · contract=${escapeHtml(String(receipt.contractSha256).slice(0, 12))}</span>
  </header>
  <div class="grid">
    <section class="panel">
      <h2>L1 · Run Receipt &amp; Zero-Debugger Policy</h2>
      <span class="pill">debuggerAttached=${escapeHtml(String(receipt.debuggerAttached))}</span>
      <pre>${escapeHtml(JSON.stringify({ specName: receipt.specName, concept: receipt.concept, targetUrl: receipt.targetUrl, contractSha256: receipt.contractSha256 }, null, 2))}</pre>
    </section>
    <section class="panel">
      <h2>L2 · SQLite Cache Pre-Check &amp; Hybrid Rows</h2>
      <span class="pill">rows=${escapeHtml(String(cacheRows.length))}</span>
      <pre>${escapeHtml(JSON.stringify({ sql: receipt.cacheCheck?.sql, rows: cacheRows }, null, 2))}</pre>
    </section>
    <section class="panel">
      <h2>L3 · Fenced Dispatch &amp; Copilot Safety (sent=false)</h2>
      <span class="pill">queue=${escapeHtml(String(stepsData.copilotQueue?.length ?? 0))}</span>
      <pre>${escapeHtml(JSON.stringify({ fencePolicy: receipt.fencePolicy, copilotQueue: stepsData.copilotQueue }, null, 2))}</pre>
    </section>
    <section class="panel">
      <h2>L4 · Human Gate Handoff &amp; Agent Approval Guard</h2>
      <span class="${receipt.humanGate === 'CLEAR' ? 'pill' : 'pill pill-blocked'}">${escapeHtml(String(receipt.humanGate))}</span>
      <pre>${escapeHtml(JSON.stringify({ humanGate: receipt.humanGate, postBlockRetries: receipt.postBlockRetries, agentSelfApprovalBlocked: receipt.agentSelfApprovalBlocked, steps: stepsData.steps }, null, 2))}</pre>
    </section>
  </div>
</main></body></html>`;

  mkdirSync(dirname(sheetPath), { recursive: true });
  const browser = await playwright.chromium.launch({
    executablePath: browserPath,
    headless: true,
    args: ['--no-sandbox'],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.route('**/*', (route) => {
      const url = route.request().url();
      if (url === 'about:blank' || url.startsWith('data:')) {
        return route.continue();
      }
      return route.abort();
    });
    await page.setContent(html, { waitUntil: 'domcontentloaded' });

    const metrics = await page.evaluate(() => {
      const panels = Array.from(document.querySelectorAll('section.panel'));
      const nonEmptyPanels = panels.filter((p) => (p.textContent ?? '').trim().length > 20).length;
      const overflow = document.documentElement.scrollWidth > window.innerWidth;
      const bodyText = document.body.textContent ?? '';
      const emojiHit = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(bodyText);
      return { panelCount: panels.length, nonEmptyPanels, overflow, emojiHit };
    });

    await page.screenshot({ path: sheetPath, fullPage: true });
    const stat = statSync(sheetPath);

    const checks = [
      metrics.panelCount === 4 && metrics.nonEmptyPanels === 4
        ? 'L1 PASS panels-populated: 4/4 panels rendered'
        : `L1 FAIL panels-populated: ${metrics.nonEmptyPanels}/${metrics.panelCount}`,
      !metrics.overflow
        ? 'L2 PASS zero-horizontal-overflow: scrollWidth <= 1440'
        : 'L2 FAIL zero-horizontal-overflow: horizontal overflow detected',
      !metrics.emojiHit
        ? 'L3 PASS no-emoji-glyphs: 0 emoji glyphs'
        : 'L3 FAIL no-emoji-glyphs: emoji glyph found in render',
      stat.size > 20_000
        ? `L4 PASS png-artifact-bounds: ${stat.size} bytes`
        : `L4 FAIL png-artifact-bounds: ${stat.size} bytes`,
    ];

    for (const line of checks) {
      process.stdout.write(`${line}\n`);
    }
    if (checks.some((c) => c.includes(' FAIL '))) {
      process.exit(1);
    }
  } finally {
    await browser.close();
  }
}

void main();
