import { shortHash8 } from '../../../../shared/hash.js';
import type { CollectedPageSnapshot } from '../../../../shared/reader-schema.js';
import { parseCount } from '../linkedin/aria-nodes.js';

export function parseRedditUserSelf(snap: CollectedPageSnapshot): {
  data: Record<string, unknown>;
  missing_required: string[];
  notes: string[];
} {
  const texts = [...snap.headings, ...snap.axNodes.map((n) => n.text || n.name), snap.bodySample].filter(Boolean);
  const joined = texts.join('\n');
  const username = snap.url.match(/\/u(?:ser)?\/([^/?#]+)/)?.[1] || snap.headings[0]?.replace(/^u\//i, '').trim() || '';

  const postKarmaM = joined.match(/([\d,.]+[KkMm]?)\s+post\s+karma/i);
  const commentKarmaM = joined.match(/([\d,.]+[KkMm]?)\s+comment\s+karma/i);
  const totalKarmaM = joined.match(/([\d,.]+[KkMm]?)\s+karma\b/i);
  const ageM = joined.match(/cake\s+day\s*[:\-]?\s*([^\n|]+)|\b(\d+\s+(?:years?|months?|days?)\s+on reddit)/i);

  const postKarma = parseCount(postKarmaM?.[1]) ?? null;
  const commentKarma = parseCount(commentKarmaM?.[1]) ?? null;
  const totalKarma =
    parseCount(totalKarmaM?.[1]) ??
    (postKarma !== null && commentKarma !== null ? postKarma + commentKarma : null);

  const achievements = snap.axNodes
    .filter((n) => /achievement|trophy|contributor|elder/i.test(n.name))
    .map((n) => n.name.trim())
    .slice(0, 20);

  return {
    data: {
      username,
      url: snap.finalUrl || snap.url,
      post_karma: postKarma,
      comment_karma: commentKarma,
      total_karma: totalKarma,
      account_age_text: (ageM?.[1] || ageM?.[2] || '').trim() || null,
      achievements,
    },
    missing_required: username && totalKarma !== null ? [] : [...(username ? [] : ['username']), ...(totalKarma !== null ? [] : ['total_karma'])],
    notes: [],
  };
}

export function parseRedditThingScore(snap: CollectedPageSnapshot): {
  data: Record<string, unknown>;
  missing_required: string[];
  notes: string[];
} {
  const texts = [...snap.headings, ...snap.axNodes.map((n) => n.text || n.name), snap.bodySample].filter(Boolean);
  const joined = texts.join('\n');
  const removed = /\[(removed|deleted)\]|sorry, this post (?:has been|was) removed/i.test(joined);
  const id = snap.url.match(/\/comments\/([a-z0-9]+)/i)?.[1] ?? shortHash8(snap.url);

  let score: number | null = null;
  let scoreText: string | null = null;
  if (!removed) {
    const scoreM = joined.match(/(-?\d[\d,.]*[KkMm]?)\s+(?:points?|upvotes?)\b|\bscore\s*[:\-]?\s*(-?\d[\d,.]*)/i);
    if (scoreM) {
      const raw = scoreM[1] ?? scoreM[2];
      score = raw.startsWith('-') ? -Number(raw.slice(1)) : (parseCount(raw) ?? null);
      scoreText = scoreM[0].trim();
    }
  }

  const repliesM = joined.match(/(\d[\d,.]*[KkMm]?)\s+comments?\b|\breplies?\s*[:\-]?\s*(\d[\d,.]*)/i);
  const replies = repliesM ? (parseCount(repliesM[1] ?? repliesM[2]) ?? null) : null;

  return {
    data: {
      id,
      permalink: snap.finalUrl || snap.url,
      removed,
      score: removed ? null : score,
      score_text: removed ? null : scoreText,
      replies,
    },
    missing_required: [],
    notes: [
      ...(removed ? ['Item removed/deleted; score reported as null and removed=true.'] : []),
      'Reddit fuzzes displayed scores; value is captured as rendered.',
    ],
  };
}
