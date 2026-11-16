import type { RpcResponse } from '../../../shared/rpc-envelope.js';
import { callBrokerRpc, type BrokerClientConfig } from '../daemon/client.js';

export interface CommentsRequest {
  postUrn?: string;
  url?: string;
  /** Read comments on the newest post in `/in/<publicId>/recent-activity/all/`. */
  latest?: boolean;
  publicId?: string;
}

/**
 * Comments on one post, or on the newest post of a profile's activity feed.
 * Two read-only navigations at most (activity page, then the post); never clicks.
 */
export async function readLinkedInComments(req: CommentsRequest, cfg: BrokerClientConfig = {}): Promise<RpcResponse> {
  if (!req.latest) {
    const url = req.url ?? (req.postUrn ? `https://www.linkedin.com/feed/update/${req.postUrn}/` : undefined);
    return callBrokerRpc(
      'linkedin.comments.read',
      { ...(req.postUrn ? { postUrn: req.postUrn } : {}), ...(url ? { url } : {}) },
      cfg,
    );
  }

  if (!req.publicId) {
    return {
      id: 'cli_input',
      ok: false,
      outcome: 'BLOCKED',
      error: { code: 'MISSING_PUBLIC_ID', message: '--latest needs --public-id <slug> (the profile whose newest post to read).', retryable: false },
    };
  }

  const feed = await callBrokerRpc(
    'linkedin.feed.read',
    { url: `https://www.linkedin.com/in/${encodeURIComponent(req.publicId)}/recent-activity/all/` },
    cfg,
  );
  if (!feed.ok) return feed;
  const posts = (feed.data as { posts?: { postUrn: string; url: string }[] } | undefined)?.posts ?? [];
  const latest = posts[0];
  if (!latest) {
    return {
      id: feed.id,
      ok: false,
      outcome: 'BLOCKED',
      error: { code: 'NO_POSTS_FOUND', message: 'No post was readable on the recent-activity page.', retryable: true },
    };
  }
  const res = await callBrokerRpc('linkedin.comments.read', { postUrn: latest.postUrn, url: latest.url }, cfg);
  return res.ok ? { ...res, data: { latestPost: latest, ...(res.data as Record<string, unknown>) } } : res;
}
