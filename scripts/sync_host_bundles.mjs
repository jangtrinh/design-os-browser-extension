#!/usr/bin/env node
/** Sync portable AI-host bundles and plugin manifests from canonical `skills/es-browser-agent` & `workflows/`. */
import { lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const SKILL_REL = 'skills/es-browser-agent';
const WORKFLOWS_REL = 'workflows';
const HOSTS = ['claude-code', 'codex', 'gemini', 'grok-build'];
const ALLOWED_EXTS = new Set(['.md', '.mjs', '.json']);
const REQUIRED_SKILL_FILES = [
  'SKILL.md',
  'concepts.md',
  'rules.md',
  'look.md',
  'contract.md',
  'ATTRIBUTION.md',
  'build.mjs',
  'validate.mjs',
  'look.mjs',
];

function toPosix(p) {
  return p.split(sep).join('/');
}

function jsonBuf(obj) {
  return Buffer.from(`${JSON.stringify(obj, null, 2)}\n`, 'utf8');
}

function collectRegularFiles(absDir, relPrefix = '') {
  const map = new Map();
  if (!lstatSync(absDir).isDirectory()) {
    throw new Error(`bundle-path: expected directory at ${absDir}`);
  }
  const entries = readdirSync(absDir).sort();
  for (const name of entries) {
    if (name === '.DS_Store' || name === '__pycache__') continue;
    const abs = join(absDir, name);
    const st = lstatSync(abs);
    if (st.isSymbolicLink()) {
      throw new Error(`bundle-links: replace symlink with regular file: ${abs}`);
    }
    const rel = relPrefix ? `${relPrefix}/${name}` : name;
    if (st.isDirectory()) {
      for (const [k, v] of collectRegularFiles(abs, rel)) {
        map.set(k, v);
      }
    } else if (st.isFile()) {
      const dot = name.lastIndexOf('.');
      const ext = dot === -1 ? '' : name.slice(dot);
      if (!ALLOWED_EXTS.has(ext)) {
        throw new Error(`bundle-source: unsupported file extension ${rel}`);
      }
      map.set(toPosix(rel), readFileSync(abs));
    }
  }
  return map;
}

function collectExistingManaged(repoRoot, managedRoots) {
  const existing = new Map();
  for (const mr of managedRoots) {
    const start = join(repoRoot, mr);
    let st;
    try {
      st = lstatSync(start);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) {
      throw new Error(`bundle-links: managed root cannot be symlink: ${mr}`);
    }
    if (!st.isDirectory()) {
      existing.set(mr, readFileSync(start));
      continue;
    }
    const walk = (dir) => {
      for (const entry of readdirSync(dir).sort()) {
        if (entry === '.DS_Store') continue;
        const abs = join(dir, entry);
        const childSt = lstatSync(abs);
        if (childSt.isSymbolicLink()) {
          throw new Error(`bundle-links: symlink inside managed root: ${abs}`);
        }
        if (childSt.isDirectory()) {
          walk(abs);
        } else if (childSt.isFile()) {
          existing.set(toPosix(relative(repoRoot, abs)), readFileSync(abs));
        }
      }
    };
    walk(start);
  }
  return existing;
}

function computeExpectedRepoFiles(repoRoot) {
  const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
  const version = pkg.version || '0.2.0';

  const skillAbs = join(repoRoot, SKILL_REL);
  const skillMap = collectRegularFiles(skillAbs);
  for (const req of REQUIRED_SKILL_FILES) {
    if (!skillMap.has(req)) {
      throw new Error(`bundle-source: missing required skill file ${SKILL_REL}/${req}`);
    }
  }

  const workflowsMap = collectRegularFiles(join(repoRoot, WORKFLOWS_REL));
  const expected = new Map();

  const metaBase = {
    name: 'design-os-browser-extension',
    description:
      'Capability-Tiered Agent RPC WebExtension Engine, LinkedIn Zero-Drift Hybrid Reader, SQLite local cache, CLI (`browser-agent`), and 12-tool MCP stdio server.',
    version,
    author: { name: 'Jang Trinh', url: 'https://github.com/jangtrinh' },
    homepage: 'https://github.com/jangtrinh/design-os-browser-extension#readme',
    repository: 'https://github.com/jangtrinh/design-os-browser-extension',
    license: 'LicenseRef-PolyForm-Shield-1.0.0',
    keywords: [
      'browser-extension',
      'webextensions',
      'linkedin',
      'ai-agents',
      'mcp',
      'design-os',
    ],
  };

  expected.set('.claude-plugin/plugin.json', jsonBuf(metaBase));
  expected.set(
    '.claude-plugin/marketplace.json',
    jsonBuf({
      name: metaBase.name,
      metadata: { description: metaBase.description },
      owner: { name: 'Jang Trinh' },
      plugins: [{ name: metaBase.name, source: './' }],
    }),
  );
  expected.set(
    '.codex-plugin/plugin.json',
    jsonBuf({
      ...metaBase,
      skills: './skills/',
      interface: {
        displayName: 'DESIGN:OS Browser Agent',
        shortDescription:
          'Drive the user\'s real Chromium or Firefox session for LinkedIn search, structured reads, SQLite cache, and Copilot draft prefill.',
        longDescription:
          'Zero-drift hybrid DOM/passive-response WebExtension bridge wired to `browser-agent` CLI (`--json`) and 12 MCP tools over loopback WebSocket `127.0.0.1:4347` with fenced `(pageId, epoch, lease)` dispatch and strict Human Gate Handoff.',
        developerName: 'DESIGN:OS',
        category: 'Developer Tools',
        capabilities: ['Read', 'Write'],
        websiteURL: 'https://github.com/jangtrinh/design-os-browser-extension',
        privacyPolicyURL: 'https://github.com/jangtrinh/design-os-browser-extension/blob/main/PRIVACY.md',
        defaultPrompt: [
          'Check the active LinkedIn tab with linkedin_status, query the SQLite cache first, then extract the profile via linkedin_get_profile.',
          'Search LinkedIn people results with linkedin_search and query previously cached rows with linkedin_query_cache.',
          'Stage a reply draft via linkedin_draft_write with prefill enabled without ever clicking Send.',
        ],
        brandColor: '#0A66C2',
      },
    }),
  );
  expected.set(
    '.agents/plugins/marketplace.json',
    jsonBuf({
      name: metaBase.name,
      interface: { displayName: 'DESIGN:OS Browser Agent' },
      plugins: [
        {
          name: metaBase.name,
          source: { source: 'local', path: './' },
          policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
          category: 'Developer Tools',
        },
      ],
    }),
  );
  expected.set('.grok-plugin/plugin.json', jsonBuf({ ...metaBase, skills: './skills/' }));
  expected.set(
    '.mcp.json',
    jsonBuf({
      mcpServers: {
        'design-os-browser-agent': {
          command: 'node',
          args: ['cli/dist/browser-agent.js', 'mcp'],
        },
      },
    }),
  );

  for (const host of HOSTS) {
    const prefix = `bundles/${host}`;
    for (const [rel, data] of skillMap) {
      expected.set(`${prefix}/skills/es-browser-agent/${rel}`, data);
    }
    for (const [rel, data] of workflowsMap) {
      expected.set(`${prefix}/workflows/${rel}`, data);
    }
    expected.set(
      `${prefix}/.mcp.json`,
      jsonBuf({
        mcpServers: {
          'design-os-browser-agent': {
            command: 'node',
            args: ['cli/dist/browser-agent.js', 'mcp'],
          },
        },
      }),
    );
  }

  return expected;
}

const MANAGED_ROOTS = [
  'bundles',
  '.claude-plugin',
  '.codex-plugin',
  '.agents',
  '.grok-plugin',
  '.mcp.json',
];

function checkDrift(repoRoot, expected) {
  const actual = collectExistingManaged(repoRoot, MANAGED_ROOTS);
  const issues = [];
  for (const k of expected.keys()) {
    if (!actual.has(k)) issues.push(`missing: ${k}`);
    else if (!actual.get(k).equals(expected.get(k))) issues.push(`changed: ${k}`);
  }
  for (const k of actual.keys()) {
    if (!expected.has(k)) issues.push(`extra: ${k}`);
  }
  return issues.sort();
}

function writeRepoBundles(repoRoot, expected) {
  const actual = collectExistingManaged(repoRoot, MANAGED_ROOTS);
  for (const k of actual.keys()) {
    if (!expected.has(k)) {
      rmSync(join(repoRoot, k), { force: true });
    }
  }
  for (const [rel, buf] of expected) {
    const target = join(repoRoot, rel);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, buf);
  }
}

function installLocal(repoRoot) {
  const home = homedir();
  const skillMap = collectRegularFiles(join(repoRoot, SKILL_REL));
  const workflowsMap = collectRegularFiles(join(repoRoot, WORKFLOWS_REL));

  const skillTargets = [
    join(home, '.gemini/config/skills/es-browser-agent'),
    join(home, '.claude/skills/es-browser-agent'),
    join(home, '.agents/skills/es-browser-agent'),
  ];

  for (const targetRoot of skillTargets) {
    rmSync(targetRoot, { recursive: true, force: true });
    for (const [rel, data] of skillMap) {
      const dest = join(targetRoot, rel);
      mkdirSync(join(dest, '..'), { recursive: true });
      writeFileSync(dest, data);
    }
  }

  const wfDir = join(home, '.config/easestart/workflows');
  mkdirSync(wfDir, { recursive: true });
  const wf1 = workflowsMap.get('linkedin-agent-workflow.md');
  const wf2 = workflowsMap.get('new-site-extension-workflow.md');
  if (wf1) writeFileSync(join(wfDir, 'browser-agent-linkedin.md'), wf1);
  if (wf2) writeFileSync(join(wfDir, 'browser-agent-new-site.md'), wf2);

  process.stdout.write(
    `installed skill to ${skillTargets.length} host skill dirs and workflows to ${wfDir}\n`,
  );
}

function main() {
  const check = process.argv.includes('--check');
  const doInstall = process.argv.includes('--install-local');
  const expected = computeExpectedRepoFiles(ROOT);

  if (check) {
    const issues = checkDrift(ROOT, expected);
    if (issues.length > 0) {
      for (const issue of issues) process.stderr.write(`${issue}\n`);
      process.exit(1);
    }
    process.stdout.write('ok: host bundles in sync\n');
    return;
  }

  writeRepoBundles(ROOT, expected);
  process.stdout.write(`synced ${expected.size} host bundle files\n`);
  if (doInstall) {
    installLocal(ROOT);
  }
}

main();
