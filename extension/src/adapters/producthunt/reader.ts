import type { CollectedPageSnapshot } from '../../../../shared/reader-schema.js';
import { parseCount } from '../linkedin/aria-nodes.js';

export function parseProductHuntProductPage(snap: CollectedPageSnapshot): {
  data: Record<string, unknown>;
  missing_required: string[];
  notes: string[];
} {
  const texts = [...snap.headings, ...snap.axNodes.map((n) => n.text || n.name), snap.bodySample].filter(Boolean);
  const slug = snap.url.match(/\/products\/([^/?#]+)|\/posts\/([^/?#]+)/)?.[1] ?? snap.url.match(/\/posts\/([^/?#]+)/)?.[1] ?? 'unknown';
  const name = snap.headings[0]?.trim() || snap.title.split('|')[0]?.trim() || slug;

  const notLaunched = /(not launched yet|coming soon|notify me)/i.test(snap.bodySample);
  let upvotes: number | null = null;
  let upvotesText: string | null = null;
  for (const t of texts) {
    const m = t.match(/([\d,.]+[KkMm]?)\s*(?:upvotes?|points?)\b|\b(?:upvote|votes?)\s*([\d,.]+[KkMm]?)/i);
    if (m) {
      upvotes = parseCount(m[1] ?? m[2]) ?? null;
      upvotesText = m[0].trim();
      break;
    }
  }
  if (notLaunched && upvotes === null) upvotesText = null;

  let commentsCount: number | null = null;
  for (const t of texts) {
    const m = t.match(/([\d,.]+[KkMm]?)\s*comments?/i);
    if (m) {
      commentsCount = parseCount(m[1]) ?? null;
      break;
    }
  }

  const dailyRankM = texts.join(' ').match(/#(\d+)\s+Product of the Day/i);
  const weeklyRankM = texts.join(' ').match(/#(\d+)\s+Product of the Week/i);
  const followersM = texts.join(' ').match(/([\d,.]+[KkMm]?)\s+followers?/i);

  const notes: string[] = [];
  if (notLaunched) notes.push('Product is not launched yet; upvotes set to null.');

  return {
    data: {
      slug,
      name,
      url: snap.finalUrl || snap.url,
      upvotes: notLaunched ? null : upvotes,
      upvotes_text: notLaunched ? null : upvotesText,
      comments_count: commentsCount,
      daily_rank: dailyRankM ? Number(dailyRankM[1]) : null,
      weekly_rank: weeklyRankM ? Number(weeklyRankM[1]) : null,
      followers: parseCount(followersM?.[1]) ?? null,
    },
    missing_required: name ? [] : ['name'],
    notes,
  };
}
