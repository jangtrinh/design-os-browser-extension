import { normalizeNfc, sha256Hex } from '../../../shared/hash.js';
import type { ReaderCaller } from '../../../shared/reader-schema.js';
import { registerCompositeReader } from './reader-registry.js';
import type { ReaderRuntime } from './reader-runtime.js';
import { detectHiddenPromptInstructions } from './redaction.js';

export type CommentTier = 'ignore' | 'draft_reply' | 'propose_block';

export interface UnifiedCommentItem {
  id: string;
  site: 'linkedin' | 'threads' | 'x';
  post_id: string;
  author_handle: string;
  text: string;
  text_sha256: string;
  created_at: string;
  already_answered_by_jang: boolean;
  tier: CommentTier;
  tier_source: 's1' | 'llm';
  confidence: number;
  third_party: true;
  notes?: string[];
}

const SPAM_OR_BOT_RE = /\b(dm for collab|buy followers|crypto airdrop|pump your|nice post check my bio|great insight kindly connect|check out my profile for passive income)\b/i;
const ABUSIVE_RE = /\b(scammer|fraud|idiot|stupid|spammer|kill yourself)\b/i;

export function classifyCommentTier(params: {
  text: string;
  alreadyAnswered: boolean;
  promptInjection?: boolean;
}): { tier: CommentTier; tier_source: 's1' | 'llm'; confidence: number } {
  if (params.promptInjection) {
    return { tier: 'ignore', tier_source: 's1', confidence: 0.99 };
  }
  if (ABUSIVE_RE.test(params.text)) {
    return { tier: 'propose_block', tier_source: 's1', confidence: 0.95 };
  }
  if (params.alreadyAnswered) {
    return { tier: 'ignore', tier_source: 's1', confidence: 0.98 };
  }
  if (SPAM_OR_BOT_RE.test(params.text)) {
    return { tier: 'ignore', tier_source: 's1', confidence: 0.92 };
  }
  const meaningful = params.text.trim().length >= 8;
  return meaningful
    ? { tier: 'draft_reply', tier_source: 's1', confidence: 0.85 }
    : { tier: 'ignore', tier_source: 'llm', confidence: 0.65 };
}

export function mergeAndTierCommentFeed(params: {
  linkedinComments?: Array<Record<string, unknown>>;
  threadsReplies?: Array<Record<string, unknown>>;
  xConnectorItems?: Array<Record<string, unknown>>;
  previousHashes?: Record<string, string>;
}): { items: UnifiedCommentItem[]; re_tiered_ids: string[] } {
  const prev = params.previousHashes ?? {};
  const merged = new Map<string, UnifiedCommentItem>();
  const reTiered: string[] = [];

  const ingest = (site: 'linkedin' | 'threads' | 'x', rawItems: Array<Record<string, unknown>> = []): void => {
    for (const raw of rawItems) {
      const id = String(raw.id ?? '');
      const text = normalizeNfc(String(raw.text ?? '').trim());
      if (!id || !text) continue;
      const key = `${site}:${id}`;
      const sha = sha256Hex(text);
      const answered = Boolean(raw.already_answered_by_jang);
      const isInjected = detectHiddenPromptInstructions([text]);
      const classified = classifyCommentTier({ text, alreadyAnswered: answered, promptInjection: isInjected });

      if (prev[key] && prev[key] !== sha) {
        reTiered.push(key);
      }

      merged.set(key, {
        id,
        site,
        post_id: String(raw.post_id ?? raw.postUrn ?? ''),
        author_handle: String(raw.author_handle ?? raw.authorName ?? 'unknown'),
        text,
        text_sha256: sha,
        created_at: String(raw.created_at ?? new Date(0).toISOString()),
        already_answered_by_jang: answered,
        tier: classified.tier,
        tier_source: classified.tier_source,
        confidence: classified.confidence,
        third_party: true,
        ...(isInjected ? { notes: ['PAGE_INSTRUCTION_IGNORED'] } : {}),
      });
    }
  };

  ingest('linkedin', params.linkedinComments);
  ingest('threads', params.threadsReplies);
  ingest('x', params.xConnectorItems);

  const items = Array.from(merged.values()).sort((a, b) => b.created_at.localeCompare(a.created_at));
  return { items, re_tiered_ids: reTiered };
}

export function registerUnifiedCommentFeed(): void {
  registerCompositeReader(
    {
      site: 'threads',
      view: 'feed.comments',
      description: 'Unified comment & mention feed merging LinkedIn rendered comments, Threads replies, and X connector mentions (0 x.com browser loads).',
      requiredFields: ['items'],
      freshnessClass: 'comments',
      defaultMaxAgeS: 3_600,
      allowedHosts: ['www.threads.com', 'threads.com', 'www.linkedin.com'],
    },
    async (runtime: ReaderRuntime, input: { params: Record<string, unknown>; caller: ReaderCaller }) => {
      const notes: string[] = [];
      let linkedinComments = Array.isArray(input.params.linkedin_comments)
        ? (input.params.linkedin_comments as Array<Record<string, unknown>>)
        : [];
      let threadsReplies = Array.isArray(input.params.threads_replies)
        ? (input.params.threads_replies as Array<Record<string, unknown>>)
        : [];

      if (typeof input.params.linkedin_post_url === 'string') {
        const liEnv = await runtime.read({
          site: 'linkedin',
          view: 'post.comments',
          target: input.params.linkedin_post_url,
          evidence: 'off',
          caller: input.caller,
        });
        if (liEnv.ok) {
          const data = liEnv.data as Record<string, unknown>;
          if (data.comments_rendered === false) {
            notes.push('comments_rendered: false (no click made on LinkedIn collapsed comments)');
          }
          if (Array.isArray(data.comments)) {
            linkedinComments = data.comments as Array<Record<string, unknown>>;
          }
        }
      }

      if (typeof input.params.threads_post_url === 'string') {
        const thEnv = await runtime.read({
          site: 'threads',
          view: 'post.replies',
          target: input.params.threads_post_url,
          evidence: 'off',
          caller: input.caller,
        });
        if (thEnv.ok && Array.isArray((thEnv.data as Record<string, unknown>).items)) {
          threadsReplies = (thEnv.data as Record<string, unknown>).items as Array<Record<string, unknown>>;
        }
      }

      // X mentions MUST come via connector items passed in params — browser NEVER loads x.com here.
      const xConnectorItems = Array.isArray(input.params.x_connector_items)
        ? (input.params.x_connector_items as Array<Record<string, unknown>>)
        : [];

      const { items, re_tiered_ids } = mergeAndTierCommentFeed({
        linkedinComments,
        threadsReplies,
        xConnectorItems,
        previousHashes: (input.params.previous_hashes as Record<string, string> | undefined) ?? {},
      });

      if (items.some((i) => i.notes?.includes('PAGE_INSTRUCTION_IGNORED'))) {
        notes.push('PAGE_INSTRUCTION_IGNORED');
      }

      return {
        ok: true,
        data: { items, re_tiered_ids, count: items.length },
        missing_required: [],
        notes,
      };
    },
  );
}
