import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');
const SKILL_DIR = resolve(ROOT, 'skills/es-browser-agent');

function runNode(scriptPath: string, args: string[], allowFail = false): {
  code: number;
  stdout: string;
  stderr: string;
} {
  try {
    const stdout = execFileSync(process.execPath, [scriptPath, ...args], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    return { code: 0, stdout, stderr: '' };
  } catch (err) {
    if (!allowFail) throw err;
    const e = err as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
    return {
      code: e.status ?? 1,
      stdout: String(e.stdout ?? ''),
      stderr: String(e.stderr ?? ''),
    };
  }
}

describe('es:skill-forge v2 tool-product acceptance gates (A1-A9)', () => {
  it('A1/A2/A9: SKILL.md <=120 lines, valid frontmatter, all links exist, ATTRIBUTION present', () => {
    const skillMd = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8');
    const lines = skillMd.trimEnd().split('\n');
    expect(lines.length).toBeLessThanOrEqual(120);

    const nameMatch = skillMd.match(/^name:\s*(\S+)/m);
    expect(nameMatch?.[1]).toBe('es-browser-agent');

    const descMatch = skillMd.match(/^description:\s*"([^"]+)"/m);
    expect(descMatch?.[1]).toBeDefined();
    expect(descMatch![1].startsWith('Use when ')).toBe(true);
    expect(descMatch![1].length).toBeLessThanOrEqual(200);

    const links = Array.from(skillMd.matchAll(/\[[^\]]+\]\(([^)#]+)\)/g), (m) => m[1]).filter(
      (target) => !target.startsWith('http'),
    );
    expect(links.length).toBeGreaterThanOrEqual(10);
    for (const rel of links) {
      expect(existsSync(resolve(SKILL_DIR, rel)), `Missing linked file: ${rel}`).toBe(true);
    }

    const attrib = readFileSync(join(SKILL_DIR, 'ATTRIBUTION.md'), 'utf8');
    expect(attrib).toContain('PolyForm Shield 1.0.0');
  });

  it('A3/A8: generated contract.md and host bundles pass drift checks cleanly', () => {
    const c = runNode(resolve(ROOT, 'scripts/skill_contract.mjs'), ['--check']);
    expect(c.stdout.trim()).toBe('ok: contract');

    const s = runNode(resolve(ROOT, 'scripts/sync_host_bundles.mjs'), ['--check']);
    expect(s.stdout.trim()).toBe('ok: host bundles in sync');
  });

  it('A4/A5: examples build+validate pass and deliberately broken runs fail with exact named diagnostics', () => {
    const sandbox = mkdtempSync(join(tmpdir(), 'dos-skill-forge-test-'));
    try {
      const examples = [
        'linkedin-profile-and-copilot-draft.json',
        'linkedin-checkpoint-handoff.json',
      ];
      for (const ex of examples) {
        const outDir = join(sandbox, ex.replace('.json', ''));
        const built = runNode(join(SKILL_DIR, 'build.mjs'), [
          '--repo-root',
          ROOT,
          '--spec',
          join(SKILL_DIR, 'examples', ex),
          '--output-dir',
          outDir,
        ]);
        expect(built.code).toBe(0);

        const valid = runNode(join(SKILL_DIR, 'validate.mjs'), [
          '--repo-root',
          ROOT,
          '--output-dir',
          outDir,
        ]);
        expect(valid.stdout.trim()).toBe('ok: es-browser-agent validate passed');
      }

      // A5 mutation checks against valid run 1
      const baseRun = join(sandbox, 'linkedin-profile-and-copilot-draft');
      const receiptPath = join(baseRun, 'receipt.json');
      const stepsPath = join(baseRun, 'steps-output.json');
      const origReceipt = readFileSync(receiptPath, 'utf8');
      const origSteps = readFileSync(stepsPath, 'utf8');

      const mutations: Array<{
        label: string;
        mutate: () => void;
        expectedPrefix: string;
      }> = [
        {
          label: 'debugger-absent',
          mutate: () => {
            const r = JSON.parse(origReceipt) as Record<string, unknown>;
            r.debuggerAttached = true;
            writeFileSync(receiptPath, JSON.stringify(r, null, 2));
          },
          expectedPrefix: 'debugger-absent:',
        },
        {
          label: 'sql-read-only',
          mutate: () => {
            const r = JSON.parse(origReceipt) as { cacheCheck: { sql: string } };
            r.cacheCheck.sql = 'DROP TABLE profiles';
            writeFileSync(receiptPath, JSON.stringify(r, null, 2));
          },
          expectedPrefix: 'sql-read-only:',
        },
        {
          label: 'copilot-safety',
          mutate: () => {
            const s = JSON.parse(origSteps) as { copilotQueue: Array<Record<string, unknown>> };
            s.copilotQueue[0].sent = true;
            writeFileSync(stepsPath, JSON.stringify(s, null, 2));
          },
          expectedPrefix: 'copilot-safety:',
        },
        {
          label: 'fenced-dispatch',
          mutate: () => {
            const r = JSON.parse(origReceipt) as { fencePolicy: { timeoutRetryCount: number } };
            r.fencePolicy.timeoutRetryCount = 2;
            writeFileSync(receiptPath, JSON.stringify(r, null, 2));
          },
          expectedPrefix: 'fenced-dispatch:',
        },
        {
          label: 'contract',
          mutate: () => {
            const r = JSON.parse(origReceipt) as Record<string, unknown>;
            r.contractSha256 = '0'.repeat(64);
            writeFileSync(receiptPath, JSON.stringify(r, null, 2));
          },
          expectedPrefix: 'contract:',
        },
      ];

      for (const m of mutations) {
        writeFileSync(receiptPath, origReceipt);
        writeFileSync(stepsPath, origSteps);
        m.mutate();
        const res = runNode(
          join(SKILL_DIR, 'validate.mjs'),
          ['--repo-root', ROOT, '--output-dir', baseRun],
          true,
        );
        expect(res.code, `Mutation ${m.label} should exit 1`).toBe(1);
        expect(res.stderr).toContain(m.expectedPrefix);
      }
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });
});
