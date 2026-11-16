import type { CallerOrigin, HumanGateState, PageFence } from './rpc-envelope.js';

export type LinkedInSearchCategory = 'people' | 'posts' | 'jobs' | 'companies';

export type CopilotDraftKind = 'message' | 'comment' | 'post' | 'connect_note';

export type CopilotQueueStatus = 'pending' | 'approved' | 'rejected' | 'prefilled';

export type LinkedInActionName =
  | 'linkedin.status'
  | 'linkedin.search'
  | 'linkedin.profile.get'
  | 'linkedin.post.get'
  | 'linkedin.company.get'
  | 'linkedin.job.get'
  | 'linkedin.inbox.list'
  | 'linkedin.inbox.thread'
  | 'linkedin.feed.read'
  | 'linkedin.analytics.read'
  | 'linkedin.comments.read'
  | 'linkedin.draft.create'
  | 'linkedin.composer.prefill'
  | 'linkedin.queue.list'
  | 'linkedin.queue.decide';

export interface LinkedInExperienceItem {
  title: string;
  company: string;
  dateRange?: string;
  location?: string;
}

export interface LinkedInProfile {
  publicIdentifier: string;
  urn?: string;
  url: string;
  fullName: string;
  headline?: string;
  location?: string;
  about?: string;
  connectionsText?: string;
  followersCount?: number;
  experiences: LinkedInExperienceItem[];
  skills: string[];
  source: 'dom' | 'passive' | 'hybrid';
  capturedAt: string;
  /** Required fields the reader could not find; such reads are not cached. */
  missingRequired?: string[];
}

export interface LinkedInPost {
  postUrn: string;
  url: string;
  authorName: string;
  authorHeadline?: string;
  authorProfileUrl?: string;
  text: string;
  publishedAt?: string;
  reactionsCount?: number;
  commentsCount?: number;
  repostsCount?: number;
  impressionsCount?: number;
  /** `urn:li:activity:*` used by analytics links when it differs from `postUrn`. */
  activityUrn?: string;
  source: 'dom' | 'passive' | 'hybrid';
  capturedAt: string;
  missingRequired?: string[];
}

export interface LinkedInCompany {
  slug: string;
  urn?: string;
  url: string;
  name: string;
  tagline?: string;
  industry?: string;
  sizeText?: string;
  headquarters?: string;
  about?: string;
  website?: string;
  followersCount?: number;
  source: 'dom' | 'passive' | 'hybrid';
  capturedAt: string;
}

export interface LinkedInJob {
  jobId: string;
  url: string;
  title: string;
  companyName: string;
  location?: string;
  workplaceType?: string;
  salaryText?: string;
  description?: string;
  postedAt?: string;
  source: 'dom' | 'passive' | 'hybrid';
  capturedAt: string;
}

export interface LinkedInMessage {
  messageId: string;
  senderName: string;
  senderUrn?: string;
  sentAt: string;
  text: string;
}

export interface LinkedInThread {
  threadId: string;
  url: string;
  title: string;
  participants: string[];
  lastMessageText?: string;
  lastMessageAt?: string;
  unread: boolean;
  messages: LinkedInMessage[];
  source: 'dom' | 'passive' | 'hybrid';
  capturedAt: string;
}

export interface LinkedInSearchItem {
  category: LinkedInSearchCategory;
  title: string;
  subtitle?: string;
  secondary?: string;
  url: string;
  snippet?: string;
  identifier?: string;
}

export interface LinkedInSearchResult {
  category: LinkedInSearchCategory;
  query: string;
  pageUrl: string;
  items: LinkedInSearchItem[];
  passiveEntitiesCount: number;
  source: 'dom' | 'passive' | 'hybrid';
  capturedAt: string;
}

export interface LinkedInFeedResult {
  pageUrl: string;
  posts: LinkedInPost[];
  passiveEntitiesCount: number;
  capturedAt: string;
}

export interface LinkedInAnalyticsPost {
  activityUrn: string;
  analyticsUrl: string;
  postUrn?: string;
  postUrl?: string;
  textPreview?: string;
  impressions?: number;
  engagements?: number;
}

export interface LinkedInAnalyticsResult {
  pageUrl: string;
  pageKind: 'profile' | 'creator-content' | 'profile-views' | 'post-summary' | 'post' | 'other';
  metrics: {
    followers?: number;
    connections?: number;
    profileViewers?: number;
    postImpressions?: number;
    postImpressionsPeriod?: string;
    searchAppearances?: number;
    recruiterViews?: number;
  };
  posts: LinkedInAnalyticsPost[];
  recentViewers?: { name: string; profileUrl: string }[];
  source: 'dom';
  capturedAt: string;
}

export interface LinkedInComment {
  authorName: string;
  authorProfileUrl?: string;
  text: string;
  isReply: boolean;
  reactionsCount?: number;
  repliesCount?: number;
}

export interface LinkedInCommentsResult {
  postUrn: string;
  url: string;
  commentsCount?: number;
  /** False when the page shows no comment nodes (collapsed); the reader never clicks to expand. */
  commentsRendered: boolean;
  comments: LinkedInComment[];
  note?: string;
  missingRequired?: string[];
  source: 'dom';
  capturedAt: string;
}

export interface CopilotQueueItem {
  queueId: string;
  kind: CopilotDraftKind;
  target: string;
  targetUrl?: string;
  body: string;
  status: CopilotQueueStatus;
  prefilled: boolean;
  sent: false;
  createdBy: CallerOrigin;
  decidedBy?: CallerOrigin;
  fence?: PageFence;
  createdAt: string;
  updatedAt: string;
  note?: string;
}

export interface PacingSnapshot {
  readsLastHour: number;
  readsHourLimit: number;
  prefillsLastHour: number;
  prefillsHourLimit: number;
  passiveCapturedCount: number;
  lastActionAt?: string;
}

export interface LinkedInStatusReport {
  connected: boolean;
  activeTabId?: number;
  activeUrl?: string;
  humanGate: HumanGateState;
  humanGateReason?: string;
  fence?: PageFence;
  pacing: PacingSnapshot;
  pendingCopilotCount: number;
}

export interface SnapshotNode {
  ref: number;
  role: string;
  name: string;
  tag: string;
  href?: string;
  editable?: boolean;
  /** Longer visible text for non-interactive nodes (role `text`, `comment`, `article`). */
  text?: string;
}

export interface DomSnapshotResult {
  url: string;
  title: string;
  fence: PageFence;
  humanGate: HumanGateState;
  humanGateReason?: string;
  compactText: string;
  nodes: SnapshotNode[];
}
