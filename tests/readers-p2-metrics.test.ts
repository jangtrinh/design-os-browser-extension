import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LinkedInSqliteCache } from '../cli/src/db/sqlite-cache.js';
import { ReaderRuntime } from '../cli/src/reader/reader-runtime.js';
import { combineXNightlyMetrics } from '../extension/src/adapters/x/reader.js';
import type { CollectedPageSnapshot } from '../shared/reader-schema.js';

function pilotSnap(file: string): CollectedPageSnapshot {
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

function makeSnap(partial: Partial<CollectedPageSnapshot> & { url: string }): CollectedPageSnapshot {
  return {
    url: partial.url,
    finalUrl: partial.finalUrl ?? partial.url,
    title: partial.title ?? '',
    axNodes: partial.axNodes ?? [],
    headings: partial.headings ?? [],
    links: partial.links ?? [],
    meta: partial.meta ?? {},
    bodySample: partial.bodySample ?? '',
    domMarkers: partial.domMarkers ?? [],
    structuralAlertTexts: partial.structuralAlertTexts ?? [],
    loadingIndicators: partial.loadingIndicators ?? [],
    hiddenInstructions: partial.hiddenInstructions ?? [],
    scrollStepsExecuted: partial.scrollStepsExecuted ?? 0,
    stalled: partial.stalled,
  };
}

describe('Wave 2 metrics readers (#13-#16)', () => {
  it('#13 R1 LinkedIn nightly snapshot reads pilot fixtures with <=4 loads, 0 input events, and non-pausing BLOCKED_PAYMENT', async () => {
    const cache = new LinkedInSqliteCache(':memory:');
    try {
      let nowMs = Date.parse('2026-11-16T22:00:00+07:00');
      let liLoads = 0;
      let premiumUpsellOnViewers = false;

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
        collectPage: async (req) => {
          liLoads += 1;
          if (req.targetUrl.includes('/analytics/creator/content')) {
            return { ok: true, snapshot: pilotSnap('07-observe-analytics-content-settled.json') };
          }
          if (req.targetUrl.includes('/analytics/profile-views')) {
            if (premiumUpsellOnViewers) {
              return { ok: false, gate: 'BLOCKED_PAYMENT', gateReason: 'Premium upsell wall' };
            }
            return { ok: true, snapshot: pilotSnap('10-observe-profile-views-settled.json') };
          }
          return { ok: true, snapshot: pilotSnap('05-observe-profile.json') };
        },
      });

      const res = await rt.read({
        site: 'linkedin',
        view: 'analytics.nightly_snapshot',
        params: { public_id: 'jangtrinh' },
        evidence: 'off',
        caller: { bot: 'Growth', routine: 'nightly-linkedin' },
      });

      expect(res.ok).toBe(true);
      expect(liLoads).toBeLessThanOrEqual(4);
      const d = res.data as Record<string, unknown>;
      expect(d.followers).toBe(8741);
      expect(d.connections).toBe(500);
      expect(d.connections_floor).toBe(true);
      expect(d.profile_views).toBe(638);
      expect(d.impressions).toBe(3776);
      expect(d.period).toBe('past_7_days');
      expect(d.search_appearances).toBe(59);
      expect(d.chart_totals).toBeNull();

      const posts = d.posts as Array<Record<string, unknown>>;
      expect(posts.map((p) => [p.impressions, p.engagements])).toEqual([
        [759, 20],
        [550, 3],
        [299, 4],
      ]);

      const series = cache.queryReadOnlySql(
        "SELECT metric, value FROM reader_series WHERE view = 'profile.self'",
      );
      expect(series.length).toBeGreaterThan(0);

      // BLOCKED_PAYMENT upsell must NOT pause Account Guard for LinkedIn.
      premiumUpsellOnViewers = true;
      nowMs += 90_000_000;
      const upsellRun = await rt.read({
        site: 'linkedin',
        view: 'analytics.nightly_snapshot',
        params: { public_id: 'jangtrinh' },
        max_age_s: 0,
        evidence: 'off',
        caller: { bot: 'Growth', routine: 'nightly-linkedin' },
      });
      expect(upsellRun.ok).toBe(true);
      expect(upsellRun.gate).toBe('BLOCKED_PAYMENT');
      expect(rt.guard.getGuard('linkedin').state).toBe('CLEAR');
    } finally {
      cache.close();
    }
  });

  it('#14 R2 X Articles impressions + connector merge + BLOCKED_AUTH when logged out', async () => {
    const cache = new LinkedInSqliteCache(':memory:');
    try {
      let nowMs = Date.parse('2026-11-16T23:00:00+07:00');
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
        collectPage: async (req) => {
          if (req.targetUrl.includes('art01')) {
            return {
              ok: true,
              snapshot: makeSnap({
                url: req.targetUrl,
                headings: ['Agent-First Browser Architecture'],
                axNodes: [{ role: 'text', name: '1,650 impressions · 94 engagements · 42 likes · 9 reposts · 5 replies · 18 bookmarks' }],
                bodySample: '1,650 impressions · 94 engagements · 42 likes · 9 reposts · 5 replies · 18 bookmarks',
              }),
            };
          }
          if (req.targetUrl.includes('art02')) {
            return {
              ok: true,
              snapshot: makeSnap({
                url: req.targetUrl,
                headings: ['Zero-Drift ARIA Readers'],
                axNodes: [{ role: 'text', name: '160 impressions · 12 engagements' }],
                bodySample: '160 impressions · 12 engagements',
              }),
            };
          }
          return { ok: false, gate: 'BLOCKED_AUTH', gateReason: 'Sign in to X required' };
        },
      });

      const a1 = await rt.read({
        site: 'x',
        view: 'article.stats',
        target: 'https://x.com/i/articles/art01',
        evidence: 'off',
        caller: { bot: 'J', routine: 'X nightly metrics' },
      });
      nowMs += 15_000;
      const a2 = await rt.read({
        site: 'x',
        view: 'article.stats',
        target: 'https://x.com/i/articles/art02',
        evidence: 'off',
        caller: { bot: 'J', routine: 'X nightly metrics' },
      });

      expect(a1.data.impressions).toBe(1650);
      expect(a2.data.impressions).toBe(160);

      const combined = combineXNightlyMetrics(
        [{ post_id: 'p1', impressions: 1985 }],
        [
          { article_id: 'art01', impressions: Number(a1.data.impressions) },
          { article_id: 'art02', impressions: Number(a2.data.impressions) },
        ],
      );
      expect(combined.reader_articles_impressions).toBe(1810);
      expect(combined.connector_posts_impressions).toBe(1985);
      expect(combined.total_impressions).toBe(3795);
      expect(combined.sources).toEqual({ posts: 'x-connector', articles: 'extension-reader' });

      // Logged-out account analytics triggers BLOCKED_AUTH -> PAUSED_BY_GUARD for x
      nowMs += 15_000;
      const loggedOut = await rt.read({
        site: 'x',
        view: 'analytics.account',
        target: 'https://x.com/i/account_analytics',
        evidence: 'off',
        caller: { bot: 'J', routine: 'X nightly metrics' },
      });
      expect(loggedOut.gate).toBe('PAUSED_BY_GUARD');
      expect((loggedOut.data as Record<string, unknown>).detected_gate).toBe('BLOCKED_AUTH');
    } finally {
      cache.close();
    }
  });

  it('#15 R3 YouTube Studio + Product Hunt metrics (copyright note stays CLEAR; PH challenge pauses producthunt only)', async () => {
    const cache = new LinkedInSqliteCache(':memory:');
    try {
      let nowMs = Date.parse('2026-11-16T20:00:00+07:00');
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
        collectPage: async (req) => {
          if (req.site === 'youtube-studio') {
            return {
              ok: true,
              snapshot: makeSnap({
                url: req.targetUrl,
                bodySample: 'Past 28 days · Views: 14,200 · Watch time (hours): 412 · Subscribers: 890 · Copyright claim noticed on audio track.',
              }),
            };
          }
          if (req.targetUrl.includes('unlaunched')) {
            return {
              ok: true,
              snapshot: makeSnap({
                url: req.targetUrl,
                headings: ['New Unlaunched App'],
                bodySample: 'Coming soon — not launched yet · Notify me',
              }),
            };
          }
          return {
            ok: false,
            gate: 'BLOCKED_CHALLENGE',
            gateReason: 'Cloudflare challenge on producthunt.com',
          };
        },
      });

      const yt = await rt.read({
        site: 'youtube-studio',
        view: 'channel.analytics',
        evidence: 'off',
        caller: { bot: 'Growth', routine: 'YouTube growth daily' },
      });
      expect(yt.ok).toBe(true);
      expect(yt.gate).toBe('CLEAR');
      expect(yt.data.views).toBe(14200);
      expect(yt.data.watch_time_hours).toBe(412);
      expect(yt.data.subscribers).toBe(890);
      expect(yt.notes.some((n) => n.includes('copyright/claim'))).toBe(true);

      const unlaunched = await rt.read({
        site: 'producthunt',
        view: 'product.page',
        target: 'https://www.producthunt.com/products/unlaunched',
        evidence: 'off',
        caller: { bot: 'Unikorn', routine: 'PH checks' },
      });
      expect(unlaunched.data.upvotes).toBeNull();
      expect(unlaunched.notes.join(' ')).toContain('not launched yet');

      const phBlocked = await rt.read({
        site: 'producthunt',
        view: 'product.page',
        target: 'https://www.producthunt.com/products/design-os-studio',
        max_age_s: 0,
        evidence: 'off',
        caller: { bot: 'Unikorn', routine: 'PH checks' },
      });
      expect(phBlocked.gate).toBe('PAUSED_BY_GUARD');
      expect(rt.guard.getGuard('producthunt').state).toBe('PAUSED');
      expect(rt.guard.getGuard('youtube-studio').state).toBe('CLEAR');
    } finally {
      cache.close();
    }
  });

  it('#16 R4 Reddit karma & thing score (removed item flagged removed=true, score=null)', async () => {
    const cache = new LinkedInSqliteCache(':memory:');
    try {
      let nowMs = Date.parse('2026-11-16T21:00:00+07:00');
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
        collectPage: async (req) => {
          if (req.view === 'user.self') {
            return {
              ok: true,
              snapshot: makeSnap({
                url: req.targetUrl,
                headings: ['u/jangtrinh'],
                bodySample: '1,420 Post karma · 830 Comment karma · Cake day: Mar 2019',
              }),
            };
          }
          if (req.targetUrl.includes('removed1')) {
            return {
              ok: true,
              snapshot: makeSnap({
                url: req.targetUrl,
                bodySample: '[removed] Sorry, this post was removed by moderators. 4 comments',
              }),
            };
          }
          return {
            ok: true,
            snapshot: makeSnap({
              url: req.targetUrl,
              bodySample: '47 points · 12 comments',
            }),
          };
        },
      });

      const selfRes = await rt.read({
        site: 'reddit',
        view: 'user.self',
        target: 'https://www.reddit.com/user/jangtrinh/',
        evidence: 'off',
        caller: { bot: 'Growth', routine: 'reddit-karma' },
      });
      expect(selfRes.data.post_karma).toBe(1420);
      expect(selfRes.data.comment_karma).toBe(830);
      expect(selfRes.data.total_karma).toBe(2250);

      nowMs += 15_000;
      const removedRes = await rt.read({
        site: 'reddit',
        view: 'thing.score',
        target: 'https://www.reddit.com/r/DesignSystems/comments/removed1/test/',
        evidence: 'off',
        caller: { bot: 'Community', routine: 'reddit-scores' },
      });
      expect(removedRes.data.removed).toBe(true);
      expect(removedRes.data.score).toBeNull();
      expect(removedRes.data.replies).toBe(4);
    } finally {
      cache.close();
    }
  });
});
