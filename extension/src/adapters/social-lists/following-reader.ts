import { shortHash8 } from '../../../../shared/hash.js';
import type { CollectedPageSnapshot, ReaderSiteId } from '../../../../shared/reader-schema.js';
import { parseCount } from '../linkedin/aria-nodes.js';

export interface SocialFollowItem {
  id: string;
  id_synthetic?: boolean;
  handle: string;
  display_name: string;
  profile_url: string;
  position: number;
  third_party: true;
}

const PROFILE_LINK_PATTERNS: Record<'facebook' | 'x' | 'linkedin' | 'threads', RegExp> = {
  facebook: /facebook\.com\/(?!me\/|friends|following|followers|groups|watch)([^/?#]+)/i,
  x: /(?:x|twitter)\.com\/(?!home|explore|notifications|messages|i\/|search)([A-Za-z0-9_]+)/i,
  linkedin: /linkedin\.com\/in\/([^/?#]+)/i,
  threads: /threads\.(?:com|net)\/@?([A-Za-z0-9._]+)/i,
};

export function parseSocialFollowList(
  site: Extract<ReaderSiteId, 'facebook' | 'x' | 'linkedin' | 'threads'>,
  view: 'following.list' | 'followers.list',
  snap: CollectedPageSnapshot,
  params: Record<string, unknown> = {},
): {
  data: Record<string, unknown>;
  missing_required: string[];
  notes: string[];
} {
  const seenIds = new Set<string>(
    Array.isArray(params.seen_ids) ? (params.seen_ids as unknown[]).map(String) : [],
  );
  const startCursor = typeof params.cursor === 'string' && params.cursor ? Number(params.cursor) || 0 : 0;

  const pat = PROFILE_LINK_PATTERNS[site];
  const items: SocialFollowItem[] = [];
  const candidateLinks = [
    ...snap.links,
    ...snap.axNodes.filter((n) => n.href).map((n) => ({ text: n.name, href: n.href! })),
  ];

  const batchSeen = new Set<string>();
  let pos = startCursor;
  for (const link of candidateLinks) {
    const m = link.href.match(pat);
    if (!m) continue;
    const handle = decodeURIComponent(m[1]).replace(/^@/, '');
    if (!handle || batchSeen.has(handle.toLowerCase())) continue;
    batchSeen.add(handle.toLowerCase());

    const id = `${site}:${handle.toLowerCase()}` || shortHash8(`${site}|${view}|${link.href}|${pos}`);
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    pos += 1;

    items.push({
      id,
      handle,
      display_name: (link.text || handle).trim().slice(0, 140),
      profile_url: link.href,
      position: pos,
      third_party: true,
    });
  }

  const totalMatch = [...snap.headings, ...snap.axNodes.map((n) => n.name), snap.bodySample]
    .join('\n')
    .match(/(\d[\d,.]*[KkMm]?)\s*(?:following|followers?)\b/i);
  const totalCount = parseCount(totalMatch?.[1]) ?? null;
  const totalText = totalMatch?.[0]?.trim() ?? null;

  const nextCursor = items.length > 0 ? String(pos) : (typeof params.cursor === 'string' ? params.cursor : null);
  const notes: string[] = [];
  if (snap.stalled) {
    notes.push('List loading stalled on spinner; returning collected items with resume cursor.');
  }

  return {
    data: {
      site,
      view,
      page_url: snap.finalUrl || snap.url,
      total_count: totalCount,
      total_text: totalText,
      cursor: nextCursor,
      seen_ids: Array.from(seenIds),
      items,
    },
    missing_required: [],
    notes,
  };
}
