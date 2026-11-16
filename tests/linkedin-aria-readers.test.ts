import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readAnalytics, readComments } from '../extension/src/adapters/linkedin/aria-analytics.js';
import { parseCount } from '../extension/src/adapters/linkedin/aria-nodes.js';
import { readFeed, readPost, readProfile, readSearch } from '../extension/src/adapters/linkedin/aria-readers.js';
import type { AxNode } from '../extension/src/adapters/linkedin/aria-nodes.js';
import { LinkedInSqliteCache } from '../cli/src/db/sqlite-cache.js';

// Redacted `observe` snapshots from the live pilot (docs/pilot/2026-11-16-linkedin-live/raw/).
const RAW = resolve(__dirname, '../docs/pilot/2026-11-16-linkedin-live/raw');
function pilot(file: string): { url: string; nodes: AxNode[] } {
  const json = JSON.parse(readFileSync(resolve(RAW, file), 'utf8')) as { data: { url: string; nodes: AxNode[] } };
  return { url: json.data.url, nodes: json.data.nodes };
}

describe('ARIA readers on live-pilot snapshots (LinkedIn SDUI)', () => {
  it('parses LinkedIn counts', () => {
    expect(parseCount('8,741')).toBe(8741);
    expect(parseCount('500+')).toBe(500);
    expect(parseCount('1.2K')).toBe(1200);
    expect(parseCount('n/a')).toBeUndefined();
  });

  it('profile: name, headline, followers and connections (pilot task 1 was PARTIAL: name fell back to slug)', () => {
    const { url, nodes } = pilot('05-observe-profile.json');
    const p = readProfile(nodes, url);
    expect(p.publicIdentifier).toBe('jangtrinh');
    expect(p.fullName).toBe('Jang Trinh');
    expect(p.headline).toMatch(/^Principal Product Engineer @ VinSmart Future/);
    expect(p.followersCount).toBe(8741);
    expect(p.connectionsText).toBe('500+ connections');
    expect(p.missingRequired).toBeUndefined();
  });

  it('profile of a search result: uses the page heading, not the "· 1st" fragment', () => {
    const { url, nodes } = pilot('22-observe-search-result-profile.json');
    const p = readProfile(nodes, url);
    expect(p.fullName).toBe('[redacted:3a21b502]');
    expect(p.headline ?? '').not.toContain('1st');
  });

  it('post: urn from URL, author, reactions, impressions (pilot task 3 cached postUrn "unknown")', () => {
    const { url, nodes } = pilot('30-observe-post-full-settled.json');
    const post = readPost(nodes, url);
    expect(post.postUrn).toBe('urn:li:share:7525934959287635969');
    expect(post.activityUrn).toBe('urn:li:activity:7525934960248156160');
    expect(post.authorName).toBe('Jang Trinh');
    expect(post.authorName).not.toBe('0 notifications');
    expect(post.reactionsCount).toBe(7);
    expect(post.impressionsCount).toBe(760);
    expect(post.missingRequired).toBeUndefined();
  });

  it('feed: reads every "Feed post" on recent activity, newest first (pilot returned posts: [])', () => {
    const { url, nodes } = pilot('13-observe-recent-activity.json');
    const feed = readFeed(nodes, url);
    // 5 "Feed post" headings; the 5th is cut off by --max-nodes 120 before any URN-bearing link.
    expect(feed.posts).toHaveLength(4);
    expect(new Set(feed.posts.map((p) => p.postUrn)).size).toBe(4);
    expect(feed.posts[0].postUrn).toBe('urn:li:share:7527725340845256704');
    expect(feed.posts[0].activityUrn).toBe('urn:li:activity:7527725342086721537');
    expect(feed.posts[0].authorName).toBe('Jang Trinh');
    expect(feed.posts[0].reactionsCount).toBe(2);
    expect(feed.posts[2].reactionsCount).toBe(3);
  });

  it('search people: one item per result card, mutual-connection links skipped (pilot returned items: [])', () => {
    const { url, nodes } = pilot('19-observe-search.json');
    const res = readSearch(nodes, url, 'people', 'design system');
    expect(res.items).toHaveLength(10);
    expect(res.items[0].identifier).toBe('[member:66df1786]');
    expect(res.items[0].title).toBe('[redacted:3a21b502]');
    expect(new Set(res.items.map((i) => i.identifier)).size).toBe(10);
  });
});

describe('Analytics reader', () => {
  it('profile page: followers, connections, profile views, 7-day impressions, search appearances', () => {
    const { url, nodes } = pilot('05-observe-profile.json');
    const a = readAnalytics(nodes, url);
    expect(a.pageKind).toBe('profile');
    expect(a.metrics).toEqual({
      followers: 8741,
      connections: 500,
      profileViewers: 638,
      postImpressions: 3776,
      postImpressionsPeriod: 'past_7_days',
      searchAppearances: 59,
    });
  });

  it('creator content page: per-post impressions and engagements', () => {
    const { url, nodes } = pilot('07-observe-analytics-content-settled.json');
    const a = readAnalytics(nodes, url);
    expect(a.pageKind).toBe('creator-content');
    expect(a.posts.map((p) => [p.impressions, p.engagements])).toEqual([
      [759, 20],
      [550, 3],
      [299, 4],
    ]);
    expect(a.posts[0].activityUrn).toBe('urn:li:activity:7525934960248156160');
    expect(a.posts[0].postUrn).toBe('urn:li:share:7525934959287635969');
    expect(a.posts[1].postUrn).toBe('urn:li:ugcPost:7522949830768328704');
  });

  it('post page: profile viewers / impressions sidebar and the post impressions', () => {
    const { url, nodes } = pilot('30-observe-post-full-settled.json');
    const a = readAnalytics(nodes, url);
    expect(a.metrics.profileViewers).toBe(638);
    expect(a.metrics.postImpressions).toBe(3780);
    expect(a.posts).toEqual([
      expect.objectContaining({ activityUrn: 'urn:li:activity:7525934960248156160', impressions: 760 }),
    ]);
  });

  it('profile views page: lists the (redacted) viewer cards without duplicates', () => {
    const { url, nodes } = pilot('10-observe-profile-views-settled.json');
    const a = readAnalytics(nodes, url);
    expect(a.pageKind).toBe('profile-views');
    expect(a.recentViewers?.length).toBe(6);
    expect(a.recentViewers?.every((v) => v.name.startsWith('[redacted:'))).toBe(true);
  });
});

describe('Comments reader', () => {
  it('pilot post page: reports comments as not rendered instead of guessing', () => {
    const { url, nodes } = pilot('30-observe-post-full-settled.json');
    const c = readComments(nodes, url);
    expect(c.postUrn).toBe('urn:li:share:7525934959287635969');
    expect(c.commentsRendered).toBe(false);
    expect(c.comments).toEqual([]);
    expect(c.note).toMatch(/never clicks/);
  });

  it('expanded comment section (synthetic ARIA fixture): authors, text, counts, replies', () => {
    const fx = JSON.parse(
      readFileSync(resolve(__dirname, 'fixtures/linkedin-aria/post-with-comments.synthetic.json'), 'utf8'),
    ) as { url: string; nodes: AxNode[] };
    const c = readComments(fx.nodes, fx.url);
    expect(c.commentsCount).toBe(2);
    expect(c.commentsRendered).toBe(true);
    expect(c.comments).toEqual([
      expect.objectContaining({ authorName: 'Fictional Reader', text: 'Great work on this!', isReply: false, reactionsCount: 3, repliesCount: 1 }),
      expect.objectContaining({ authorName: 'Example Author', text: 'Thanks!', isReply: true }),
    ]);
  });
});

describe('Cache guard', () => {
  it('does not persist reads with missing required fields', () => {
    const cache = new LinkedInSqliteCache(':memory:');
    try {
      cache.upsertFromActionResult('linkedin.post.get', { postUrn: 'unknown', url: 'x', authorName: '', text: '', missingRequired: ['postUrn'] });
      const { url, nodes } = pilot('30-observe-post-full-settled.json');
      cache.upsertFromActionResult('linkedin.post.get', readPost(nodes, url));
      const rows = cache.queryReadOnlySql('SELECT post_urn, author_name FROM posts');
      expect(rows).toEqual([{ post_urn: 'urn:li:share:7525934959287635969', author_name: 'Jang Trinh' }]);
    } finally {
      cache.close();
    }
  });
});
