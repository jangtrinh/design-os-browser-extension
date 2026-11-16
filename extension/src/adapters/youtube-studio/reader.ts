import { shortHash8 } from '../../../../shared/hash.js';
import type { CollectedPageSnapshot } from '../../../../shared/reader-schema.js';
import { parseCount } from '../linkedin/aria-nodes.js';

function extractNumberAfterOrBefore(texts: string[], re: RegExp): { value: number | null; text: string | null } {
  for (const line of texts) {
    const mAfter = line.match(new RegExp(`${re.source}\\s*[:\\-]?\\s*([\\d,.]+(?:[KkMm])?)(?:\\s*(?:hours?|views?))?`, 'i'));
    if (mAfter) return { value: parseCount(mAfter[1]) ?? null, text: mAfter[0].trim() };
    const mBefore = line.match(new RegExp(`([\\d,.]+(?:[KkMm])?)\\s+${re.source}`, 'i'));
    if (mBefore) return { value: parseCount(mBefore[1]) ?? null, text: mBefore[0].trim() };
  }
  return { value: null, text: null };
}

export function parseYouTubeStudioChannelAnalytics(snap: CollectedPageSnapshot): {
  data: Record<string, unknown>;
  missing_required: string[];
  notes: string[];
} {
  const texts = [...snap.headings, ...snap.axNodes.map((n) => n.text || n.name), snap.bodySample].filter(Boolean);
  const period =
    snap.bodySample.match(/\b(past \d+ days|last \d+ days|7 days|28 days|90 days)\b/i)?.[1]?.toLowerCase().replace(/\s+/g, '_') ??
    'past_28_days';

  const views = extractNumberAfterOrBefore(texts, /views/);
  const watchTime = extractNumberAfterOrBefore(texts, /watch time(?:\s*\(hours\))?/);
  const subscribers = extractNumberAfterOrBefore(texts, /subscribers?/);

  const notes: string[] = [];
  if (/(copyright|claim|restriction noticed)/i.test(snap.bodySample)) {
    notes.push('YouTube copyright/claim notice present on page (recorded as data, non-blocking).');
  }

  return {
    data: {
      channel_url: snap.url,
      period,
      views: views.value,
      views_text: views.text,
      watch_time_hours: watchTime.value,
      watch_time_text: watchTime.text,
      subscribers: subscribers.value,
      subscribers_text: subscribers.text,
    },
    missing_required: views.value === null ? ['views'] : [],
    notes,
  };
}

export function parseYouTubeStudioVideosAnalytics(snap: CollectedPageSnapshot): {
  data: Record<string, unknown>;
  missing_required: string[];
  notes: string[];
} {
  const period =
    snap.bodySample.match(/\b(past \d+ days|last \d+ days|7 days|28 days|90 days)\b/i)?.[1]?.toLowerCase().replace(/\s+/g, '_') ??
    'past_28_days';
  const videos: Array<{
    id: string;
    video_id: string;
    title: string;
    views: number | null;
    ctr_pct: number | null;
    avg_view_duration_text: string | null;
  }> = [];

  for (const node of snap.axNodes) {
    const vidMatch = node.href?.match(/\/video\/([A-Za-z0-9_-]+)/);
    const line = node.text || node.name;
    const viewsM = line.match(/([\d,.]+[KkMm]?)\s+views/i);
    if (!vidMatch && !viewsM) continue;
    const videoId = vidMatch?.[1] ?? shortHash8(line);
    const ctrM = line.match(/([\d.]+)%\s*(?:CTR|impressions click-through)/i);
    const durM = line.match(/avg(?:erage)?\s*(?:view\s*)?duration\s*[:\-]?\s*(\d+:\d+)/i);
    videos.push({
      id: videoId,
      video_id: videoId,
      title: line.split('|')[0]?.trim() || node.name.slice(0, 140),
      views: parseCount(viewsM?.[1]) ?? null,
      ctr_pct: ctrM ? Number(ctrM[1]) : null,
      avg_view_duration_text: durM?.[1] ?? null,
    });
  }

  const notes: string[] = [];
  if (/(copyright|claim)/i.test(snap.bodySample)) {
    notes.push('YouTube copyright/claim notice present on video row.');
  }

  return {
    data: { page_url: snap.url, period, videos },
    missing_required: [],
    notes,
  };
}
