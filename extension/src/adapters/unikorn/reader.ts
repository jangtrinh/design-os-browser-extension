import { shortHash8 } from '../../../../shared/hash.js';
import type { CollectedItemBlock, CollectedPageSnapshot } from '../../../../shared/reader-schema.js';
import { parseCount } from '../linkedin/aria-nodes.js';

/** Selector for Unikorn review/comment blocks (`<div id="reply-<uuid>">`), forwarded to the collector. */
export const UNIKORN_COMMENT_SELECTOR = '[id^="reply-"]';

const NOT_FOUND_RE = /(product not found|page not found|không tìm thấy|bad gateway|error code 5\d\d|\b50[234]:)/i;
const NUMBER_LINE_RE = /^\d[\d,.]*[KkMm]?$/;
const RELATIVE_TIME_RE =
  /(yesterday|today|just now|\d+\s+(?:minutes?|hours?|days?|weeks?|months?|years?)\s+ago|about\s+\d+\s+\w+\s+ago|(?:khoảng\s+)?\d+\s+(?:phút|giờ|ngày|tuần|tháng|năm)\s+trước|\d{1,2}\/\d{1,2}\/\d{4}|202\d-\d{2}-\d{2})/i;

function slugOf(snap: CollectedPageSnapshot, params: Record<string, unknown>): string | null {
  if (typeof params.slug === 'string' && params.slug.trim()) return params.slug.trim();
  const m = (snap.url || snap.finalUrl).match(/\/(?:p|products)\/([^/?#]+)/i);
  return m ? m[1] : null;
}

function pageLines(snap: CollectedPageSnapshot): string[] {
  const lines = snap.textLines && snap.textLines.length > 0 ? snap.textLines : snap.bodySample.split(/\r?\n/);
  return lines.map((l) => l.trim()).filter(Boolean);
}

/** Value of a stats label: the number on the line after `label` (Stats panel renders label / value). */
function labelledNumber(lines: string[], labels: RegExp, from = 0): number | null {
  for (let i = from; i < lines.length - 1; i += 1) {
    if (labels.test(lines[i]) && NUMBER_LINE_RE.test(lines[i + 1])) {
      return parseCount(lines[i + 1]) ?? null;
    }
  }
  return null;
}

function isNotFound(snap: CollectedPageSnapshot): boolean {
  return NOT_FOUND_RE.test(snap.title) || snap.headings.slice(0, 3).some((h) => NOT_FOUND_RE.test(h));
}

export function parseUnikornProductPage(
  snap: CollectedPageSnapshot,
  params: Record<string, unknown>
): {
  data: Record<string, unknown>;
  missing_required: string[];
  notes: string[];
} {
  const slug = slugOf(snap, params);
  const notes: string[] = [];
  const url = snap.finalUrl || snap.url;

  if (isNotFound(snap)) {
    notes.push(`Unikorn returned an error or not-found page ("${snap.title.slice(0, 80)}"); no product data.`);
    return {
      data: { slug, name: null, url, points: null, rank: null, views: null, rating: null, review_count: null, comment_count: null, latest_update: null },
      missing_required: ['name', 'points'],
      notes,
    };
  }

  // Product name: og:image:alt is the clean name; the h1 glues the version badge ("Studiov0.7.15").
  const versionSuffix = /\s*v?\d+\.\d+(?:\.\d+)?(?:[-+][\w.]+)?$/;
  let name: string | null = snap.meta['og:image:alt']?.trim() || null;
  if (!name && snap.headings[0]?.trim()) name = snap.headings[0].trim().replace(versionSuffix, '').trim() || null;
  if (!name && snap.title) name = snap.title.split(/\s+[|\-–]\s+|:\s+/)[0]?.trim() || null;

  const lines = pageLines(snap);
  const statsAt = Math.max(0, lines.findIndex((l) => /^stats$/i.test(l)));

  // Points / views: the Stats panel ("Points" / "256", "Views" / "1,494"), else the sidebar
  // ("256" / "points, rank #15" and "views" / "1,494").
  let points = labelledNumber(lines, /^points$/i, statsAt);
  let rank: number | null = null;
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(/^points?,\s*rank\s*#\s*(\d+)/i);
    if (m) {
      rank = Number(m[1]);
      if (points === null && i > 0 && NUMBER_LINE_RE.test(lines[i - 1])) points = parseCount(lines[i - 1]) ?? null;
      break;
    }
  }
  if (rank === null) {
    const rm = lines.join('\n').match(/\brank\s*#\s*(\d+)\b/i);
    if (rm) rank = Number(rm[1]);
  }
  const labelledViews = labelledNumber(lines, /^views?$/i, statsAt) ?? labelledNumber(lines, /^(views?|lượt xem)$/i);
  let inlineViews: number | null = null;

  // Review / comment counts under the title. Rendered either inline ("5·", "13 reviews·31 comments")
  // or as separate spans ("5", "·", "13 reviews", "·", "31 comments").
  let reviewCount: number | null = null;
  let commentCount: number | null = null;
  let rating: number | null = null;
  const isDot = (l: string | undefined) => l !== undefined && /^·$/.test(l);
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(/^(\d[\d,.]*)\s*(?:reviews?|đánh giá)(?:\s*·\s*(\d[\d,.]*)\s*(?:comments?|bình luận))?$/i);
    if (!m) continue;
    reviewCount = parseCount(m[1]) ?? null;
    commentCount = m[2] ? (parseCount(m[2]) ?? null) : null;
    let k = i + 1;
    while (commentCount === null && k < Math.min(lines.length, i + 3)) {
      const cm = lines[k].match(/^(\d[\d,.]*)\s*(?:comments?|bình luận)$/i);
      if (cm) commentCount = parseCount(cm[1]) ?? null;
      if (!isDot(lines[k]) && !cm) break;
      k += 1;
    }
    let j = i - 1;
    while (j >= 0 && isDot(lines[j])) j -= 1;
    const rm = j >= 0 ? lines[j].match(/^([0-5](?:\.\d{1,2})?)\s*·?$/) : null;
    if (rm) rating = Number(rm[1]);
    break;
  }

  // Latest update: the block after the "Latest updates" heading: version line, then the title.
  let latestUpdate: { key: string; title: string; date: string; version?: string | null } | null = null;
  const luAt = lines.findIndex((l) => /^(latest updates?|bản cập nhật mới nhất)$/i.test(l));
  if (luAt >= 0) {
    const block = lines.slice(luAt + 1, luAt + 6);
    const version = block[0]?.match(/^v?\d+\.\d+(?:\.\d+)?$/) ? block[0] : null;
    const latestLine = block.find((l) => /^latest/i.test(l)) ?? '';
    const isDateLine = (l: string) => l.match(RELATIVE_TIME_RE)?.[1] === l;
    const date = block.find(isDateLine) ?? latestLine.match(RELATIVE_TIME_RE)?.[1] ?? '';
    const title = block.find((l) => l !== version && !/^latest/i.test(l) && !isDateLine(l) && l.length > 3) ?? null;
    if (title) {
      const cleanTitle = title.slice(0, 160).trim();
      latestUpdate = { key: `${slug ?? 'unknown'}:${version ?? ''}:${cleanTitle}`, title: cleanTitle, date, version };
    }
  }

  // Compact one-line layout ("#40 · 140 points · 712 views · 5.0 ★ (13 reviews)"), used by older
  // renders and fixtures. Only fills fields the labelled layout did not provide.
  for (const line of lines) {
    const parts = line.split(/\s*·\s*/);
    if (parts.length < 2) continue;
    for (const part of parts) {
      if (points === null) {
        const m = part.match(/^(\d[\d,.]*[KkMm]?)\s*(?:points?|điểm)$/i);
        if (m) points = parseCount(m[1]) ?? null;
      }
      if (inlineViews === null) {
        const m = part.match(/^(\d[\d,.]*[KkMm]?)\s*(?:views?|lượt xem)$/i);
        if (m) inlineViews = parseCount(m[1]) ?? null;
      }
      if (rank === null) {
        const m = part.match(/^#\s*(\d+)$/);
        if (m) rank = Number(m[1]);
      }
      if (rating === null) {
        const m = part.match(/^([0-5](?:\.\d{1,2})?)\s*(?:★|\/\s*5|stars?|sao)(?:\s*\((\d[\d,]*)\s*(?:reviews?|đánh giá)\))?$/i);
        if (m) {
          rating = Number(m[1]);
          if (reviewCount === null && m[2]) reviewCount = parseCount(m[2]) ?? null;
        }
      }
    }
  }
  if (!latestUpdate) {
    for (const line of lines) {
      const m = line.match(/^(?:latest\s+update|changelog|bản\s+cập\s+nhật)\s*(?:\(([^)]*)\))?\s*[:\-–]\s*(.+)$/i);
      if (m) {
        const date = m[1]?.trim() ?? '';
        const title = m[2].trim().slice(0, 160);
        latestUpdate = { key: `${slug ?? 'unknown'}:${title}:${date}`, title, date };
        break;
      }
    }
  }

  const missingRequired = [...(!slug ? ['slug'] : []), ...(!name ? ['name'] : []), ...(points === null ? ['points'] : [])];
  if (points === null) notes.push('Points not rendered on the page; result is incomplete.');

  return {
    data: {
      slug,
      name,
      url,
      points,
      rank,
      views: labelledViews ?? inlineViews,
      rating,
      review_count: reviewCount,
      comment_count: commentCount,
      latest_update: latestUpdate,
    },
    missing_required: missingRequired,
    notes,
  };
}

interface ParsedComment {
  id: string;
  parent_id: string | null;
  author_name: string;
  author_url: string | null;
  is_maker: boolean;
  created_at: string;
  title: string | null;
  text: string;
  third_party: true;
  new: boolean;
}

const UI_LINE_RE = /^(\d*\s*repl(?:y|ies)|like\s*reply|like|reply|trả lời|thích|load more|xem thêm)$/i;

/** Lines that belong to this block only (nested reply blocks are cut off). */
function ownLines(block: CollectedItemBlock, all: CollectedItemBlock[]): string[] {
  let lines = block.lines;
  for (const child of all) {
    if (!block.id || child.parentId !== block.id || child.lines.length === 0) continue;
    const at = lines.findIndex((_, i) => child.lines.every((cl, k) => lines[i + k] === cl));
    if (at > 0) lines = lines.slice(0, at);
  }
  return lines;
}

function parseCommentBlock(block: CollectedItemBlock, all: CollectedItemBlock[], slug: string | null, prevIds: Set<string>): ParsedComment | null {
  const lines = ownLines(block, all);
  if (lines.length === 0) return null;
  const authorLink = block.links.find((l) => /\/u\/[^/?#]+/.test(l.href) && l.text.trim());
  const rawAuthor = authorLink?.text.trim() ?? lines[0].replace(/Maker$/, '').trim();
  const isMaker = /maker$/i.test(lines[0]) || /^maker$/i.test(lines[1] ?? '');
  let createdAt = '';
  const body: string[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    const t = line.match(RELATIVE_TIME_RE);
    if (t && (line.replace(/^·/, '').trim() === t[1] || /·/.test(line) || / other products?/i.test(line))) {
      if (!createdAt) createdAt = t[1];
      continue;
    }
    if (/ and \d+ other products?$/i.test(line)) continue; // author subtitle
    if (UI_LINE_RE.test(line)) continue;
    if (/^(·|maker|\d+)$/i.test(line)) continue; // separators, the Maker badge, reply counts
    if (body[body.length - 1] === line) continue; // h4 title repeated in the summary paragraph
    body.push(line);
  }
  const heading = block.heading && body[0] === block.heading ? block.heading : null;
  const textLines = heading && body.length > 1 ? body.slice(1) : body;
  const id = block.id?.replace(/^reply-/, '') || shortHash8(`${slug ?? ''}:${rawAuthor}:${createdAt}:${body.join(' ')}`);
  return {
    id,
    parent_id: block.parentId?.replace(/^reply-/, '') ?? null,
    author_name: rawAuthor,
    author_url: authorLink?.href ?? null,
    is_maker: isMaker,
    created_at: createdAt,
    title: heading,
    text: textLines.join('\n'),
    third_party: true,
    new: !prevIds.has(id),
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
  const slug = slugOf(snap, params);
  const notes: string[] = [];
  const prevIds = new Set<string>(
    Array.isArray(params.previous_comment_ids) ? params.previous_comment_ids.map(String) : []
  );

  const comments: ParsedComment[] = [];
  const seen = new Set<string>();
  for (const block of snap.items ?? []) {
    const c = parseCommentBlock(block, snap.items ?? [], slug, prevIds);
    if (c && !seen.has(c.id)) {
      seen.add(c.id);
      comments.push(c);
    }
  }
  if (!snap.items) {
    // Older collectors without item blocks: ARIA comment nodes.
    for (const node of snap.axNodes) {
      if (node.role !== 'comment' && node.role !== 'article') continue;
      const text = (node.text || node.name || '').trim();
      if (text.length < 3) continue;
      const id = node.href?.match(/#comment-([a-zA-Z0-9_-]+)/)?.[1] ?? shortHash8(`${slug ?? ''}:${node.name}:${text}`);
      if (seen.has(id)) continue;
      seen.add(id);
      comments.push({
        id,
        parent_id: null,
        author_name: node.role === 'comment' && node.name && node.text ? node.name.trim() : 'Anonymous',
        author_url: null,
        is_maker: false,
        created_at: text.match(RELATIVE_TIME_RE)?.[1] ?? '',
        title: null,
        text,
        third_party: true,
        new: !prevIds.has(id),
      });
    }
  }

  // Expected counts the page itself shows: tab "All 16" (top-level threads) and "31 comments".
  const lines = pageLines(snap);
  let expectedThreads: number | null = null;
  let expectedComments: number | null = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    // Tab bar: inline "All 16Reviews 13Comments 3" or separate "All" / "16".
    const tab = line.match(/^(?:all|tất cả)\s*(\d+)/i) ?? (/^(?:all|tất cả)$/i.test(line) && /^\d+$/.test(lines[i + 1] ?? '') ? [line, lines[i + 1]] : null);
    if (tab && expectedThreads === null) expectedThreads = Number(tab[1]);
    const cm = line.match(/(?:^|·)\s*(\d[\d,.]*)\s*(?:comments?|bình luận)$/i);
    if (cm && expectedComments === null) expectedComments = parseCount(cm[1]) ?? null;
  }
  const topLevel = comments.filter((c) => !c.parent_id).length;
  const loadMoreVisible = lines.some((l) => /^(load more|xem thêm)$/i.test(l));
  const missingRequired: string[] = slug ? [] : ['slug'];

  let commentsComplete: boolean;
  if (isNotFound(snap)) {
    commentsComplete = false;
    notes.push(`Unikorn returned an error or not-found page ("${snap.title.slice(0, 80)}").`);
  } else if (comments.length === 0) {
    commentsComplete = false;
    notes.push('No comment blocks rendered; cannot confirm the product has no comments.');
  } else if (expectedThreads !== null && topLevel < expectedThreads) {
    commentsComplete = false;
    notes.push(`Rendered ${topLevel} of ${expectedThreads} top-level reviews/comments${loadMoreVisible ? ' ("Load more" not expanded)' : ''}.`);
  } else {
    commentsComplete = !loadMoreVisible;
    if (loadMoreVisible) notes.push('"Load more" is visible; more comments are not rendered.');
  }
  if (!commentsComplete) missingRequired.push('comments');

  return {
    data: {
      slug,
      url: snap.finalUrl || snap.url,
      comments_count: comments.length,
      top_level_count: topLevel,
      expected_top_level_count: expectedThreads,
      expected_comment_count: expectedComments,
      comments_complete: commentsComplete,
      new_count: comments.filter((c) => c.new).length,
      comments,
    },
    missing_required: missingRequired,
    notes,
  };
}
