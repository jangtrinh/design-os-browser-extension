import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LinkedInSqliteCache } from '../cli/src/db/sqlite-cache.js';
import { getReaderDescriptor } from '../cli/src/reader/reader-registry.js';
import { registerAllReaders } from '../cli/src/reader/register-all.js';
import { ReaderRuntime } from '../cli/src/reader/reader-runtime.js';
import { parseGenericListingStatus } from '../extension/src/adapters/generic/reader.js';
import { parseJobsSearchResults } from '../extension/src/adapters/jobs/reader.js';
import { parseUnikornProductComments, parseUnikornProductPage } from '../extension/src/adapters/unikorn/reader.js';
import type { CollectedPageSnapshot } from '../shared/reader-schema.js';

// Sanitized captures from a fresh logged-out Chromium profile (2026-11-17 routine findings #3, #7,
// #8). Third-party commenter names and profile slugs are replaced with placeholders.
const fixture = (name: string): CollectedPageSnapshot =>
  JSON.parse(readFileSync(join(__dirname, 'fixtures', 'parsers', `${name}.snapshot.json`), 'utf8')) as CollectedPageSnapshot;

describe('Bug 3: Unikorn product page and comments', () => {
  registerAllReaders();

  it('reads points, views, rank, name, rating, counts and latest update from the real layout', () => {
    const parsed = parseUnikornProductPage(fixture('unikorn-designos-studio'), {});
    expect(parsed.data).toMatchObject({
      slug: 'designos-studio',
      name: 'DESIGN:OS Studio',
      points: 256,
      views: 1494,
      rank: 15,
      rating: 5,
      review_count: 13,
      comment_count: 31,
    });
    const lu = parsed.data.latest_update as { title: string; version: string; date: string };
    expect(lu.version).toBe('v0.7.15');
    expect(lu.title).toMatch(/^DESIGN:OS Studio v0\.7\.15: /);
    expect(lu.title.length).toBeGreaterThan(20);
    expect(parsed.missing_required).toEqual([]);
  });

  it('reads the same fields from the live CSS layout (counts and tabs split across spans)', () => {
    const page = parseUnikornProductPage(fixture('unikorn-designos-studio.live-layout'), {});
    expect(page.data).toMatchObject({ name: 'DESIGN:OS Studio', points: 256, views: 1495, rank: 15, rating: 5, review_count: 13, comment_count: 31 });
    expect(page.data.latest_update).toMatchObject({ version: 'v0.7.15', date: 'yesterday' });
    const comments = parseUnikornProductComments(fixture('unikorn-designos-studio.live-layout'), {});
    expect(comments.data.expected_top_level_count).toBe(16);
    expect(comments.data.comments_complete).toBe(false); // 0 blocks rendered: never complete
  });

  it('parses comment blocks in the live CSS layout (badge and separators on their own lines)', () => {
    const snap = fixture('unikorn-designos-studio.live-layout');
    const items = [
      { id: 'reply-p1', parentId: null, heading: 'Good product', links: [{ text: 'Commenter A', href: 'https://unikorn.vn/u/commenter-a' }],
        lines: ['Commenter A', 'Example product and 2 other products', '·', '25 ngày trước', 'Good product', 'Good product', '1', 'Reply', 'Jang Trịnh', 'Maker', 'DESIGN:OS Studio and 3 other products', '·', '23 ngày trước', 'Cảm ơn bạn đã ghé xem và ủng hộ nhé!', 'Like', 'Reply'] },
      { id: 'reply-c1', parentId: 'reply-p1', heading: null, links: [{ text: 'Jang Trịnh', href: 'https://unikorn.vn/u/jang' }],
        lines: ['Jang Trịnh', 'Maker', 'DESIGN:OS Studio and 3 other products', '·', '23 ngày trước', 'Cảm ơn bạn đã ghé xem và ủng hộ nhé!', 'Like', 'Reply'] },
    ];
    const comments = parseUnikornProductComments({ ...snap, items }, {}).data.comments as Array<Record<string, unknown>>;
    expect(comments[0]).toMatchObject({ id: 'p1', author_name: 'Commenter A', is_maker: false, title: 'Good product', created_at: '25 ngày trước' });
    expect(comments[1]).toMatchObject({ id: 'c1', parent_id: 'p1', author_name: 'Jang Trịnh', is_maker: true, text: 'Cảm ơn bạn đã ghé xem và ủng hộ nhé!' });
  });

  it('keeps the product name readable through redaction (own product, not a person)', async () => {
    const cache = new LinkedInSqliteCache(':memory:');
    try {
      const rt = new ReaderRuntime({
        cache,
        mirrorAuditToFile: false,
        collectPage: async () => ({ ok: true, snapshot: fixture('unikorn-designos-studio') }),
      });
      const env = await rt.read({
        site: 'unikorn',
        view: 'product.page',
        target: 'https://unikorn.vn/p/designos-studio',
        caller: { bot: 'Growth', routine: 'unikorn' },
      });
      expect(env.ok).toBe(true);
      expect(env.data.name).toBe('DESIGN:OS Studio');
      expect(env.data.points).toBe(256);
    } finally {
      cache.close();
    }
  });

  it('an error / not-found page is incomplete, never product data', () => {
    const base = fixture('unikorn-designos-studio');
    const parsed = parseUnikornProductPage(
      { ...base, title: 'unikorn.vn | 502: Bad gateway', headings: ['Bad gateway Error code 502'], meta: {}, textLines: ['Bad gateway Error code 502'] },
      {},
    );
    expect(parsed.data.name).toBeNull();
    expect(parsed.missing_required).toEqual(expect.arrayContaining(['name', 'points']));
  });

  it('parses comment blocks with author, maker flag and parent, and reports incomplete vs the page count', () => {
    const parsed = parseUnikornProductComments(fixture('unikorn-designos-studio'), {});
    const comments = parsed.data.comments as Array<{ id: string; parent_id: string | null; author_name: string; is_maker: boolean; title: string | null; text: string }>;
    expect(comments).toHaveLength(10);
    expect(parsed.data.top_level_count).toBe(5);
    expect(parsed.data.expected_top_level_count).toBe(16);
    expect(parsed.data.expected_comment_count).toBe(31);
    expect(parsed.data.comments_complete).toBe(false);
    expect(parsed.missing_required).toContain('comments');

    const top = comments.find((c) => c.id === '26352e8f-c6ed-4aaa-a79a-3b2ec39c0a87');
    expect(top).toMatchObject({ parent_id: null, author_name: 'Commenter B', is_maker: false, title: 'Good product' });
    expect(top?.text).not.toContain('Cảm ơn'); // nested maker reply is not glued into the parent
    const reply = comments.find((c) => c.parent_id === '26352e8f-c6ed-4aaa-a79a-3b2ec39c0a87');
    expect(reply).toMatchObject({ author_name: 'Jang Trịnh', is_maker: true, text: 'Cảm ơn bạn nhiều nha!' });
  });

  it('asks the collector for comment blocks', () => {
    expect(getReaderDescriptor('unikorn', 'product.comments')?.itemSelector).toBe('[id^="reply-"]');
  });
});

describe('Bug 6: generic listing.status on a GitHub repo page', () => {
  it('does not match "Skip to content", a PR number as rank, or "Verified" inside a sentence', () => {
    const parsed = parseGenericListingStatus(fixture('github-repo-page'), { product_name: 'design-os' });
    expect(parsed.data.listed).toBe(true);
    expect(parsed.data.title).not.toBe('Skip to content');
    expect(String(parsed.data.url)).not.toContain('#start-of-content');
    expect(parsed.data.rank).toBeNull();
    expect(parsed.data.badge).toBeNull();
  });

  it('still reads explicit rank and badge labels on a directory page', () => {
    const snap = { ...fixture('github-repo-page'), url: 'https://dir.example/tools', finalUrl: 'https://dir.example/tools', links: [{ text: 'DESIGN:OS Studio', href: 'https://unikorn.vn/p/designos-studio' }], textLines: ['DESIGN:OS Studio', 'Featured', 'Ranked #3 this week'], bodySample: '' };
    const parsed = parseGenericListingStatus(snap, { product_name: 'DESIGN:OS' });
    expect(parsed.data.badge).toBe('Featured');
    expect(parsed.data.rank).toBe(3);
  });
});

describe('Bug 7: Dribbble jobs', () => {
  registerAllReaders();

  it('reads title and company from job cards and drops the "Post a Full-Time Job" link', () => {
    const parsed = parseJobsSearchResults(fixture('dribbble-jobs'), {});
    const items = parsed.data.items as Array<{ id: string; title: string; company: string | null; url: string; remote: boolean }>;
    expect(items).toHaveLength(6);
    expect(items.every((i) => /^\d+$/.test(i.id))).toBe(true);
    expect(items.some((i) => i.url.includes('/jobs/new'))).toBe(false);
    expect(items.some((i) => /view job|post a/i.test(i.title))).toBe(false);
    expect(items[0]).toMatchObject({ id: '310307', title: 'Product Designer (Mobile Apps)', company: 'Codeway', url: 'https://dribbble.com/jobs/310307-Product-Designer-Mobile-Apps' });
    expect(items.every((i) => i.company && i.company !== 'Unknown')).toBe(true);
    expect(parsed.missing_required).toEqual([]);
  });

  it('without card blocks, a CTA link text never becomes the title', () => {
    const snap = { ...fixture('dribbble-jobs'), items: undefined, links: [{ text: 'View job', href: 'https://dribbble.com/jobs/310307-Product-Designer-Mobile-Apps' }, { text: 'Post a Full-Time Job →', href: 'https://dribbble.com/jobs/new' }] };
    const items = parseJobsSearchResults(snap, {}).data.items as Array<{ title: string }>;
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Product Designer Mobile Apps');
  });

  it('an empty board read is incomplete', () => {
    const snap = { ...fixture('dribbble-jobs'), items: [], links: [] };
    expect(parseJobsSearchResults(snap, {}).missing_required).toContain('items');
  });

  it('asks the collector for job cards', () => {
    expect(getReaderDescriptor('jobs', 'search.results')?.itemSelector).toBe('li.job-list-item');
  });
});
