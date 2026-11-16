import { shortHash8 } from '../../../../shared/hash.js';
import type { CollectedPageSnapshot } from '../../../../shared/reader-schema.js';
import { parseCount } from '../linkedin/aria-nodes.js';

export function parseUnikornProductPage(
  snap: CollectedPageSnapshot,
  params: Record<string, unknown>
): {
  data: Record<string, unknown>;
  missing_required: string[];
  notes: string[];
} {
  let slug: string | null = null;
  if (typeof params.slug === 'string' && params.slug.trim()) {
    slug = params.slug.trim();
  } else {
    const m = (snap.url || snap.finalUrl).match(/\/(?:p|products)\/([^/?#]+)/i);
    if (m) slug = m[1];
  }

  let name: string | null = null;
  if (snap.headings.length > 0 && snap.headings[0].trim()) {
    name = snap.headings[0].trim();
  } else {
    for (const n of snap.axNodes) {
      if (n.role === 'heading' && n.name.trim()) {
        name = n.name.trim();
        break;
      }
    }
  }
  if (!name && snap.title) {
    const parts = snap.title.split(/\s+[|\-–]\s+/);
    if (parts[0]?.trim()) {
      name = parts[0].trim();
    }
  }

  const allTexts = [
    ...snap.headings,
    ...snap.axNodes.map((n) => (n.text ? `${n.name} ${n.text}` : n.name)),
    snap.bodySample,
  ].filter(Boolean);
  const joined = allTexts.join('\n');

  const pointsM = joined.match(/(\d[\d,.]*[KkMm]?)\s*(?:points?|điểm|upvotes?)\b/i);
  const points = pointsM ? (parseCount(pointsM[1]) ?? null) : null;

  const rankM = joined.match(/(?:^|\s|·)#\s*(\d+)\b|rank\s*#?\s*(\d+)\b/i);
  const rank = rankM ? Number(rankM[1] ?? rankM[2]) : null;

  const viewsM = joined.match(/(\d[\d,.]*[KkMm]?)\s*(?:views?|lượt xem)\b/i);
  const views = viewsM ? (parseCount(viewsM[1]) ?? null) : null;

  const ratingM = joined.match(
    /\b([0-5](?:\.\d{1,2})?)\s*(?:\/\s*5|★|stars?|sao|out of 5|from\s+\d[\d,]*\s*(?:reviews?|đánh giá)|\([\d,]+\s*(?:reviews?|đánh giá)\))/i
  );
  let rating: number | null = null;
  if (ratingM) {
    const r = Number(ratingM[1]);
    if (Number.isFinite(r) && r >= 0 && r <= 5) rating = r;
  }

  const reviewsM = joined.match(/(\d[\d,.]*)\s*(?:reviews?|đánh giá)\b/i);
  const reviewCount = reviewsM ? (parseCount(reviewsM[1]) ?? null) : null;

  let latestUpdate: { key: string; title: string; date: string } | null = null;
  const lines = [
    ...snap.axNodes.map((n) => (n.text ? `${n.name} - ${n.text}` : n.name)),
    ...snap.bodySample.split(/\r?\n/),
  ].map((s) => s.trim()).filter(Boolean);

  for (const line of lines) {
    if (/(?:latest\s+update|changelog|bản\s+cập\s+nhật|\bupdate\b)/i.test(line)) {
      const dateM = line.match(/(202\d-\d{2}-\d{2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/);
      const date = dateM ? dateM[1] : '';
      let title = line
        .replace(/(?:latest\s+update|changelog|bản\s+cập\s+nhật|\bupdate\b)[:\-–\s]*/i, '')
        .replace(date, '')
        .replace(/\(\s*\)|\[\s*\]/g, '')
        .replace(/^[•·\-–\s:]+/, '')
        .trim();
      if (!title) title = 'Update';
      if (title.length > 80) title = title.slice(0, 80).trim();
      const key = `${slug ?? 'unknown'}:${title}:${date}`.trim();
      latestUpdate = { key, title, date };
      break;
    }
  }

  const missingRequired = [...(!slug ? ['slug'] : []), ...(!name ? ['name'] : [])];

  return {
    data: {
      slug,
      name,
      url: snap.finalUrl || snap.url,
      points,
      rank,
      views,
      rating,
      review_count: reviewCount,
      latest_update: latestUpdate,
    },
    missing_required: missingRequired,
    notes: [],
  };
}

export function parseUnikornProductComments(
  snap: CollectedPageSnapshot,
  params: Record<string, unknown>
): {
  data: Record<string, unknown>;
  missing_required: string[];
  notes: string[];
} {
  let slug: string | null = null;
  if (typeof params.slug === 'string' && params.slug.trim()) {
    slug = params.slug.trim();
  } else {
    const m = (snap.url || snap.finalUrl).match(/\/(?:p|products)\/([^/?#]+)/i);
    if (m) slug = m[1];
  }

  const prevIds = new Set<string>(
    Array.isArray(params.previous_comment_ids) ? params.previous_comment_ids.map(String) : []
  );

  interface ParsedComment {
    id: string;
    author_name: string;
    author_url: string | null;
    created_at: string;
    text: string;
    third_party: true;
    new: boolean;
  }

  const comments: ParsedComment[] = [];
  const seenIds = new Set<string>();

  for (const node of snap.axNodes) {
    if (node.role === 'comment' || node.role === 'article' || (node.role === 'listitem' && node.text)) {
      const text = (node.text || node.name || '').trim();
      if (!text || text.length < 3) continue;

      let id = '';
      if (node.href) {
        const idM = node.href.match(/#comment-([a-zA-Z0-9_-]+)/);
        if (idM) id = idM[1];
      }

      let authorName = node.role === 'comment' && node.name && node.text ? node.name.trim() : 'Anonymous';
      const authorUrl = node.href && !node.href.includes('#comment-') ? node.href : null;
      let createdAt = '';

      const dateM = text.match(/(202\d-\d{2}-\d{2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|\d+\s+(?:hours?|days?|weeks?|months?)\s+ago)/i);
      if (dateM) createdAt = dateM[1];

      if (!id) {
        id = shortHash8(`${slug ?? ''}:${authorName}:${createdAt}:${text}`);
      }

      if (!seenIds.has(id)) {
        seenIds.add(id);
        comments.push({
          id,
          author_name: authorName,
          author_url: authorUrl,
          created_at: createdAt,
          text,
          third_party: true,
          new: !prevIds.has(id),
        });
      }
    }
  }

  return {
    data: {
      slug,
      url: snap.finalUrl || snap.url,
      comments_count: comments.length,
      new_count: comments.filter((c) => c.new).length,
      comments,
    },
    missing_required: slug ? [] : ['slug'],
    notes: [],
  };
}
