import { parseGenericListingStatus, parseGenericPageSnapshot } from '../../../extension/src/adapters/generic/reader.js';
import { JOB_CARD_SELECTOR, parseJobsDetail, parseJobsSearchResults } from '../../../extension/src/adapters/jobs/reader.js';
import { parseProductHuntProductPage } from '../../../extension/src/adapters/producthunt/reader.js';
import { parseRedditThingScore, parseRedditUserSelf } from '../../../extension/src/adapters/reddit/metrics-reader.js';
import { parseRedditSubredditRules } from '../../../extension/src/adapters/reddit/rules-reader.js';
import { parseSocialFollowList } from '../../../extension/src/adapters/social-lists/following-reader.js';
import { parseEngagementScout, parseThreadsPostReplies } from '../../../extension/src/adapters/threads/reader.js';
import { UNIKORN_COMMENT_SELECTOR, parseUnikornProductComments, parseUnikornProductPage } from '../../../extension/src/adapters/unikorn/reader.js';
import { parseXAccountAnalytics, parseXArticleStats, parseXArticlesList } from '../../../extension/src/adapters/x/reader.js';
import { parseYouTubeStudioChannelAnalytics, parseYouTubeStudioVideosAnalytics } from '../../../extension/src/adapters/youtube-studio/reader.js';
import { DEFAULT_MAX_AGE_BY_CLASS } from '../../../shared/reader-schema.js';
import { registerDuplicateTextCheck } from './checks/duplicate-text.js';
import { registerLinkStatusCheck } from './checks/link-status.js';
import { registerProfileLinksCheck } from './checks/profile-links.js';
import { registerSubredditRulesCheck } from './checks/subreddit-rules.js';
import { registerLinkedInNightlyComposite } from './linkedin-nightly.js';
import { registerReaderView } from './reader-registry.js';
import { registerUnifiedCommentFeed } from './unified-comments.js';

let initialized = false;

/** Registers every site adapter view, composite flow, and read-only check once at startup. */
export function registerAllReaders(): void {
  if (initialized) return;
  initialized = true;

  // R1 (#13): composite nightly analytics
  registerLinkedInNightlyComposite();

  // R2 (#14): X metrics + Articles impressions
  registerReaderView({
    descriptor: {
      site: 'x',
      view: 'article.stats',
      description: 'Read X Article analytics (impressions, engagements, likes, reposts, replies, bookmarks).',
      requiredFields: ['impressions'],
      freshnessClass: 'metrics',
      defaultMaxAgeS: DEFAULT_MAX_AGE_BY_CLASS.metrics,
      allowedHosts: ['x.com', 'www.x.com'],
    },
    resolveTargetUrl: (p) => (typeof p.article_id === 'string' ? `https://x.com/i/articles/${p.article_id}` : 'https://x.com/home'),
    parse: (snap) => parseXArticleStats(snap),
  });
  registerReaderView({
    descriptor: {
      site: 'x',
      view: 'articles.list',
      description: 'List X Articles visible on an author Articles tab.',
      requiredFields: [],
      freshnessClass: 'listings',
      defaultMaxAgeS: DEFAULT_MAX_AGE_BY_CLASS.listings,
      allowedHosts: ['x.com', 'www.x.com'],
    },
    resolveTargetUrl: (p) => `https://x.com/${String(p.handle ?? 'Jangtrinhvn')}/articles`,
    parse: (snap) => parseXArticlesList(snap),
  });
  registerReaderView({
    descriptor: {
      site: 'x',
      view: 'analytics.account',
      description: 'Read account-level X analytics totals when displayed.',
      requiredFields: ['impressions'],
      freshnessClass: 'metrics',
      defaultMaxAgeS: DEFAULT_MAX_AGE_BY_CLASS.metrics,
      allowedHosts: ['x.com', 'www.x.com'],
    },
    resolveTargetUrl: () => 'https://x.com/i/account_analytics',
    parse: (snap) => parseXAccountAnalytics(snap),
  });

  // R3 (#15): YouTube Studio + Product Hunt metrics
  registerReaderView({
    descriptor: {
      site: 'youtube-studio',
      view: 'channel.analytics',
      description: 'Read YouTube Studio channel analytics (views, watch time, subscribers).',
      requiredFields: ['views'],
      freshnessClass: 'metrics',
      defaultMaxAgeS: DEFAULT_MAX_AGE_BY_CLASS.metrics,
      allowedHosts: ['studio.youtube.com'],
    },
    resolveTargetUrl: () => 'https://studio.youtube.com/',
    parse: (snap) => parseYouTubeStudioChannelAnalytics(snap),
  });
  registerReaderView({
    descriptor: {
      site: 'youtube-studio',
      view: 'videos.analytics',
      description: 'Read per-video views, CTR, and average view duration from YouTube Studio.',
      requiredFields: [],
      freshnessClass: 'metrics',
      defaultMaxAgeS: DEFAULT_MAX_AGE_BY_CLASS.metrics,
      allowedHosts: ['studio.youtube.com'],
    },
    resolveTargetUrl: () => 'https://studio.youtube.com/channel/analytics/tab-overview',
    parse: (snap) => parseYouTubeStudioVideosAnalytics(snap),
  });
  registerReaderView({
    descriptor: {
      site: 'producthunt',
      view: 'product.page',
      description: 'Read Product Hunt product upvotes, comments, daily/weekly rank, and followers.',
      requiredFields: ['name'],
      freshnessClass: 'metrics',
      defaultMaxAgeS: DEFAULT_MAX_AGE_BY_CLASS.metrics,
      allowedHosts: ['www.producthunt.com', 'producthunt.com'],
    },
    resolveTargetUrl: (p) => `https://www.producthunt.com/products/${String(p.slug ?? 'designos-studio')}`,
    parse: (snap) => parseProductHuntProductPage(snap),
  });

  // R4 (#16): Reddit karma & thing score
  registerReaderView({
    descriptor: {
      site: 'reddit',
      view: 'user.self',
      description: 'Read Reddit user karma, account age, and visible achievements.',
      requiredFields: ['username', 'total_karma'],
      freshnessClass: 'metrics',
      defaultMaxAgeS: DEFAULT_MAX_AGE_BY_CLASS.metrics,
      allowedHosts: ['www.reddit.com', 'old.reddit.com', 'reddit.com'],
    },
    resolveTargetUrl: (p) => `https://www.reddit.com/user/${String(p.username ?? 'me')}/`,
    parse: (snap) => parseRedditUserSelf(snap),
  });
  registerReaderView({
    descriptor: {
      site: 'reddit',
      view: 'thing.score',
      description: 'Read Reddit post or comment score, reply count, and removed state.',
      requiredFields: [],
      freshnessClass: 'metrics',
      defaultMaxAgeS: DEFAULT_MAX_AGE_BY_CLASS.metrics,
      allowedHosts: ['www.reddit.com', 'old.reddit.com', 'reddit.com'],
    },
    resolveTargetUrl: () => undefined,
    parse: (snap) => parseRedditThingScore(snap),
  });

  // R5 (#17) & R6 (#18): Threads replies + engagement scout + unified feed
  registerReaderView({
    descriptor: {
      site: 'threads',
      view: 'post.replies',
      description: 'Read rendered replies on a Threads post without clicking.',
      requiredFields: [],
      freshnessClass: 'comments',
      defaultMaxAgeS: DEFAULT_MAX_AGE_BY_CLASS.comments,
      allowedHosts: ['www.threads.com', 'www.threads.net', 'threads.com', 'threads.net'],
    },
    resolveTargetUrl: () => undefined,
    parse: (snap) => parseThreadsPostReplies(snap),
  });
  for (const scoutSite of ['threads', 'linkedin'] as const) {
    for (const viewName of ['search.posts', 'tag.posts'] as const) {
      registerReaderView({
        descriptor: {
          site: scoutSite,
          view: viewName,
          description: `Scout reply-worthy public ${scoutSite} posts (${viewName}) without clicking.`,
          requiredFields: [],
          freshnessClass: 'comments',
          defaultMaxAgeS: DEFAULT_MAX_AGE_BY_CLASS.comments,
          allowedHosts: scoutSite === 'threads' ? ['www.threads.com', 'threads.com', 'www.threads.net'] : ['www.linkedin.com', 'linkedin.com'],
        },
        resolveTargetUrl: (p) =>
          scoutSite === 'threads'
            ? `https://www.threads.com/search?q=${encodeURIComponent(String(p.query ?? p.tag ?? 'design systems'))}`
            : `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(String(p.query ?? p.tag ?? 'design systems'))}`,
        parse: (snap) => parseEngagementScout(scoutSite, snap),
      });
    }
  }
  registerUnifiedCommentFeed();

  // R7 (#19): Following & follower list reader (scroll-only with resumable cursor)
  for (const listSite of ['facebook', 'x', 'linkedin', 'threads'] as const) {
    for (const listView of ['following.list', 'followers.list'] as const) {
      const hostMap = {
        facebook: ['www.facebook.com', 'm.facebook.com', 'facebook.com'],
        x: ['x.com', 'www.x.com'],
        linkedin: ['www.linkedin.com', 'linkedin.com'],
        threads: ['www.threads.com', 'www.threads.net', 'threads.com'],
      };
      registerReaderView({
        descriptor: {
          site: listSite,
          view: listView,
          description: `Read ${listSite} ${listView} items using scroll-only pagination and resumable cursor.`,
          requiredFields: [],
          freshnessClass: 'lists',
          defaultMaxAgeS: DEFAULT_MAX_AGE_BY_CLASS.lists,
          allowedHosts: hostMap[listSite],
          supportsScroll: true,
        },
        resolveTargetUrl: (p) => {
          const handle = String(p.handle ?? 'me');
          if (listSite === 'facebook') return `https://www.facebook.com/${handle}/${listView === 'following.list' ? 'following' : 'followers'}`;
          if (listSite === 'x') return `https://x.com/${handle}/${listView === 'following.list' ? 'following' : 'followers'}`;
          if (listSite === 'threads') return `https://www.threads.com/@${handle}`;
          return 'https://www.linkedin.com/mynetwork/network-manager/people-follow/following/';
        },
        parse: (snap, params) => parseSocialFollowList(listSite, listView, snap, params),
      });
    }
  }

  // R8 (#20): Duplicate-text check
  registerDuplicateTextCheck();

  // R9 (#22): Reddit subreddit rules
  registerReaderView({
    descriptor: {
      site: 'reddit',
      view: 'subreddit.rules',
      description: 'Read subreddit posting rules, required flairs, karma floors, and wiki limits.',
      requiredFields: ['subreddit'],
      freshnessClass: 'listings',
      defaultMaxAgeS: DEFAULT_MAX_AGE_BY_CLASS.listings,
      allowedHosts: ['www.reddit.com', 'old.reddit.com', 'reddit.com'],
    },
    resolveTargetUrl: (p) => `https://www.reddit.com/r/${String(p.subreddit ?? 'all')}/about/rules/`,
    parse: (snap, params) => parseRedditSubredditRules(snap, params),
  });

  // R10 & R11 (#23): Generic listing status & competitor page snapshot
  registerReaderView({
    descriptor: {
      site: 'generic',
      view: 'listing.status',
      description: 'Check directory/listing status for a product (listed flag, rank, upvotes).',
      requiredFields: ['listed'],
      freshnessClass: 'listings',
      defaultMaxAgeS: DEFAULT_MAX_AGE_BY_CLASS.listings,
      allowedHosts: [],
    },
    resolveTargetUrl: () => undefined,
    parse: (snap, params) => parseGenericListingStatus(snap, params),
  });
  registerReaderView({
    descriptor: {
      site: 'generic',
      view: 'page.snapshot',
      description: 'Extract read-only competitor pricing plans, headings, and public features.',
      requiredFields: [],
      freshnessClass: 'listings',
      defaultMaxAgeS: DEFAULT_MAX_AGE_BY_CLASS.listings,
      allowedHosts: [],
    },
    resolveTargetUrl: () => undefined,
    parse: (snap, params) => parseGenericPageSnapshot(snap, params),
  });

  // R12 (#24): Unikorn product page & comments
  registerReaderView({
    descriptor: {
      site: 'unikorn',
      view: 'product.page',
      description: 'Read Unikorn product page upvotes, rank, views, rating, and changelog.',
      requiredFields: ['slug', 'name'],
      freshnessClass: 'listings',
      defaultMaxAgeS: DEFAULT_MAX_AGE_BY_CLASS.listings,
      allowedHosts: ['unikorn.vn', 'www.unikorn.vn'],
    },
    resolveTargetUrl: (p) => `https://unikorn.vn/p/${String(p.slug ?? 'designos-studio')}`,
    parse: (snap, params) => parseUnikornProductPage(snap, params),
  });
  registerReaderView({
    descriptor: {
      site: 'unikorn',
      view: 'product.comments',
      description: 'Read rendered comments on a Unikorn product with delta new detection.',
      requiredFields: ['slug'],
      freshnessClass: 'comments',
      defaultMaxAgeS: DEFAULT_MAX_AGE_BY_CLASS.comments,
      allowedHosts: ['unikorn.vn', 'www.unikorn.vn'],
      itemSelector: UNIKORN_COMMENT_SELECTOR,
    },
    resolveTargetUrl: (p) => `https://unikorn.vn/p/${String(p.slug ?? 'designos-studio')}#comments`,
    parse: (snap, params) => parseUnikornProductComments(snap, params),
  });

  // R13 (#25): Jobs search results & job detail
  registerReaderView({
    descriptor: {
      site: 'jobs',
      view: 'search.results',
      description: 'Read job search listings from LinkedIn Jobs, Wellfound, or Dribbble.',
      requiredFields: [],
      freshnessClass: 'listings',
      defaultMaxAgeS: DEFAULT_MAX_AGE_BY_CLASS.listings,
      allowedHosts: ['www.linkedin.com', 'linkedin.com', 'wellfound.com', 'www.wellfound.com', 'dribbble.com', 'www.dribbble.com'],
      itemSelector: JOB_CARD_SELECTOR,
    },
    resolveTargetUrl: () => 'https://www.linkedin.com/jobs/search/',
    parse: (snap, params) => parseJobsSearchResults(snap, params),
  });
  registerReaderView({
    descriptor: {
      site: 'jobs',
      view: 'job.detail',
      description: 'Read job opening title, company, location, remote, seniority, and salary.',
      requiredFields: ['title'],
      freshnessClass: 'listings',
      defaultMaxAgeS: DEFAULT_MAX_AGE_BY_CLASS.listings,
      allowedHosts: ['www.linkedin.com', 'linkedin.com', 'wellfound.com', 'www.wellfound.com', 'dribbble.com', 'www.dribbble.com'],
    },
    resolveTargetUrl: () => undefined,
    parse: (snap, params) => parseJobsDetail(snap, params),
  });

  // R14 (#21, #22, #26): Read-only checks
  registerSubredditRulesCheck();
  registerLinkStatusCheck();
  registerProfileLinksCheck();
}
