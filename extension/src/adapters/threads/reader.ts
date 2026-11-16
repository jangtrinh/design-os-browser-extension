import { shortHash8 } from '../../../../shared/hash.js';
import type { CollectedPageSnapshot } from '../../../../shared/reader-schema.js';
import { parseCount } from '../linkedin/aria-nodes.js';

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

export function parseThreadsPostReplies(snap: CollectedPageSnapshot, ownerHandles = ['jangtrinh', 'jangtrinhvn', 'designosbyjang']): {
  data: Record<string, unknown>;
  missing_required: string[];
  notes: string[];
} {
  const ownerSet = new Set(ownerHandles.map((h) => h.toLowerCase()));
  const postId = snap.url.match(/\/post\/([A-Za-z0-9_-]+)/)?.[1] ?? shortHash8(snap.url);
  const replies: ThreadsReplyItem[] = [];
  const replyNodes = snap.axNodes.filter((n) => n.role === 'comment' || n.role === 'article');

  for (let i = 0; i < replyNodes.length; i += 1) {
    const node = replyNodes[i];
    const text = (node.text || node.name || '').trim();
    if (!text) continue;
    const handleMatch = text.match(/@([A-Za-z0-9._]+)/);
    const authorHandle = handleMatch?.[1] ?? `user_${i}`;
    if (ownerSet.has(authorHandle.toLowerCase())) continue;
    const cleanText = text.replace(/@[A-Za-z0-9._]+/, '').trim();
    const replyUrl = snap.links.find((l) => l.text && text.includes(l.text.slice(0, 20)))?.href;
    const id = replyUrl?.match(/\/post\/([A-Za-z0-9_-]+)/)?.[1] ?? shortHash8(`${postId}:${i}:${authorHandle}:${cleanText}`);
    const ownerRepliedAfter = replyNodes.slice(i + 1, i + 3).some((n) => {
      const mh = (n.text || n.name).match(/@([A-Za-z0-9._]+)/)?.[1];
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

  const repliesComplete = !/(view more replies|show more replies|replies hidden|load more)/i.test(snap.bodySample);
  const notes: string[] = [];
  if (!repliesComplete) {
    notes.push('Threads nested replies appear partially collapsed; replies_complete=false.');
  }

  return {
    data: {
      post_id: postId,
      url: snap.finalUrl || snap.url,
      replies_complete: repliesComplete,
      items: replies,
    },
    missing_required: [],
    notes,
  };
}

export function parseEngagementScout(
  site: 'threads' | 'linkedin',
  snap: CollectedPageSnapshot,
  ownerHandles = ['jangtrinh', 'jangtrinhvn', 'designosbyjang'],
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

  return {
    data: {
      site,
      page_url: snap.finalUrl || snap.url,
      replies_complete: repliesComplete,
      items,
    },
    missing_required: [],
    notes,
  };
}
