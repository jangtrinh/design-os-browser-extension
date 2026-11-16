import type {
  LinkedInFeedResult,
  LinkedInPost,
  LinkedInProfile,
  LinkedInSearchCategory,
  LinkedInSearchItem,
  LinkedInSearchResult,
} from '../../../../shared/linkedin-schema.js';
import {
  absoluteUrl,
  contentNodes,
  countBefore,
  firstMatch,
  profileSlugFromHref,
  segmentsByHeading,
  stripDegree,
  urnFromHref,
  type AxNode,
} from './aria-nodes.js';

/** Section headings that are never a person's name. */
const SECTION_HEADING_RE =
  /^(about|activity|analytics|experience|education|skills|featured|interests|languages|projects|recommendations|licenses|honors|courses|volunteering|publications|causes|suggested for you|people also viewed|more profiles for you|people you may know|feed post|ad options|don.t want to see this|all activity|highlights|services|resources)\b/i;

const POST_HEADING_RE = /^feed post$/i;

function postAuthor(seg: AxNode[]): { name?: string; profileUrl?: string } {
  const link = seg.find((n) => n.role === 'link' && profileSlugFromHref(n.href) && n.name);
  if (link) return { name: stripDegree(link.name), profileUrl: link.href };
  const menu = firstMatch(seg, (n) => n.name.match(/^open control menu for post by (.+)$/i)?.[1]);
  return menu ? { name: menu.trim() } : {};
}

function postCounts(seg: AxNode[]): Pick<LinkedInPost, 'reactionsCount' | 'commentsCount' | 'repostsCount' | 'impressionsCount'> {
  const pick = (re: RegExp): number | undefined => firstMatch(seg, (n) => countBefore(n.name, re));
  const out: Pick<LinkedInPost, 'reactionsCount' | 'commentsCount' | 'repostsCount' | 'impressionsCount'> = {};
  const reactions = pick(/reactions?\b/);
  const comments = pick(/comments?\b/);
  const reposts = pick(/reposts?\b/);
  const impressions = pick(/impressions?/);
  if (reactions !== undefined) out.reactionsCount = reactions;
  if (comments !== undefined) out.commentsCount = comments;
  if (reposts !== undefined) out.repostsCount = reposts;
  if (impressions !== undefined) out.impressionsCount = impressions;
  return out;
}

function postText(seg: AxNode[], author?: string): string {
  const t = seg.find((n) => n.role === 'text' && (n.text ?? n.name) && (n.text ?? n.name) !== author);
  return (t?.text ?? t?.name ?? '').trim();
}

/** Activity URN from the post's "View analytics" link, share/ugcPost URN from its permalink or Boost link. */
function postUrns(seg: AxNode[]): { activityUrn?: string; shareUrn?: string } {
  const activityUrn = firstMatch(seg, (n) =>
    n.href?.includes('/analytics/post-summary/') ? urnFromHref(n.href, 'activity') : undefined,
  );
  const shareUrn = firstMatch(seg, (n) =>
    n.href && (n.href.includes('/feed/update/') || n.href.includes('/boost/'))
      ? urnFromHref(n.href, 'share|ugcPost|activity')
      : undefined,
  );
  return { activityUrn, shareUrn };
}

export function readProfile(nodes: AxNode[], url: string, requestedPublicId?: string): LinkedInProfile {
  const c = contentNodes(nodes);
  const publicIdentifier = requestedPublicId || profileSlugFromHref(url) || 'unknown';
  const fullName =
    c.find((n) => n.role === 'heading' && n.name && !SECTION_HEADING_RE.test(n.name))?.name.trim() ?? '';
  const topCard = fullName
    ? c.find(
        (n) =>
          n.role === 'link' &&
          profileSlugFromHref(n.href) === publicIdentifier &&
          n.name.startsWith(fullName) &&
          n.name.length > fullName.length,
      )
    : undefined;
  const headline = topCard?.name.slice(fullName.length).trim();
  const followersCount = firstMatch(c, (n) => countBefore(n.name, /followers?\b/));
  const connectionsText = c.find((n) => /^\d[\d,]*\+?\s+connections?\b/i.test(n.name))?.name;
  const missingRequired = [
    ...(fullName ? [] : ['fullName']),
    ...(publicIdentifier === 'unknown' ? ['publicIdentifier'] : []),
  ];

  return {
    publicIdentifier,
    url,
    fullName,
    ...(headline ? { headline } : {}),
    ...(connectionsText ? { connectionsText } : {}),
    ...(followersCount !== undefined ? { followersCount } : {}),
    experiences: [],
    skills: [],
    source: 'dom',
    capturedAt: new Date().toISOString(),
    ...(missingRequired.length ? { missingRequired } : {}),
  };
}

export function readPost(nodes: AxNode[], url: string, requestedUrn?: string): LinkedInPost {
  const c = contentNodes(nodes);
  const seg = segmentsByHeading(c, POST_HEADING_RE)[0] ?? c;
  const { activityUrn, shareUrn } = postUrns(seg);
  const postUrn = requestedUrn || urnFromHref(url) || shareUrn || activityUrn || 'unknown';
  const author = postAuthor(seg);
  const text = postText(seg, author.name);
  const missingRequired = [
    ...(postUrn === 'unknown' ? ['postUrn'] : []),
    ...(author.name ? [] : ['authorName']),
  ];
  return {
    postUrn,
    ...(activityUrn && activityUrn !== postUrn ? { activityUrn } : {}),
    url,
    authorName: author.name ?? '',
    ...(author.profileUrl ? { authorProfileUrl: author.profileUrl } : {}),
    text,
    ...postCounts(seg),
    source: 'dom',
    capturedAt: new Date().toISOString(),
    ...(missingRequired.length ? { missingRequired } : {}),
  };
}

export function readFeed(nodes: AxNode[], url: string): LinkedInFeedResult {
  const now = new Date().toISOString();
  const posts: LinkedInPost[] = [];
  for (const seg of segmentsByHeading(contentNodes(nodes), POST_HEADING_RE)) {
    const { activityUrn, shareUrn } = postUrns(seg);
    const postUrn = shareUrn ?? activityUrn;
    if (!postUrn) continue;
    const author = postAuthor(seg);
    posts.push({
      postUrn,
      ...(activityUrn && activityUrn !== postUrn ? { activityUrn } : {}),
      url: `https://www.linkedin.com/feed/update/${postUrn}/`,
      authorName: author.name ?? '',
      ...(author.profileUrl ? { authorProfileUrl: author.profileUrl } : {}),
      text: postText(seg, author.name),
      ...postCounts(seg),
      source: 'dom',
      capturedAt: now,
    });
  }
  return { pageUrl: url, posts, passiveEntitiesCount: 0, capturedAt: now };
}

function peopleItems(c: AxNode[], base: string): LinkedInSearchItem[] {
  // Each people card exposes two consecutive links to the same /in/<slug>/; the second
  // carries the member's name (matches the profile page h1 in the pilot). Mutual-connection
  // links appear once and are skipped.
  const items: LinkedInSearchItem[] = [];
  const seen = new Set<string>();
  for (let i = 0; i + 1 < c.length; i += 1) {
    const a = c[i];
    const b = c[i + 1];
    const slug = profileSlugFromHref(a.href);
    if (!slug || a.href !== b.href || seen.has(slug)) continue;
    seen.add(slug);
    items.push({
      category: 'people',
      title: b.name || a.name,
      ...(a.name && a.name !== b.name ? { secondary: a.name } : {}),
      url: absoluteUrl(a.href, base) ?? base,
      identifier: slug,
    });
    i += 1;
  }
  return items;
}

const CATEGORY_HREF: Record<Exclude<LinkedInSearchCategory, 'people'>, RegExp> = {
  companies: /\/company\/([^/?#]+)/,
  jobs: /\/jobs\/view\/(\d+)/,
  posts: /(urn:li:(?:activity|share|ugcPost):\d+)/,
};

export function readSearch(
  nodes: AxNode[],
  url: string,
  category: LinkedInSearchCategory,
  query: string,
): LinkedInSearchResult {
  const c = contentNodes(nodes);
  let items: LinkedInSearchItem[];
  if (category === 'people') {
    items = peopleItems(c, url);
  } else {
    const re = CATEGORY_HREF[category];
    const byId = new Map<string, LinkedInSearchItem>();
    for (const n of c) {
      const id = n.role === 'link' && n.href ? n.href.match(re)?.[1] : undefined;
      if (!id || !n.name || byId.has(id)) continue;
      byId.set(id, { category, title: n.name, url: absoluteUrl(n.href, url) ?? url, identifier: id });
    }
    items = [...byId.values()];
  }
  return {
    category,
    query,
    pageUrl: url,
    items,
    passiveEntitiesCount: 0,
    source: 'dom',
    capturedAt: new Date().toISOString(),
  };
}
