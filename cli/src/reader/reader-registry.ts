import { readAnalytics, readComments } from '../../../extension/src/adapters/linkedin/aria-analytics.js';
import { parseCount, profileSlugFromHref, urnFromHref } from '../../../extension/src/adapters/linkedin/aria-nodes.js';
import { readFeed, readPost, readProfile, readSearch } from '../../../extension/src/adapters/linkedin/aria-readers.js';
import { shortHash8 } from '../../../shared/hash.js';
import {
  DEFAULT_MAX_AGE_BY_CLASS,
  type CollectedPageSnapshot,
  type ReaderSiteId,
  type ReaderViewDescriptor,
} from '../../../shared/reader-schema.js';

export interface ParsedViewOutput {
  data: Record<string, unknown>;
  missing_required: string[];
  notes: string[];
  target_key?: string;
}

export interface RegisteredViewHandler {
  descriptor: ReaderViewDescriptor;
  resolveTargetUrl(params: Record<string, unknown>): string | undefined;
  parse(snapshot: CollectedPageSnapshot, params: Record<string, unknown>): ParsedViewOutput;
}

const REGISTRY = new Map<string, RegisteredViewHandler>();

export function registerReaderView(handler: RegisteredViewHandler): void {
  REGISTRY.set(`${handler.descriptor.site}:${handler.descriptor.view}`, handler);
}

export function getReaderView(site: ReaderSiteId, view: string): RegisteredViewHandler | undefined {
  return REGISTRY.get(`${site}:${view}`);
}

export function listReaderViews(site?: ReaderSiteId): ReaderViewDescriptor[] {
  const items: ReaderViewDescriptor[] = [];
  for (const h of REGISTRY.values()) {
    if (!site || h.descriptor.site === site) items.push(h.descriptor);
  }
  return items;
}

export function deriveTargetKey(site: ReaderSiteId, view: string, target: string, params: Record<string, unknown> = {}): string {
  if (typeof params.target_key === 'string' && params.target_key.trim()) return params.target_key.trim();
  if (site === 'linkedin' && view === 'analytics.content') return 'linkedin:analytics.content:self';
  if (site === 'linkedin' && view === 'analytics.profile_views') return 'linkedin:analytics.profile_views:self';
  if (site === 'linkedin' && view === 'profile.self') {
    const slug = String(params.public_id ?? params.publicId ?? profileSlugFromHref(target) ?? 'self');
    return `linkedin:profile:${slug}`;
  }
  return `${site}:${view}:${shortHash8(target || view)}`;
}

// Wave 1 core LinkedIn views (backed directly by #4 ARIA readers; Wave 2/3 register all remaining views).
registerReaderView({
  descriptor: {
    site: 'linkedin',
    view: 'profile.self',
    description: 'Read LinkedIn self profile with followers, connections floor, headline, and 7d analytics strip.',
    requiredFields: ['full_name'],
    freshnessClass: 'profiles',
    defaultMaxAgeS: DEFAULT_MAX_AGE_BY_CLASS.profiles,
    allowedHosts: ['www.linkedin.com', 'linkedin.com'],
  },
  resolveTargetUrl: (p) => (typeof p.public_id === 'string' ? `https://www.linkedin.com/in/${p.public_id}/` : 'https://www.linkedin.com/in/me/'),
  parse: (snap, params) => {
    const profile = readProfile(snap.axNodes, snap.url, typeof params.public_id === 'string' ? params.public_id : undefined);
    const analytics = readAnalytics(snap.axNodes, snap.url);
    const connNum = parseCount(profile.connectionsText);
    const connectionsFloor = /\+$/.test((profile.connectionsText ?? '').replace(/\s+connections?$/i, '').trim()) || (profile.connectionsText ?? '').includes('500+');
    const missing = [...(profile.missingRequired ?? [])].map((f) => (f === 'fullName' ? 'full_name' : f));
    return {
      data: {
        public_identifier: profile.publicIdentifier,
        url: profile.url,
        full_name: profile.fullName || null,
        headline: profile.headline ?? null,
        followers: profile.followersCount ?? null,
        followers_text: snap.axNodes.find((n) => /\bfollowers?\b/i.test(n.name))?.name ?? null,
        connections: connNum ?? null,
        connections_text: profile.connectionsText ?? null,
        connections_floor: connectionsFloor,
        profile_views: analytics.metrics.profileViewers ?? null,
        post_impressions: analytics.metrics.postImpressions ?? null,
        post_impressions_period: analytics.metrics.postImpressionsPeriod ?? null,
        search_appearances: analytics.metrics.searchAppearances ?? null,
      },
      missing_required: missing,
      notes: [],
    };
  },
});

registerReaderView({
  descriptor: {
    site: 'linkedin',
    view: 'analytics.content',
    description: 'Read LinkedIn creator content analytics and per-post impressions/engagements.',
    requiredFields: ['posts'],
    freshnessClass: 'metrics',
    defaultMaxAgeS: DEFAULT_MAX_AGE_BY_CLASS.metrics,
    allowedHosts: ['www.linkedin.com', 'linkedin.com'],
  },
  resolveTargetUrl: () => 'https://www.linkedin.com/analytics/creator/content/',
  parse: (snap) => {
    const a = readAnalytics(snap.axNodes, snap.url);
    return {
      data: {
        page_kind: a.pageKind,
        period: a.metrics.postImpressionsPeriod ?? 'past_7_days',
        metrics: a.metrics,
        posts: a.posts.map((p) => ({
          id: p.activityUrn,
          activity_urn: p.activityUrn,
          post_urn: p.postUrn ?? null,
          post_url: p.postUrl ?? null,
          impressions: p.impressions ?? null,
          engagements: p.engagements ?? null,
          text_preview: p.textPreview ?? null,
        })),
      },
      missing_required: a.posts.length === 0 ? ['posts'] : [],
      notes: ['Non-rendered chart totals left null (accessibility tree only).'],
    };
  },
});

registerReaderView({
  descriptor: {
    site: 'linkedin',
    view: 'analytics.profile_views',
    description: 'Read LinkedIn profile viewers cards (redacted third-party names) and recruiter count.',
    requiredFields: [],
    freshnessClass: 'profiles',
    defaultMaxAgeS: DEFAULT_MAX_AGE_BY_CLASS.profiles,
    allowedHosts: ['www.linkedin.com', 'linkedin.com'],
  },
  resolveTargetUrl: () => 'https://www.linkedin.com/analytics/profile-views/',
  parse: (snap) => {
    const a = readAnalytics(snap.axNodes, snap.url);
    return {
      data: {
        page_kind: a.pageKind,
        recruiter_views: a.metrics.recruiterViews ?? null,
        recent_viewers: (a.recentViewers ?? []).map((v) => ({
          name: v.name,
          profile_url: v.profileUrl,
        })),
      },
      missing_required: [],
      notes: [],
    };
  },
});

registerReaderView({
  descriptor: {
    site: 'linkedin',
    view: 'post.comments',
    description: 'Read already-rendered comments on a LinkedIn post without clicking.',
    requiredFields: ['post_urn'],
    freshnessClass: 'comments',
    defaultMaxAgeS: DEFAULT_MAX_AGE_BY_CLASS.comments,
    allowedHosts: ['www.linkedin.com', 'linkedin.com'],
  },
  resolveTargetUrl: (p) => (typeof p.post_urn === 'string' ? `https://www.linkedin.com/feed/update/${p.post_urn}/` : undefined),
  parse: (snap, params) => {
    const res = readComments(snap.axNodes, snap.url, typeof params.post_urn === 'string' ? params.post_urn : urnFromHref(snap.url));
    return {
      data: {
        post_urn: res.postUrn,
        url: res.url,
        comments_count: res.commentsCount ?? null,
        comments_rendered: res.commentsRendered,
        comments: res.comments.map((c, idx) => ({
          id: shortHash8(`${res.postUrn}:${idx}:${c.authorName}:${c.text}`),
          id_synthetic: true,
          author_name: c.authorName,
          author_profile_url: c.authorProfileUrl ?? null,
          text: c.text,
          is_reply: c.isReply,
          reactions_count: c.reactionsCount ?? null,
          replies_count: c.repliesCount ?? null,
          third_party: true,
        })),
      },
      missing_required: res.postUrn === 'unknown' ? ['post_urn'] : [],
      notes: res.note ? [res.note] : [],
    };
  },
});

registerReaderView({
  descriptor: {
    site: 'linkedin',
    view: 'post.summary',
    description: 'Read a single LinkedIn post card from the accessibility tree.',
    requiredFields: ['post_urn'],
    freshnessClass: 'metrics',
    defaultMaxAgeS: DEFAULT_MAX_AGE_BY_CLASS.metrics,
    allowedHosts: ['www.linkedin.com', 'linkedin.com'],
  },
  resolveTargetUrl: (p) => (typeof p.post_urn === 'string' ? `https://www.linkedin.com/feed/update/${p.post_urn}/` : undefined),
  parse: (snap, params) => {
    const post = readPost(snap.axNodes, snap.url, typeof params.post_urn === 'string' ? params.post_urn : undefined);
    return {
      data: {
        post_urn: post.postUrn,
        activity_urn: post.activityUrn ?? null,
        url: post.url,
        author_name: post.authorName || null,
        text: post.text,
        reactions_count: post.reactionsCount ?? null,
        comments_count: post.commentsCount ?? null,
        reposts_count: post.repostsCount ?? null,
        impressions_count: post.impressionsCount ?? null,
      },
      missing_required: (post.missingRequired ?? []).map((f) => (f === 'postUrn' ? 'post_urn' : f === 'authorName' ? 'author_name' : f)),
      notes: [],
    };
  },
});

registerReaderView({
  descriptor: {
    site: 'linkedin',
    view: 'feed.recent',
    description: 'Read recent activity feed posts from accessibility tree.',
    requiredFields: [],
    freshnessClass: 'comments',
    defaultMaxAgeS: DEFAULT_MAX_AGE_BY_CLASS.comments,
    allowedHosts: ['www.linkedin.com', 'linkedin.com'],
  },
  resolveTargetUrl: (p) =>
    typeof p.public_id === 'string'
      ? `https://www.linkedin.com/in/${p.public_id}/recent-activity/all/`
      : 'https://www.linkedin.com/feed/',
  parse: (snap) => {
    const feed = readFeed(snap.axNodes, snap.url);
    return {
      data: {
        page_url: feed.pageUrl,
        posts: feed.posts.map((p) => ({
          id: p.postUrn,
          post_urn: p.postUrn,
          activity_urn: p.activityUrn ?? null,
          url: p.url,
          author_name: p.authorName,
          text: p.text,
          reactions_count: p.reactionsCount ?? null,
          comments_count: p.commentsCount ?? null,
          impressions_count: p.impressionsCount ?? null,
          third_party: false,
        })),
      },
      missing_required: [],
      notes: [],
    };
  },
});

registerReaderView({
  descriptor: {
    site: 'linkedin',
    view: 'search.people',
    description: 'Read LinkedIn people search cards from accessibility tree.',
    requiredFields: [],
    freshnessClass: 'profiles',
    defaultMaxAgeS: DEFAULT_MAX_AGE_BY_CLASS.profiles,
    allowedHosts: ['www.linkedin.com', 'linkedin.com'],
  },
  resolveTargetUrl: (p) => `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(String(p.query ?? ''))}`,
  parse: (snap, params) => {
    const res = readSearch(snap.axNodes, snap.url, 'people', String(params.query ?? ''));
    return {
      data: {
        category: res.category,
        query: res.query,
        page_url: res.pageUrl,
        items: res.items.map((it) => ({
          id: it.identifier ?? shortHash8(it.url),
          title: it.title,
          subtitle: it.subtitle ?? null,
          url: it.url,
          third_party: true,
        })),
      },
      missing_required: [],
      notes: [],
    };
  },
});
