import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { dispatchCli } from '../cli/src/commands/dispatch.js';
import { LinkedInSqliteCache, validateReadOnlySelectSql } from '../cli/src/db/sqlite-cache.js';
import { ReaderRuntime } from '../cli/src/reader/reader-runtime.js';
import type { CollectedPageSnapshot } from '../shared/reader-schema.js';

function pilotSnapshot(file: string): CollectedPageSnapshot {
  const json = JSON.parse(
    readFileSync(resolve(__dirname, '../docs/pilot/2026-11-16-linkedin-live/raw', file), 'utf8'),
  ) as { data: { url: string; title: string; nodes: Array<{ role: string; name: string; href?: string; text?: string }> } };
  return {
    url: json.data.url,
    finalUrl: json.data.url,
    title: json.data.title,
    axNodes: json.data.nodes.map((n) => ({ role: n.role, name: n.name, href: n.href, text: n.text })),
    headings: [],
    links: [],
    meta: {},
    bodySample: '',
    domMarkers: [],
    structuralAlertTexts: [],
    loadingIndicators: [],
    hiddenInstructions: [],
    scrollStepsExecuted: 0,
  };
}

describe('#9 Shared reader cache, dos.reader.v1 envelope, freshness & CLI verdict', () => {
  it('writes complete results to reader_latest & reader_series while keeping incomplete missing_required out of latest', async () => {
    const cache = new LinkedInSqliteCache(':memory:');
    try {
      let nowMs = Date.parse('2026-11-16T12:00:00Z');
      let pageLoads = 0;
      let nextSnap: CollectedPageSnapshot = pilotSnapshot('05-observe-profile.json');

      const rt = new ReaderRuntime({
        cache,
        mirrorAuditToFile: false,
        clock: {
          now: () => nowMs,
          sleep: async (ms) => {
            nowMs += ms;
          },
          jitter: () => 0,
        },
        collectPage: async () => {
          pageLoads += 1;
          return { ok: true, snapshot: nextSnap };
        },
      });

      const first = await rt.read({
        site: 'linkedin',
        view: 'profile.self',
        target: 'https://www.linkedin.com/in/jangtrinh/',
        params: { public_id: 'jangtrinh' },
        evidence: 'off',
        caller: { bot: 'Growth', routine: 'nightly' },
      });

      expect(first.ok).toBe(true);
      expect(first.schema).toBe('dos.reader.v1');
      expect(first.source).toBe('live');
      expect(first.complete).toBe(true);
      expect(first.missing_required).toEqual([]);
      expect(pageLoads).toBe(1);

      const latest = cache.queryReadOnlySql("SELECT * FROM reader_latest WHERE site = 'linkedin'");
      expect(latest).toHaveLength(1);
      const series = cache.queryReadOnlySql("SELECT metric, value FROM reader_series WHERE target_key = 'linkedin:profile:jangtrinh'");
      expect(series.length).toBeGreaterThan(0);

      // Freshness cache hit within max_age_s -> 0 live page loads.
      nowMs += 60_000;
      const second = await rt.read({
        site: 'linkedin',
        view: 'profile.self',
        target: 'https://www.linkedin.com/in/jangtrinh/',
        params: { public_id: 'jangtrinh' },
        evidence: 'off',
        caller: { bot: 'J', routine: 'morning' },
      });
      expect(second.source).toBe('cache');
      expect(second.freshness.stale).toBe(false);
      expect(second.freshness.age_s).toBe(60);
      expect(pageLoads).toBe(1);

      // Expire freshness, return incomplete result -> goes to reader_results ONLY, reader_latest unchanged!
      nowMs += 90_000_000;
      nextSnap = {
        ...pilotSnapshot('05-observe-profile.json'),
        axNodes: [],
      };
      const incomplete = await rt.read({
        site: 'linkedin',
        view: 'profile.self',
        target: 'https://www.linkedin.com/in/jangtrinh/',
        params: { public_id: 'jangtrinh' },
        evidence: 'off',
        caller: { bot: 'Growth', routine: 'nightly' },
      });
      expect(incomplete.complete).toBe(false);
      expect(incomplete.missing_required).toContain('full_name');
      expect(pageLoads).toBe(2);

      // max_age_s: -1 returns the older COMPLETE reader_latest row with stale=true and 0 loads.
      const staleHit = await rt.read({
        site: 'linkedin',
        view: 'profile.self',
        target: 'https://www.linkedin.com/in/jangtrinh/',
        params: { public_id: 'jangtrinh' },
        max_age_s: -1,
        evidence: 'off',
        caller: { bot: 'J', routine: 'fallback' },
      });
      expect(staleHit.source).toBe('cache');
      expect(staleHit.freshness.stale).toBe(true);
      expect(staleHit.data.full_name).toBe('Jang Trinh');
      expect(pageLoads).toBe(2);

      const resultsCount = cache.queryReadOnlySql('SELECT COUNT(*) AS n FROM reader_results')[0].n;
      expect(resultsCount).toBe(2);
    } finally {
      cache.close();
    }
  });

  it('coalesces concurrent reads for the same target into a single live load and rejects non-SELECT SQL', async () => {
    const cache = new LinkedInSqliteCache(':memory:');
    try {
      let loads = 0;
      let release!: () => void;
      const gate = new Promise<void>((r) => {
        release = r;
      });
      const rt = new ReaderRuntime({
        cache,
        mirrorAuditToFile: false,
        collectPage: async () => {
          loads += 1;
          await gate;
          return { ok: true, snapshot: pilotSnapshot('05-observe-profile.json') };
        },
      });

      const p1 = rt.read({
        site: 'linkedin',
        view: 'profile.self',
        target: 'https://www.linkedin.com/in/jangtrinh/',
        params: { public_id: 'jangtrinh' },
        evidence: 'off',
        caller: { bot: 'A', routine: 'r1' },
      });
      const p2 = rt.read({
        site: 'linkedin',
        view: 'profile.self',
        target: 'https://www.linkedin.com/in/jangtrinh/',
        params: { public_id: 'jangtrinh' },
        evidence: 'off',
        caller: { bot: 'B', routine: 'r2' },
      });
      setTimeout(release, 15);
      const [r1, r2] = await Promise.all([p1, p2]);
      expect(loads).toBe(1);
      expect(r1.ok).toBe(true);
      expect(r2.ok).toBe(true);

      expect(() => validateReadOnlySelectSql('SELECT * FROM reader_latest')).not.toThrow();
      expect(() => validateReadOnlySelectSql('SELECT * FROM reader_results; DELETE FROM reader_results')).toThrow(
        /SQL_READ_ONLY_VIOLATION/,
      );
      expect(() => validateReadOnlySelectSql('/* comment */ SELECT 1')).toThrow(/SQL_READ_ONLY_VIOLATION/);
    } finally {
      cache.close();
    }
  });

  it('ends every CLI JSON call with an AGENT_OK or AGENT_FAIL verdict line', async () => {
    const chunks: string[] = [];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((c: string | Uint8Array) => {
      chunks.push(String(c));
      return true;
    });
    try {
      const codeOk = await dispatchCli(['reader', 'list', '--site', 'linkedin', '--json']);
      expect(codeOk).toBe(0);
      const lastLine = chunks.join('').trim().split('\n').pop() ?? '';
      expect(lastLine.startsWith('AGENT_OK ')).toBe(true);
      expect(JSON.parse(lastLine.slice('AGENT_OK '.length)).ok).toBe(true);

      chunks.length = 0;
      const codeFail = await dispatchCli(['unknown-cmd-xyz']);
      expect(codeFail).toBe(1);
      const failLine = chunks.join('').trim().split('\n').pop() ?? '';
      expect(failLine.startsWith('AGENT_FAIL ')).toBe(true);
      expect(JSON.parse(failLine.slice('AGENT_FAIL '.length)).ok).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });
});
