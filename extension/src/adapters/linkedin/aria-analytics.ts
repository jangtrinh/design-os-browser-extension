import type {
  LinkedInAnalyticsPost,
  LinkedInAnalyticsResult,
  LinkedInComment,
  LinkedInCommentsResult,
} from '../../../../shared/linkedin-schema.js';
import {
  absoluteUrl,
  contentNodes,
  countAfter,
  countBefore,
  firstMatch,
  parseCount,
  profileSlugFromHref,
  stripDegree,
  urnFromHref,
  type AxNode,
} from './aria-nodes.js';

function analyticsPageKind(url: string): LinkedInAnalyticsResult['pageKind'] {
  if (url.includes('/analytics/creator/')) return 'creator-content';
  if (url.includes('/analytics/profile-views')) return 'profile-views';
  if (url.includes('/analytics/post-summary/')) return 'post-summary';
  if (url.includes('/feed/update/')) return 'post';
  if (/\/in\/[^/]+\/?$/.test(new URL(url, 'https://www.linkedin.com').pathname)) return 'profile';
  return 'other';
}

function impressionsPeriod(c: AxNode[]): string | undefined {
  const node = c.find((n) => /post impressions/i.test(n.name));
  if (!node) return undefined;
  const fromHref = node.href?.match(/timeRange=([a-z0-9_]+)/i)?.[1];
  if (fromHref) return fromHref;
  const fromName = node.name.match(/past (\d+) days/i)?.[1];
  return fromName ? `past_${fromName}_days` : undefined;
}

/** Per-post numbers from "759 impressions • 20 engagements" links and the post permalink after them. */
function readPosts(c: AxNode[], base: string): LinkedInAnalyticsPost[] {
  const byUrn = new Map<string, LinkedInAnalyticsPost>();
  c.forEach((n, i) => {
    if (!n.href?.includes('/analytics/post-summary/')) return;
    const activityUrn = urnFromHref(n.href, 'activity');
    if (!activityUrn) return;
    const impressions = countBefore(n.name, /impressions?/);
    const engagements = parseCount(n.name.match(/(\d[\d,.]*[KkM]?)\s+engagements?/i)?.[1]);
    const post: LinkedInAnalyticsPost = byUrn.get(activityUrn) ?? {
      activityUrn,
      analyticsUrl: absoluteUrl(n.href, base) ?? n.href,
    };
    if (impressions !== undefined) post.impressions = impressions;
    if (engagements !== undefined) post.engagements = engagements;
    // On the creator page the permalink follows within a few nodes ("Feed post" heading, then link).
    const permalink = c.slice(i + 1, i + 4).find((m) => m.role === 'link' && m.href?.includes('/feed/update/'));
    if (permalink) {
      post.postUrl = absoluteUrl(permalink.href, base);
      post.postUrn = urnFromHref(permalink.href);
      if (permalink.name) post.textPreview = permalink.name.trim().slice(0, 280);
    }
    if (post.impressions !== undefined || post.engagements !== undefined) byUrn.set(activityUrn, post);
  });
  return [...byUrn.values()];
}

function readViewers(c: AxNode[], base: string): LinkedInAnalyticsResult['recentViewers'] {
  const seen = new Set<string>();
  const out: NonNullable<LinkedInAnalyticsResult['recentViewers']> = [];
  for (const n of c) {
    const slug = profileSlugFromHref(n.href);
    if (n.role !== 'link' || !slug || !n.name || seen.has(slug)) continue;
    seen.add(slug);
    out.push({ name: n.name, profileUrl: absoluteUrl(n.href, base) ?? n.href ?? '' });
  }
  return out;
}

/**
 * Reads the analytics numbers LinkedIn exposes as accessible link text:
 * followers, connections, profile viewers, post impressions, search appearances,
 * and per-post impressions/engagements (creator content, post page, post summary).
 */
export function readAnalytics(nodes: AxNode[], url: string): LinkedInAnalyticsResult {
  const c = contentNodes(nodes);
  const pageKind = analyticsPageKind(url);
  const num = (fn: (n: AxNode) => number | undefined): number | undefined => firstMatch(c, fn);

  const followers =
    num((n) => countBefore(n.name, /followers?/)) ??
    num((n) => (n.href?.includes('/followers') && /^\d[\d,.]*[KkM]?$/.test(n.name) ? parseCount(n.name) : undefined));
  const connections = num((n) => countBefore(n.name, /connections?/));
  const profileViewers =
    num((n) => countBefore(n.name, /profile view(?:er)?s/)) ?? num((n) => countAfter(n.name, /profile viewers/));
  const postImpressions =
    num((n) => countBefore(n.name, /post impressions/)) ?? num((n) => countAfter(n.name, /post impressions/));
  const searchAppearances = num((n) => countBefore(n.name, /search appearances/));
  const recruiterViews = num((n) => countBefore(n.name, /recruiters? viewed your profile/));
  const period = impressionsPeriod(c);
  const posts = readPosts(c, url);
  const recentViewers = pageKind === 'profile-views' ? readViewers(c, url) : undefined;

  const metrics: LinkedInAnalyticsResult['metrics'] = {};
  if (followers !== undefined) metrics.followers = followers;
  if (connections !== undefined) metrics.connections = connections;
  if (profileViewers !== undefined) metrics.profileViewers = profileViewers;
  if (postImpressions !== undefined) metrics.postImpressions = postImpressions;
  if (period) metrics.postImpressionsPeriod = period;
  if (searchAppearances !== undefined) metrics.searchAppearances = searchAppearances;
  if (recruiterViews !== undefined) metrics.recruiterViews = recruiterViews;

  return {
    pageUrl: url,
    pageKind,
    metrics,
    posts,
    ...(recentViewers ? { recentViewers } : {}),
    source: 'dom',
    capturedAt: new Date().toISOString(),
  };
}

const COMMENT_LABEL_RE = /^(?:comment|reply)\b(?:\s+(?:by|from)\s+(.+))?/i;

function isCommentNode(n: AxNode): boolean {
  return n.role === 'comment' || (n.role === 'article' && COMMENT_LABEL_RE.test(n.name));
}

/**
 * Reads comments that are already rendered on a post page. It never clicks
 * "Comment" or "Load more comments"; collapsed comments are reported, not expanded.
 */
export function readComments(nodes: AxNode[], url: string, requestedUrn?: string): LinkedInCommentsResult {
  const c = contentNodes(nodes);
  const postUrn = requestedUrn || urnFromHref(url) || 'unknown';
  const comments: LinkedInComment[] = [];
  c.forEach((n, i) => {
    if (!isCommentNode(n)) return;
    const end = c.findIndex((m, j) => j > i && isCommentNode(m));
    const body = c.slice(i + 1, end === -1 ? c.length : end);
    const authorLink = body.find((m) => m.role === 'link' && profileSlugFromHref(m.href) && m.name);
    const labelAuthor = n.name.match(COMMENT_LABEL_RE)?.[1]?.trim();
    const author = labelAuthor ?? (authorLink ? stripDegree(authorLink.name) : '');
    const textNode = body.find((m) => m.role === 'text' && (m.text ?? m.name));
    const reactions = firstMatch(body, (m) => countBefore(m.name, /reactions?/));
    const replies = firstMatch(body, (m) => countBefore(m.name, /repl(?:y|ies)/));
    comments.push({
      authorName: author,
      ...(authorLink?.href ? { authorProfileUrl: absoluteUrl(authorLink.href, url) } : {}),
      text: (textNode?.text ?? textNode?.name ?? n.text ?? '').trim(),
      isReply: /^reply\b/i.test(n.name),
      ...(reactions !== undefined ? { reactionsCount: reactions } : {}),
      ...(replies !== undefined ? { repliesCount: replies } : {}),
    });
  });
  const commentsCount = firstMatch(c, (n) => countBefore(n.name, /comments?/));
  return {
    postUrn,
    url,
    ...(commentsCount !== undefined ? { commentsCount } : {}),
    commentsRendered: comments.length > 0,
    comments,
    ...(comments.length === 0
      ? {
          note:
            'No comment nodes are rendered on this page. This reader never clicks to expand comments; ' +
            'open the comment section in the browser yourself, then read again.',
        }
      : {}),
    ...(postUrn === 'unknown' ? { missingRequired: ['postUrn'] } : {}),
    source: 'dom',
    capturedAt: new Date().toISOString(),
  };
}
