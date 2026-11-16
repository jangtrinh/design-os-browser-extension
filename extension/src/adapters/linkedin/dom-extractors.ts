import type {
  LinkedInCompany,
  LinkedInExperienceItem,
  LinkedInFeedResult,
  LinkedInJob,
  LinkedInMessage,
  LinkedInPost,
  LinkedInProfile,
  LinkedInSearchCategory,
  LinkedInSearchItem,
  LinkedInSearchResult,
  LinkedInThread,
} from '../../../../shared/linkedin-schema.js';
import {
  ingestPassiveTap,
  mergeProfile,
  type PassiveEntityStore,
} from './entity-normalizer.js';

function txt(el: Element | null | undefined): string {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function extractSlugAfter(url: string, marker: string): string {
  try {
    const parsed = new URL(url, 'https://www.linkedin.com');
    const idx = parsed.pathname.indexOf(marker);
    if (idx === -1) return 'unknown';
    const tail = parsed.pathname.slice(idx + marker.length).split('/').filter(Boolean)[0];
    return tail || 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Reads LinkedIn's embedded `<code id="bpr-guid-*">` or JSON-LD scripts passively if present.
 */
export function absorbEmbeddedHydration(doc: Document, store: PassiveEntityStore): void {
  const codeNodes = Array.from(doc.querySelectorAll('code[id^="bpr-guid-"], script[type="application/ld+json"]'));
  for (const node of codeNodes) {
    const raw = (node.textContent ?? '').trim();
    if (!raw || !raw.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (Array.isArray(parsed.included)) {
        ingestPassiveTap(store, {
          entities: parsed.included.filter(
            (x): x is Record<string, unknown> => Boolean(x && typeof x === 'object'),
          ),
        });
      }
    } catch {
      // Ignore malformed hydration blocks
    }
  }
}

export function extractProfileFromDocument(
  doc: Document,
  url: string,
  store: PassiveEntityStore,
  requestedPublicId?: string,
): LinkedInProfile {
  absorbEmbeddedHydration(doc, store);
  const publicIdentifier = requestedPublicId || extractSlugAfter(url, '/in/');
  const now = new Date().toISOString();

  const fullName =
    txt(doc.querySelector('main h1, [data-test="profile-name"], .pv-text-details__left-panel h1')) ||
    publicIdentifier;
  const headline = txt(
    doc.querySelector('[data-test="profile-headline"], .text-body-medium.break-words, main section p'),
  );
  const location = txt(
    doc.querySelector('[data-test="profile-location"], .text-body-small.inline.t-black--light.break-words'),
  );
  const about = txt(doc.querySelector('[data-test="profile-about"], #about + div + div span[aria-hidden="true"]'));
  const connectionsText = txt(doc.querySelector('[data-test="profile-connections"], .pv-top-card--list-bullet'));

  const experiences: LinkedInExperienceItem[] = Array.from(
    doc.querySelectorAll('[data-test="experience-item"], #experience ~ div li'),
  )
    .map((li) => ({
      title: txt(li.querySelector('[data-test="experience-title"], .t-bold span[aria-hidden="true"], h3')) || txt(li),
      company: txt(li.querySelector('[data-test="experience-company"], .t-14.t-normal span[aria-hidden="true"]')),
      dateRange: txt(li.querySelector('[data-test="experience-dates"], .t-black--light span[aria-hidden="true"]')) || undefined,
    }))
    .filter((item) => item.title.length > 0);

  const skills = Array.from(doc.querySelectorAll('[data-test="skill-pill"], #skills ~ div li span[aria-hidden="true"]'))
    .map((s) => txt(s))
    .filter(Boolean);

  const domProfile: LinkedInProfile = {
    publicIdentifier,
    url,
    fullName,
    ...(headline ? { headline } : {}),
    ...(location ? { location } : {}),
    ...(about ? { about } : {}),
    ...(connectionsText ? { connectionsText } : {}),
    experiences,
    skills,
    source: 'dom',
    capturedAt: now,
  };

  const passive = store.profiles.get(publicIdentifier);
  return mergeProfile(domProfile, passive);
}

export function extractPostFromDocument(
  doc: Document,
  url: string,
  store: PassiveEntityStore,
  requestedUrn?: string,
): LinkedInPost {
  absorbEmbeddedHydration(doc, store);
  const root = doc.querySelector('article[data-urn], [data-test="post-detail"], main article') ?? doc.body;
  const postUrn = requestedUrn || root?.getAttribute('data-urn') || extractSlugAfter(url, '/posts/');
  const authorName = txt(root?.querySelector('[data-test="post-author"], .update-components-actor__name span[aria-hidden="true"], h2')) || 'Unknown Author';
  const authorHeadline = txt(root?.querySelector('[data-test="post-author-headline"], .update-components-actor__description')) || undefined;
  const text = txt(root?.querySelector('[data-test="post-text"], .update-components-text, p')) || '';
  const passive = store.posts.get(postUrn);

  return {
    postUrn,
    url,
    authorName: authorName !== 'Unknown Author' ? authorName : (passive?.authorName ?? authorName),
    authorHeadline: authorHeadline ?? passive?.authorHeadline,
    text: text || passive?.text || '',
    reactionsCount: passive?.reactionsCount,
    commentsCount: passive?.commentsCount,
    repostsCount: passive?.repostsCount,
    source: passive ? 'hybrid' : 'dom',
    capturedAt: new Date().toISOString(),
  };
}

export function extractCompanyFromDocument(
  doc: Document,
  url: string,
  store: PassiveEntityStore,
  requestedSlug?: string,
): LinkedInCompany {
  absorbEmbeddedHydration(doc, store);
  const slug = requestedSlug || extractSlugAfter(url, '/company/');
  const passive = store.companies.get(slug);
  const name = txt(doc.querySelector('main h1, [data-test="company-name"]')) || passive?.name || slug;
  const tagline = txt(doc.querySelector('[data-test="company-tagline"], .org-top-card-summary__tagline')) || passive?.tagline;
  const about = txt(doc.querySelector('[data-test="company-about"], .org-about-module__description')) || passive?.about;
  const industry = txt(doc.querySelector('[data-test="company-industry"]')) || passive?.industry;
  const sizeText = txt(doc.querySelector('[data-test="company-size"]')) || passive?.sizeText;

  return {
    slug,
    urn: passive?.urn,
    url,
    name,
    ...(tagline ? { tagline } : {}),
    ...(industry ? { industry } : {}),
    ...(sizeText ? { sizeText } : {}),
    ...(about ? { about } : {}),
    ...(passive?.followersCount !== undefined ? { followersCount: passive.followersCount } : {}),
    source: passive ? 'hybrid' : 'dom',
    capturedAt: new Date().toISOString(),
  };
}

export function extractJobFromDocument(
  doc: Document,
  url: string,
  store: PassiveEntityStore,
  requestedJobId?: string,
): LinkedInJob {
  absorbEmbeddedHydration(doc, store);
  const jobId = requestedJobId || extractSlugAfter(url, '/jobs/view/');
  const passive = store.jobs.get(jobId);

  return {
    jobId,
    url,
    title: txt(doc.querySelector('main h1, [data-test="job-title"]')) || passive?.title || `Job ${jobId}`,
    companyName: txt(doc.querySelector('[data-test="job-company"], .job-details-jobs-unified-top-card__company-name')) || passive?.companyName || '',
    location: txt(doc.querySelector('[data-test="job-location"]')) || passive?.location,
    workplaceType: txt(doc.querySelector('[data-test="job-workplace"]')) || passive?.workplaceType,
    salaryText: txt(doc.querySelector('[data-test="job-salary"]')) || passive?.salaryText,
    description: txt(doc.querySelector('[data-test="job-description"], #job-details')) || passive?.description,
    source: passive ? 'hybrid' : 'dom',
    capturedAt: new Date().toISOString(),
  };
}

export function extractSearchFromDocument(
  doc: Document,
  url: string,
  category: LinkedInSearchCategory,
  query: string,
  store: PassiveEntityStore,
): LinkedInSearchResult {
  absorbEmbeddedHydration(doc, store);
  const cards = Array.from(
    doc.querySelectorAll('[data-test="search-result"], .reusable-search__result-container, main li[data-view-name]'),
  );
  const items: LinkedInSearchItem[] = cards
    .map((card) => {
      const link = card.querySelector('a[href]');
      const href = link?.getAttribute('href') ?? '';
      const title =
        txt(card.querySelector('[data-test="result-title"], .entity-result__title-text a, h2, h3')) ||
        txt(link);
      const subtitle = txt(card.querySelector('[data-test="result-subtitle"], .entity-result__primary-subtitle'));
      const secondary = txt(card.querySelector('[data-test="result-secondary"], .entity-result__secondary-subtitle'));
      const snippet = txt(card.querySelector('[data-test="result-snippet"], .entity-result__summary'));
      const fullUrl = href ? new URL(href, url).href : url;
      const identifier =
        href.includes('/in/')
          ? extractSlugAfter(fullUrl, '/in/')
          : href.includes('/company/')
            ? extractSlugAfter(fullUrl, '/company/')
            : undefined;
      return {
        category,
        title,
        ...(subtitle ? { subtitle } : {}),
        ...(secondary ? { secondary } : {}),
        url: fullUrl,
        ...(snippet ? { snippet } : {}),
        ...(identifier ? { identifier } : {}),
      };
    })
    .filter((item) => item.title.length > 0);

  return {
    category,
    query,
    pageUrl: url,
    items,
    passiveEntitiesCount: store.totalEntitiesIngested,
    source: store.totalEntitiesIngested > 0 ? 'hybrid' : 'dom',
    capturedAt: new Date().toISOString(),
  };
}

export function extractInboxListFromDocument(
  doc: Document,
  url: string,
  store: PassiveEntityStore,
): LinkedInThread[] {
  absorbEmbeddedHydration(doc, store);
  const now = new Date().toISOString();
  const rows = Array.from(doc.querySelectorAll('[data-test="thread-item"], .msg-conversation-listitem'));
  return rows.map((row, idx) => {
    const link = row.querySelector('a[href]');
    const href = link?.getAttribute('href') ?? `/messaging/thread/${idx + 1}`;
    const fullUrl = new URL(href, url).href;
    const threadId = row.getAttribute('data-thread-id') ?? extractSlugAfter(fullUrl, '/thread/');
    const title = txt(row.querySelector('[data-test="thread-title"], .msg-conversation-listitem__participant-names')) || `Thread ${threadId}`;
    const lastMessageText = txt(row.querySelector('[data-test="thread-snippet"], .msg-conversation-card__message-snippet')) || undefined;
    const unread = row.getAttribute('data-unread') === 'true' || row.classList.contains('msg-conversation-card--unread');
    return {
      threadId,
      url: fullUrl,
      title,
      participants: [title],
      lastMessageText,
      unread,
      messages: [],
      source: 'dom',
      capturedAt: now,
    };
  });
}

export function extractInboxThreadFromDocument(
  doc: Document,
  url: string,
  store: PassiveEntityStore,
  requestedThreadId?: string,
): LinkedInThread {
  absorbEmbeddedHydration(doc, store);
  const threadId = requestedThreadId || extractSlugAfter(url, '/thread/');
  const title = txt(doc.querySelector('[data-test="thread-header"], .msg-entity-lockup__entity-title, main h1')) || `Thread ${threadId}`;
  const messages: LinkedInMessage[] = Array.from(
    doc.querySelectorAll('[data-test="thread-message"], .msg-s-message-list__event'),
  ).map((el, idx) => ({
    messageId: el.getAttribute('data-message-id') ?? `${threadId}-m${idx + 1}`,
    senderName: txt(el.querySelector('[data-test="message-sender"], .msg-s-message-group__name')) || 'Participant',
    sentAt: txt(el.querySelector('[data-test="message-time"], time')) || new Date().toISOString(),
    text: txt(el.querySelector('[data-test="message-body"], .msg-s-event-listitem__body')) || txt(el),
  }));

  return {
    threadId,
    url,
    title,
    participants: Array.from(new Set(messages.map((m) => m.senderName))),
    lastMessageText: messages[messages.length - 1]?.text,
    lastMessageAt: messages[messages.length - 1]?.sentAt,
    unread: false,
    messages,
    source: 'dom',
    capturedAt: new Date().toISOString(),
  };
}

export function extractFeedFromDocument(
  doc: Document,
  url: string,
  store: PassiveEntityStore,
): LinkedInFeedResult {
  absorbEmbeddedHydration(doc, store);
  const articles = Array.from(doc.querySelectorAll('article[data-urn], [data-test="feed-post"]'));
  const posts: LinkedInPost[] = articles.map((el, idx) => {
    const postUrn = el.getAttribute('data-urn') ?? `urn:li:activity:dom-${idx + 1}`;
    const passive = store.posts.get(postUrn);
    return {
      postUrn,
      url,
      authorName: txt(el.querySelector('[data-test="post-author"], .update-components-actor__name')) || passive?.authorName || 'Author',
      text: txt(el.querySelector('[data-test="post-text"], .update-components-text')) || passive?.text || '',
      reactionsCount: passive?.reactionsCount,
      commentsCount: passive?.commentsCount,
      source: passive ? 'hybrid' : 'dom',
      capturedAt: new Date().toISOString(),
    };
  });
  return {
    pageUrl: url,
    posts,
    passiveEntitiesCount: store.totalEntitiesIngested,
    capturedAt: new Date().toISOString(),
  };
}
