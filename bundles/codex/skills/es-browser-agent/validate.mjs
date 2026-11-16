#!/usr/bin/env node
/**
 * Deterministic offline validator for `es-browser-agent` run directories.
 * Checks: contract, receipt-shape, debugger-absent, cache-check, fenced-dispatch,
 *         copilot-safety, human-gate, sql-read-only.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const FORBIDDEN_SQL_RE =
  /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|ATTACH|DETACH|PRAGMA|VACUUM|REINDEX|BEGIN|COMMIT|ROLLBACK)\b/i;

function usage() {
  process.stdout.write('Usage: node validate.mjs --repo-root <dir> --output-dir <run-dir>\n');
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

function isReadOnlySelectSql(rawSql) {
  const trimmed = String(rawSql ?? '').trim().replace(/;+\s*$/, '');
  if (!trimmed || trimmed.includes(';') || trimmed.includes('--') || trimmed.includes('/*')) {
    return false;
  }
  const stripped = trimmed.replace(/'(?:''|[^'])*'/g, "''").replace(/"(?:\"\"|[^"])*"/g, '""');
  if (!/^(SELECT|WITH)\b/i.test(stripped)) return false;
  return !FORBIDDEN_SQL_RE.test(stripped);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    process.exit(0);
  }
  if (!args['repo-root'] || !args['output-dir']) {
    usage();
    process.exit(2);
  }

  const repoRoot = resolve(args['repo-root']);
  const runDir = resolve(args['output-dir']);
  const receiptPath = join(runDir, 'receipt.json');
  const stepsPath = join(runDir, 'steps-output.json');
  const contractPath = join(repoRoot, 'skills/es-browser-agent/contract.md');

  if (!existsSync(receiptPath) || !existsSync(stepsPath) || !existsSync(contractPath)) {
    process.stderr.write('receipt-shape: missing receipt.json, steps-output.json, or contract.md\n');
    process.exit(2);
  }

  const failures = [];
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  const stepsBundle = JSON.parse(readFileSync(stepsPath, 'utf8'));
  const contractRaw = readFileSync(contractPath, 'utf8');

  // 1. contract check
  const match = contractRaw.match(/^<!--\s*contract-sha256:\s*([a-f0-9]{64})\s*-->\n([\s\S]*)$/);
  const recomputed = match ? createHash('sha256').update(match[2], 'utf8').digest('hex') : '';
  if (!match || recomputed !== match[1] || receipt.contractSha256 !== match[1]) {
    failures.push('contract: regenerate contract.md and rebuild run against current contract hash');
  }

  // 2. receipt-shape check
  if (receipt.skill !== 'es-browser-agent' || !receipt.specName || !receipt.concept) {
    failures.push('receipt-shape: missing required receipt metadata (skill, specName, concept)');
  }

  // 3. debugger-absent check
  if (receipt.debuggerAttached !== false) {
    failures.push('debugger-absent: remove chrome.debugger permission and set debuggerAttached=false');
  }

  // 4. cache-check
  if (!receipt.cacheCheck || typeof receipt.cacheCheck.sql !== 'string' || !receipt.cacheCheck.sql.trim()) {
    failures.push('cache-check: declare and run a SQLite cache query before live browser access');
  }

  // 5. fenced-dispatch
  const steps = Array.isArray(stepsBundle.steps) ? stepsBundle.steps : [];
  const badStep = steps.find(
    (s) =>
      (s.action === 'browser.act' && !s.fence?.pageId) ||
      (s.outcome === 'UNCERTAIN' && Number(s.retryCount ?? 0) > 0),
  );
  if (!receipt.fencePolicy || Number(receipt.fencePolicy.timeoutRetryCount ?? 0) > 0 || badStep) {
    failures.push('fenced-dispatch: ensure every browser.act carries pageId fence and timeoutRetryCount=0');
  }

  // 6. copilot-safety
  const queue = Array.isArray(stepsBundle.copilotQueue) ? stepsBundle.copilotQueue : [];
  const unsafeDraft = queue.find(
    (q) => q.sent !== false || q.createdBy !== 'agent-rpc' || q.decidedBy === 'agent-rpc',
  );
  if (unsafeDraft || receipt.agentSelfApprovalBlocked !== 'BLOCKED_POLICY') {
    failures.push('copilot-safety: keep sent=false and block agent-rpc self-approval with BLOCKED_POLICY');
  }

  // 7. human-gate
  if (receipt.humanGate && receipt.humanGate !== 'CLEAR' && Number(receipt.postBlockRetries ?? 0) > 0) {
    failures.push('human-gate: halt with postBlockRetries=0 once BLOCKED_* state triggers');
  }

  // 8. sql-read-only
  if (receipt.cacheCheck?.sql && !isReadOnlySelectSql(receipt.cacheCheck.sql)) {
    failures.push('sql-read-only: replace write, comment, or chained SQL with a single SELECT/WITH query');
  }

  if (failures.length > 0) {
    for (const line of failures) {
      process.stderr.write(`${line}\n`);
    }
    process.exit(1);
  }

  process.stdout.write('ok: es-browser-agent validate passed\n');
}

main();
