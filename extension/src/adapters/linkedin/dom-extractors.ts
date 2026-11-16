import type {
  LinkedInCompany,
  LinkedInJob,
  LinkedInMessage,
  LinkedInThread,
} from '../../../../shared/linkedin-schema.js';
import { ingestPassiveTap, type PassiveEntityStore } from './entity-normalizer.js';

// Profile, post, feed and search now read the accessibility tree (aria-readers.ts):
// the class-name/`data-test` selectors that lived here returned empty or wrong fields on
// every live page in the 2026-11-16 pilot. Company, job and inbox were not part of that
// pilot and keep their previous selectors until they get live evidence.

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
