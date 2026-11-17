import { shortHash8 } from '../../../../shared/hash.js';
import type { CollectedPageSnapshot } from '../../../../shared/reader-schema.js';
import { parseCount } from '../linkedin/aria-nodes.js';

/** Jang's handles. `jangtrinhsg` is the Threads handle (2026-11-17 finding #2). */
export const THREADS_OWNER_HANDLES = ['jangtrinh', 'jangtrinhsg', 'jangtrinhvn', 'designosbyjang'];

export interface ThreadsOwnerReplyItem {
  id: string;
  site: 'threads';
  post_id: string;
  author_handle: string;
  text: string;
  is_owner: true;
}

export interface ThreadsReplyItem {
  id: string;
  site: 'threads';
  post_id: string;
  author_handle: string;
  text: string;
  created_at: string | null;
  already_answered_by_jang: boolean;
  third_party: true;
}

export function parseThreadsPostReplies(snap: CollectedPageSnapshot, ownerHandles = THREADS_OWNER_HANDLES): {
  data: Record<string, unknown>;
  missing_required: string[];
  notes: string[];
} {
  const ownerSet = new Set(ownerHandles.map((h) => h.toLowerCase()));
  const postId = snap.url.match(/\/post\/([A-Za-z0-9_-]+)/)?.[1] ?? shortHash8(snap.url);
  const replies: ThreadsReplyItem[] = [];
  const ownerReplies: ThreadsOwnerReplyItem[] = [];
  const replyNodes = snap.axNodes.filter((n) => n.role === 'comment' || n.role === 'article');
  const handleOf = (n: { text?: string; name?: string }): string | undefined => {
    const raw = (n.text || n.name || '').trim();
    // Threads renders "handle  date  text" without "@"; fall back to the leading token.
    return raw.match(/@([A-Za-z0-9._]+)/)?.[1] ?? raw.match(/^([A-Za-z0-9._]{2,30})\s/)?.[1];
  };

  for (let i = 0; i < replyNodes.length; i += 1) {
    const node = replyNodes[i];
    const text = (node.text || node.name || '').trim();
    if (!text) continue;
    const authorHandle = handleOf(node) ?? `user_${i}`;
    const cleanText = text.replace(/@[A-Za-z0-9._]+/, '').replace(new RegExp(`^${authorHandle.replace(/[.]/g, '\\.')}\\s+`), '').trim();
    if (ownerSet.has(authorHandle.toLowerCase())) {
      // Keep Jang's own replies: the duplicate-text check must see them, or a repeat looks "clear".
      ownerReplies.push({
        id: shortHash8(`${postId}:owner:${i}:${cleanText}`),
        site: 'threads',
        post_id: postId,
        author_handle: authorHandle,
        text: cleanText || text,
        is_owner: true,
      });
      continue;
    }
    const replyUrl = snap.links.find((l) => l.text && text.includes(l.text.slice(0, 20)))?.href;
    const id = replyUrl?.match(/\/post\/([A-Za-z0-9_-]+)/)?.[1] ?? shortHash8(`${postId}:${i}:${authorHandle}:${cleanText}`);
    const ownerRepliedAfter = replyNodes.slice(i + 1, i + 3).some((n) => {
      const mh = handleOf(n);
      return mh ? ownerSet.has(mh.toLowerCase()) : false;
    });
    replies.push({
      id,
      site: 'threads',
      post_id: postId,
      author_handle: authorHandle,
      text: cleanText || text,
      created_at: null,
      already_answered_by_jang: ownerRepliedAfter,
      third_party: true,
    });
  }

  const collapsed = /(view more replies|show more replies|replies hidden|load more)/i.test(snap.bodySample);
  const nothingRendered = replies.length === 0 && ownerReplies.length === 0;
  // No data is never "complete": zero rendered replies can mean a login wall or an unhydrated page.
  const repliesComplete = !collapsed && !nothingRendered;
  const notes: string[] = [];
  if (collapsed) {
    notes.push('Threads nested replies appear partially collapsed; replies_complete=false.');
  }
  if (nothingRendered) {
    notes.push('No replies rendered on the page; cannot confirm the post has none. replies_complete=false.');
  }

  return {
    data: {
      post_id: postId,
      url: snap.finalUrl || snap.url,
      replies_complete: repliesComplete,
      items: replies,
      owner_items: ownerReplies,
    },
    missing_required: nothingRendered ? ['replies'] : [],
    notes,
  };
}

export function parseEngagementScout(
  site: 'threads' | 'linkedin',
  snap: CollectedPageSnapshot,
  ownerHandles = THREADS_OWNER_HANDLES,
): {
  data: Record<string, unknown>;
  missing_required: string[];
  notes: string[];
} {
  const ownerSet = new Set(ownerHandles.map((h) => h.toLowerCase()));
  const repliesComplete = !/(view more replies|show more replies|load more)/i.test(snap.bodySample);
  const articles = snap.axNodes.filter((n) => n.role === 'article');
  const items = articles.map((node, idx) => {
    const body = (node.text || node.name || '').trim();
    const handle = body.match(/@([A-Za-z0-9._]+)/)?.[1] ?? node.name.match(/^([A-Za-z0-9 ._-]+)/)?.[1]?.trim() ?? `author_${idx}`;
    const link = snap.links.find((l) => /\/post\/|\/feed\/update\//.test(l.href) && (!node.text || l.text === '' || node.text.includes(l.text.slice(0, 15)))) ?? snap.links[idx];
    const url = link?.href || snap.url;
    const id = url.match(/\/post\/([A-Za-z0-9_-]+)|urn:li:(?:share|ugcPost|activity):\d+/)?.[0]?.replace(/^\/post\//, '') ?? shortHash8(`${site}|search.posts|${url}|${idx}`);
    const replyM = body.match(/(\d[\d,.]*[KkMm]?)\s*(?:replies|comments?)/i);
    const reactM = body.match(/(\d[\d,.]*[KkMm]?)\s*(?:likes?|reactions?)/i);
    const ownerPresent = Array.from(ownerSet).some((h) => body.toLowerCase().includes(`@${h}`) || body.toLowerCase().includes(`${h} replied`));

    return {
      id,
      id_synthetic: !link?.href,
      site,
      url,
      author_handle: handle,
      text: body,
      posted_at: null,
      reply_count: parseCount(replyM?.[1]) ?? null,
      reaction_count: parseCount(reactM?.[1]) ?? null,
      replies_complete: repliesComplete,
      jang_already_replied: repliesComplete ? ownerPresent : (ownerPresent ? true : null),
      third_party: true as const,
    };
  });

  const notes: string[] = [];
  if (!repliesComplete) {
    notes.push('Replies not fully rendered on page; unconfirmed items report jang_already_replied=null.');
  }

  if (items.length === 0) {
    notes.push('No posts rendered on the page; an empty result is not a complete result.');
  }

  return {
    data: {
      site,
      page_url: snap.finalUrl || snap.url,
      replies_complete: repliesComplete && items.length > 0,
      items,
    },
    missing_required: items.length === 0 ? ['items'] : [],
    notes,
  };
}
