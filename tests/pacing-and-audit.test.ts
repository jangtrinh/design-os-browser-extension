import { describe, expect, it } from 'vitest';
import { LinkedInSqliteCache } from '../cli/src/db/sqlite-cache.js';
import { PacingBudgetManager } from '../cli/src/reader/pacing-budget.js';
import { ReaderAuditLog } from '../cli/src/reader/audit-log.js';
import { ReaderRuntime } from '../cli/src/reader/reader-runtime.js';
import type { CollectedPageSnapshot } from '../shared/reader-schema.js';

function okProfileSnap(): CollectedPageSnapshot {
  return {
    url: 'https://www.linkedin.com/in/jangtrinh/',
    finalUrl: 'https://www.linkedin.com/in/jangtrinh/',
    title: 'Jang Trinh | LinkedIn',
    axNodes: [
      { role: 'heading', name: 'Jang Trinh' },
      { role: 'link', name: '8,741 followers', href: 'https://www.linkedin.com/feed/followers/' },
    ],
    headings: ['Jang Trinh'],
    links: [],
    meta: {},
    bodySample: 'Jang Trinh',
    domMarkers: [],
    structuralAlertTexts: [],
    loadingIndicators: [],
    hiddenInstructions: [],
    scrollStepsExecuted: 0,
  };
}

function stalledSnap(): CollectedPageSnapshot {
  return {
    url: 'https://www.linkedin.com/analytics/creator/content/',
    finalUrl: 'https://www.linkedin.com/analytics/creator/content/',
    title: 'Loading',
    axNodes: [],
    headings: [],
    links: [],
    meta: {},
    bodySample: 'Đang tải...',
    domMarkers: [],
    structuralAlertTexts: [],
    loadingIndicators: ['Đang tải...'],
    hiddenInstructions: [],
    scrollStepsExecuted: 0,
    stalled: true,
  };
}

describe('#10 Per-site pacing budget, stall back-off and hash-chained audit log', () => {
  it('enforces min-gap with fake clock, 3-scroll = 1 load, and PACING_EXHAUSTED with 0 loads across callers', async () => {
    const cache = new LinkedInSqliteCache(':memory:');
    try {
      let nowMs = Date.parse('2026-11-16T10:00:00Z');
      const sleeps: number[] = [];
      const mgr = new PacingBudgetManager(cache.getDatabase(), {
        now: () => nowMs,
        sleep: async (ms) => {
          sleeps.push(ms);
          nowMs += ms;
        },
        jitter: () => 0,
      });

      const first = await mgr.acquireLoad('facebook', 'https://www.facebook.com/me/following', 1);
      expect(first.ok).toBe(true);
      expect(first.waitedMs).toBe(0);

      // Second request inside 20s gap waits full remaining 20s
      const second = await mgr.acquireLoad('facebook', 'https://www.facebook.com/me/following', 1);
      expect(second.ok).toBe(true);
      expect(second.waitedMs).toBe(20_000);
      expect(sleeps).toEqual([20_000]);

      // Burn remaining 28 loads out of 30/hour limit
      for (let i = 0; i < 28; i += 1) {
        nowMs += 25_000;
        const r = await mgr.acquireLoad('facebook', 'https://www.facebook.com/me/following', 1);
        expect(r.ok).toBe(true);
      }

      // 31st request refuses with PACING_EXHAUSTED and waits 0ms
      const exhausted = await mgr.acquireLoad('facebook', 'https://www.facebook.com/me/following', 1);
      expect(exhausted.ok).toBe(false);
      expect(exhausted.error_code).toBe('PACING_EXHAUSTED');
      expect(exhausted.pacing.loads_left_hour).toBe(0);
    } finally {
      cache.close();
    }
  });

  it('retries once after 2x min-gap on stall, pauses 30m after 3 consecutive stalls, and triggers guard on 3 pauses/day', async () => {
    const cache = new LinkedInSqliteCache(':memory:');
    try {
      let nowMs = Date.parse('2026-11-16T10:00:00Z');
      const slept: number[] = [];
      let loads = 0;

      const rt = new ReaderRuntime({
        cache,
        mirrorAuditToFile: false,
        clock: {
          now: () => nowMs,
          sleep: async (ms) => {
            slept.push(ms);
            nowMs += ms;
          },
          jitter: () => 0,
        },
        collectPage: async () => {
          loads += 1;
          return { ok: true, snapshot: stalledSnap() };
        },
      });

      // Call 1: 1 initial load -> stall(1), wait 2*20s=40s -> retry load -> stall(2)
      const r1 = await rt.read({
        site: 'linkedin',
        view: 'analytics.content',
        target: 'https://www.linkedin.com/analytics/creator/content/',
        max_age_s: 0,
        evidence: 'off',
        caller: { bot: 'J', routine: 'nightly' },
      });
      expect(loads).toBe(2);
      expect(r1.complete).toBe(false);
      expect(slept).toContain(40_000);

      // Call 2: next stall reaches 3 consecutive stalls -> STALLED 30-min pause
      nowMs += 25_000;
      const r2 = await rt.read({
        site: 'linkedin',
        view: 'analytics.content',
        target: 'https://www.linkedin.com/analytics/creator/content/',
        max_age_s: 0,
        evidence: 'off',
        caller: { bot: 'Growth', routine: 'check' },
      });
      expect(r2.error_code).toBe('STALLED');

      // While inside 30-min window, caller is refused with 0 live loads
      const blockedDuringPause = await rt.read({
        site: 'linkedin',
        view: 'analytics.content',
        target: 'https://www.linkedin.com/analytics/creator/content/',
        max_age_s: 0,
        evidence: 'off',
        caller: { bot: 'Community', routine: 'check' },
      });
      expect(blockedDuringPause.error_code).toBe('STALLED');
      expect(loads).toBe(3);
      const stalledAudit = rt.queryAudit({ site: 'linkedin' }).rows.find((r) => r.error_code === 'STALLED');
      expect(stalledAudit).toBeDefined();

      // Simulate two more 30-min stall pause cycles in the same day -> triggers Account Guard!
      const pm = rt.pacing;
      pm.recordStall('linkedin');
      pm.recordStall('linkedin');
      pm.recordStall('linkedin'); // 2nd pause today
      pm.recordStall('linkedin');
      pm.recordStall('linkedin');
      const third = pm.recordStall('linkedin'); // 3rd pause today!
      expect(third.paused30m).toBe(true);
      expect(third.triggerGuard).toBe(true);
    } finally {
      cache.close();
    }
  });

  it('maintains a tamper-evident prev_hash chain across audit_log rows', async () => {
    const cache = new LinkedInSqliteCache(':memory:');
    try {
      const rt = new ReaderRuntime({
        cache,
        mirrorAuditToFile: false,
        collectPage: async () => ({ ok: true, snapshot: okProfileSnap() }),
      });

      await rt.read({
        site: 'linkedin',
        view: 'profile.self',
        target: 'https://www.linkedin.com/in/jangtrinh/',
        params: { public_id: 'jangtrinh' },
        evidence: 'off',
        caller: { bot: 'J', routine: 'r1' },
      });
      await rt.read({
        site: 'linkedin',
        view: 'profile.self',
        target: 'https://www.linkedin.com/in/jangtrinh/',
        params: { public_id: 'jangtrinh' },
        evidence: 'off',
        caller: { bot: 'Growth', routine: 'r2' },
      });

      const audit = new ReaderAuditLog(cache.getDatabase(), false);
      expect(audit.verifyChain()).toEqual({ ok: true, count: 2 });

      // Tamper row 1 target without recomputing row hashes -> verifyChain fails cleanly
      cache.getDatabase().exec("UPDATE audit_log SET target = 'tampered' WHERE seq = 1");
      const tampered = audit.verifyChain();
      expect(tampered.ok).toBe(false);
      expect(tampered.brokenSeq).toBe(1);
    } finally {
      cache.close();
    }
  });
});
