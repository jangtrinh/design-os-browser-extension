import { shortHash8 } from '../../../../shared/hash.js';
import type { CollectedPageSnapshot } from '../../../../shared/reader-schema.js';
import { parseCount } from '../linkedin/aria-nodes.js';

function matchMetricWithText(texts: string[], labelRe: RegExp): { value: number | null; text: string | null } {
  for (const t of texts) {
    const mBefore = t.match(new RegExp(`(\\d[\\d,.]*[KkMm]?)\\s+${labelRe.source}`, 'i'));
    if (mBefore) {
      const val = parseCount(mBefore[1]) ?? null;
      return { value: val, text: mBefore[0].trim() };
    }
    const mAfter = t.match(new RegExp(`${labelRe.source}\\s*[:\\-]?\\s*(\\d[\\d,.]*[KkMm]?)`, 'i'));
    if (mAfter) {
      const val = parseCount(mAfter[1]) ?? null;
      return { value: val, text: mAfter[0].trim() };
    }
  }
  return { value: null, text: null };
}

export function parseXArticleStats(snap: CollectedPageSnapshot): {
  data: Record<string, unknown>;
  missing_required: string[];
  notes: string[];
} {
  const texts = [snap.title, ...snap.headings, ...snap.axNodes.map((n) => n.text || n.name), snap.bodySample].filter(Boolean);
  const articleId =
    snap.url.match(/\/(?:i\/)?articles?\/([A-Za-z0-9_-]+)/)?.[1] ??
    snap.url.match(/status\/(\d+)/)?.[1] ??
    shortHash8(snap.url);
  const title = snap.headings.find((h) => !/^(analytics|article\s+stats)$/i.test(h)) || snap.title.replace(/\s*\/\s*X$/, '').trim() || null;

  const impressions = matchMetricWithText(texts, /(?:impressions?|views?)/);
  const engagements = matchMetricWithText(texts, /engagements?/);
  const likes = matchMetricWithText(texts, /likes?/);
  const reposts = matchMetricWithText(texts, /reposts?/);
  const replies = matchMetricWithText(texts, /replies?/);
  const bookmarks = matchMetricWithText(texts, /bookmarks?/);

  const missing: string[] = [];
  if (impressions.value === null) missing.push('impressions');

  return {
    data: {
      article_id: articleId,
      url: snap.finalUrl || snap.url,
      title,
      period: 'lifetime',
      impressions: impressions.value,
      impressions_text: impressions.text,
      engagements: engagements.value,
      engagements_text: engagements.text,
      likes: likes.value,
      reposts: reposts.value,
      replies: replies.value,
      bookmarks: bookmarks.value,
    },
    missing_required: missing,
    notes: [],
  };
}

export function parseXArticlesList(snap: CollectedPageSnapshot): {
  data: Record<string, unknown>;
  missing_required: string[];
  notes: string[];
} {
  const seen = new Set<string>();
  const articles: Array<{ id: string; url: string; title: string | null }> = [];
  for (const link of [...snap.links, ...snap.axNodes.filter((n) => n.href).map((n) => ({ text: n.name, href: n.href! }))]) {
    if (!/\/(?:i\/)?articles?\/|\/article\//.test(link.href)) continue;
    const id = link.href.match(/articles?\/([A-Za-z0-9_-]+)/)?.[1] ?? shortHash8(link.href);
    if (seen.has(id)) continue;
    seen.add(id);
    articles.push({ id, url: link.href, title: link.text || null });
  }
  return {
    data: { page_url: snap.url, articles },
    missing_required: [],
    notes: [],
  };
}

export function parseXAccountAnalytics(snap: CollectedPageSnapshot): {
  data: Record<string, unknown>;
  missing_required: string[];
  notes: string[];
} {
  const texts = [...snap.headings, ...snap.axNodes.map((n) => n.text || n.name), snap.bodySample].filter(Boolean);
  const impressions = matchMetricWithText(texts, /impressions?/);
  const engagements = matchMetricWithText(texts, /engagements?/);
  const profileVisits = matchMetricWithText(texts, /profile visits?/);
  const period = snap.bodySample.match(/\b(past \d+ days|7 days|28 days|30 days)\b/i)?.[1]?.toLowerCase().replace(/\s+/g, '_') ?? 'past_7_days';

  return {
    data: {
      page_url: snap.url,
      period,
      impressions: impressions.value,
      impressions_text: impressions.text,
      engagements: engagements.value,
      profile_visits: profileVisits.value,
    },
    missing_required: impressions.value === null ? ['impressions'] : [],
    notes: [],
  };
}

/** Joins X connector post impressions with extension-read X Articles series totals cleanly. */
export function combineXNightlyMetrics(
  connectorPosts: Array<{ post_id: string; impressions: number }>,
  articleSeriesRows: Array<{ article_id: string; impressions: number }>,
): {
  connector_posts_impressions: number;
  reader_articles_impressions: number;
  total_impressions: number;
  article_count: number;
  post_count: number;
  sources: { posts: 'x-connector'; articles: 'extension-reader' };
} {
  const connectorTotal = connectorPosts.reduce((acc, p) => acc + Number(p.impressions || 0), 0);
  const articleTotal = articleSeriesRows.reduce((acc, a) => acc + Number(a.impressions || 0), 0);
  return {
    connector_posts_impressions: connectorTotal,
    reader_articles_impressions: articleTotal,
    total_impressions: connectorTotal + articleTotal,
    post_count: connectorPosts.length,
    article_count: articleSeriesRows.length,
    sources: { posts: 'x-connector', articles: 'extension-reader' },
  };
}
