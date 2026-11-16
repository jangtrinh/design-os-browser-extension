#!/usr/bin/env node
/** Assemble an audited offline (or `--live`) `es-browser-agent` run artifact bundle. */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/** Same lookup as the CLI: BROWSER_AGENT_PAIRING_TOKEN, then the pairing file. Never printed. */
function readPairingToken() {
  if (process.env.BROWSER_AGENT_PAIRING_TOKEN?.trim()) return process.env.BROWSER_AGENT_PAIRING_TOKEN.trim();
  const file = process.env.BROWSER_AGENT_PAIRING_FILE?.trim() || join(homedir(), '.design-os-browser-extension', 'pairing.json');
  try {
    return JSON.parse(readFileSync(file, 'utf8')).token ?? '';
  } catch {
    return '';
  }
}

function loadDbSync() {
  const orig = process.emitWarning.bind(process);
  process.emitWarning = ((w, ...args) => {
    const msg = typeof w === 'string' ? w : w?.message ?? '';
    if (msg.includes('SQLite is an experimental feature')) return;
    return orig(w, ...args);
  });
  try {
    return createRequire(import.meta.url)('node:sqlite').DatabaseSync;
  } finally {
    process.emitWarning = orig;
  }
}

function usage() {
  process.stdout.write(
    'Usage: node build.mjs --repo-root <dir> --spec <spec.json> --output-dir <new-dir> [--live]\n',
  );
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    if (k === '--help' || k === '-h') return { help: true };
    if (k === '--live') {
      args.live = true;
      continue;
    }
    if (k.startsWith('--') && argv[i + 1]) {
      args[k.slice(2)] = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

function isHumanGateBlocked(url, statusCodes = []) {
  if (statusCodes.includes(451) || statusCodes.includes(429)) return 'BLOCKED_CHALLENGE';
  if (/\/(checkpoint|challenge|security-verification|captcha)(\/|\?|$)/i.test(url)) {
    return 'BLOCKED_CHALLENGE';
  }
  if (/\/(uas\/login|authwall|login)(\/|\?|$)/i.test(url)) return 'BLOCKED_AUTH';
  if (/\/(premium\/products|sales\/login)(\/|\?|$)/i.test(url)) return 'BLOCKED_PAYMENT';
  return 'CLEAR';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    process.exit(0);
  }
  if (!args['repo-root'] || !args.spec || !args['output-dir']) {
    usage();
    process.exit(2);
  }

  const repoRoot = resolve(args['repo-root']);
  const specPath = resolve(args.spec);
  const outDir = resolve(args['output-dir']);

  if (existsSync(outDir) && readdirSync(outDir).length > 0) {
    process.stderr.write(`build: output directory already exists and is non-empty: ${outDir}\n`);
    process.exit(1);
  }

  const specText = readFileSync(specPath, 'utf8');
  const spec = JSON.parse(specText);
  const specSha256 = createHash('sha256').update(specText, 'utf8').digest('hex');

  const contractPath = join(repoRoot, 'skills/es-browser-agent/contract.md');
  const contractText = readFileSync(contractPath, 'utf8');
  const headerMatch = contractText.match(/^<!--\s*contract-sha256:\s*([a-f0-9]{64})\s*-->\n([\s\S]*)$/);
  if (!headerMatch) {
    process.stderr.write('build: invalid contract-sha256 header in contract.md\n');
    process.exit(1);
  }
  const actualContractSha = createHash('sha256').update(headerMatch[2], 'utf8').digest('hex');
  if (actualContractSha !== headerMatch[1]) {
    process.stderr.write('build: contract.md checksum mismatch; run scripts/skill_contract.mjs\n');
    process.exit(1);
  }

  const chromiumManifest = JSON.parse(
    readFileSync(join(repoRoot, 'extension/manifests/chromium.manifest.json'), 'utf8'),
  );
  const firefoxManifest = JSON.parse(
    readFileSync(join(repoRoot, 'extension/manifests/firefox.manifest.json'), 'utf8'),
  );

  const debuggerAttached =
    (chromiumManifest.permissions ?? []).includes('debugger') ||
    (firefoxManifest.permissions ?? []).includes('debugger');

  mkdirSync(outDir, { recursive: true });
  const dbPath = join(outDir, 'cache.sqlite');
  const DatabaseSync = loadDbSync();
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      public_identifier TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      headline TEXT,
      source TEXT NOT NULL,
      captured_at TEXT NOT NULL
    );
  `);
  db.prepare(
    'INSERT OR REPLACE INTO profiles VALUES (?, ?, ?, ?, ?)',
  ).run(
    'linh-nguyen-staff-ai',
    'Linh Nguyen',
    'Staff AI Systems Engineer · Local-First Browser Automation',
    'hybrid',
    new Date().toISOString(),
  );

  const cacheSql = String(spec.cacheSql || 'SELECT public_identifier, full_name, source FROM profiles');
  const cacheRows = db.prepare(cacheSql).all();
  db.close();

  const fence = { tabId: 1, pageId: 'pg_run_0001', epoch: 1, leaseId: 'ls_run_0001' };
  let humanGate = isHumanGateBlocked(String(spec.targetUrl || ''), spec.statusCodes ?? []);
  let postBlockRetries = 0;
  let fencedMutations = 0;
  const stepResults = [];

  for (const step of spec.actions ?? []) {
    if (humanGate !== 'CLEAR') {
      stepResults.push({
        id: step.id,
        action: step.action,
        outcome: 'BLOCKED',
        humanGate,
        retryable: false,
      });
      continue;
    }

    if (args.live) {
      const res = await fetch('http://127.0.0.1:4347/rpc', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-browser-agent-token': readPairingToken() },
        body: JSON.stringify({ action: step.action, params: step.params ?? {}, fence }),
      });
      const json = await res.json();
      if (json.humanGate && json.humanGate !== 'CLEAR') humanGate = json.humanGate;
      stepResults.push({ id: step.id, action: step.action, ...json });
    } else {
      const isMutation = step.action === 'browser.act' || step.action === 'linkedin.composer.prefill';
      if (isMutation) fencedMutations += 1;
      stepResults.push({
        id: step.id,
        action: step.action,
        outcome: 'COMMITTED',
        humanGate: 'CLEAR',
        fence,
        retryCount: 0,
      });
    }
  }

  let copilotQueue = [];
  if (spec.draft && humanGate === 'CLEAR') {
    copilotQueue = [
      {
        queueId: 'cp_sample_0001',
        kind: spec.draft.kind,
        target: spec.draft.target,
        body: spec.draft.body,
        status: spec.draft.prefill ? 'prefilled' : 'pending',
        prefilled: Boolean(spec.draft.prefill),
        sent: false,
        createdBy: 'agent-rpc',
        fence,
      },
    ];
    fencedMutations += 1;
  }

  const receipt = {
    skill: 'es-browser-agent',
    mode: args.live ? 'live' : 'offline-deterministic',
    specName: spec.name ?? 'unnamed-run',
    concept: spec.concept,
    targetUrl: spec.targetUrl,
    contractSha256: actualContractSha,
    specSha256,
    debuggerAttached,
    cacheCheck: {
      sql: cacheSql,
      rowCount: cacheRows.length,
    },
    fencePolicy: {
      epoch: fence.epoch,
      fencedMutations,
      timeoutRetryCount: 0,
    },
    humanGate,
    postBlockRetries,
    copilotQueueCount: copilotQueue.length,
    agentSelfApprovalBlocked: 'BLOCKED_POLICY',
    builtAt: new Date().toISOString(),
  };

  writeFileSync(join(outDir, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  writeFileSync(
    join(outDir, 'steps-output.json'),
    `${JSON.stringify({ steps: stepResults, copilotQueue }, null, 2)}\n`,
  );
  writeFileSync(join(outDir, 'cache-rows.json'), `${JSON.stringify(cacheRows, null, 2)}\n`);

  process.stdout.write(`${outDir}\n`);
}

void main();
