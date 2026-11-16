import type { CollectedPageSnapshot } from '../../../../shared/reader-schema.js';
import { readAnalytics } from './aria-analytics.js';
import { parseCount } from './aria-nodes.js';
import { readProfile } from './aria-readers.js';

export interface LinkedInNightlySnapshot {
  period: string;
  followers: number | null;
  followers_text: string | null;
  connections: number | null;
  connections_text: string | null;
  connections_floor: boolean;
  profile_views: number | null;
  impressions: number | null;
  search_appearances: number | null;
  recruiter_views: number | null;
  posts: Array<{
    id: string;
    activity_urn: string;
    post_urn: string | null;
    post_url: string | null;
    impressions: number | null;
    engagements: number | null;
    text_preview: string | null;
  }>;
  recent_viewers: Array<{ name: string; profile_url: string }>;
  chart_totals: null;
  notes: string[];
}

export function buildLinkedInNightlySnapshot(parts: {
  profileSnap?: CollectedPageSnapshot;
  contentSnap?: CollectedPageSnapshot;
  profileViewsSnap?: CollectedPageSnapshot;
}): LinkedInNightlySnapshot {
  const notes: string[] = [];
  const profileAria = parts.profileSnap ? readProfile(parts.profileSnap.axNodes, parts.profileSnap.url, 'jangtrinh') : null;
  const profileAn = parts.profileSnap ? readAnalytics(parts.profileSnap.axNodes, parts.profileSnap.url) : null;
  const contentAn = parts.contentSnap ? readAnalytics(parts.contentSnap.axNodes, parts.contentSnap.url) : null;
  const viewersAn = parts.profileViewsSnap ? readAnalytics(parts.profileViewsSnap.axNodes, parts.profileViewsSnap.url) : null;

  const followersNode = parts.profileSnap?.axNodes.find((n) => /\bfollowers?\b/i.test(n.name));
  const connectionsText = profileAria?.connectionsText ?? null;
  const connectionsNum = parseCount(connectionsText) ?? profileAn?.metrics.connections ?? null;
  const connectionsFloor = Boolean(connectionsText && /\+$/.test(connectionsText.replace(/\s+connections?$/i, '').trim()));

  const period =
    contentAn?.metrics.postImpressionsPeriod ??
    profileAn?.metrics.postImpressionsPeriod ??
    'past_7_days';

  const followers = profileAria?.followersCount ?? profileAn?.metrics.followers ?? null;
  const profileViews = profileAn?.metrics.profileViewers ?? contentAn?.metrics.profileViewers ?? null;
  const impressions = profileAn?.metrics.postImpressions ?? contentAn?.metrics.postImpressions ?? null;
  const searchAppearances = profileAn?.metrics.searchAppearances ?? null;
  const recruiterViews = viewersAn?.metrics.recruiterViews ?? profileAn?.metrics.recruiterViews ?? null;

  const posts = (contentAn?.posts ?? profileAn?.posts ?? []).map((p) => ({
    id: p.activityUrn,
    activity_urn: p.activityUrn,
    post_urn: p.postUrn ?? null,
    post_url: p.postUrl ?? null,
    impressions: p.impressions ?? null,
    engagements: p.engagements ?? null,
    text_preview: p.textPreview ?? null,
  }));

  const recentViewers = (viewersAn?.recentViewers ?? []).map((v) => ({
    name: v.name,
    profile_url: v.profileUrl,
  }));

  notes.push('Non-interactive chart totals reported as null (accessibility tree only).');

  return {
    period,
    followers,
    followers_text: followersNode?.name ?? null,
    connections: connectionsNum,
    connections_text: connectionsText,
    connections_floor: connectionsFloor,
    profile_views: profileViews,
    impressions,
    search_appearances: searchAppearances,
    recruiter_views: recruiterViews,
    posts,
    recent_viewers: recentViewers,
    chart_totals: null,
    notes,
  };
}
