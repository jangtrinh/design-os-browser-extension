import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LinkedInSqliteCache } from '../cli/src/db/sqlite-cache.js';
import { registerAllReaders } from '../cli/src/reader/register-all.js';
import { ReaderRuntime } from '../cli/src/reader/reader-runtime.js';
import { parseRedditSubredditRules } from '../extension/src/adapters/reddit/rules-reader.js';
import { parseThreadsPostReplies } from '../extension/src/adapters/threads/reader.js';
import type { CollectedPageSnapshot } from '../shared/reader-schema.js';

// Sanitized logged-out captures (2026-11-17 routine findings #2, #4, #6). The in-tab gate scan on
// main let these pages through, so the checks must not turn their empty data into "clear".
const fixture = (name: string): CollectedPageSnapshot =>
  JSON.parse(readFileSync(join(__dirname, 'fixtures', 'no-data', `${name}.snapshot.json`), 'utf8')) as CollectedPageSnapshot;

const snap = (url: string, partial: Partial<CollectedPageSnapshot> = {}): CollectedPageSnapshot => ({
  url,
  finalUrl: url,
  title: '',
  axNodes: [],
  headings: [],
  links: [],
  meta: {},
  bodySample: '',
  domMarkers: [],
  structuralAlertTexts: [],
  loadingIndicators: [],
  hiddenInstructions: [],
  scrollStepsExecuted: 0,
  ...partial,
});

const JANG_REPLY =
  'For me premium comes from consistency in motion and response: the same durations and easings everywhere.';
const THREAD_URL = 'https://www.threads.com/@jangtrinhsg/post/DfMKyrKFT3i';
const caller = { bot: 'Community', routine: 'reply-check' };

function runtimeWith(collect: (url: string) => { ok: boolean; snapshot?: CollectedPageSnapshot; gate?: 'CLEAR' | 'BLOCKED_AUTH' | 'BLOCKED_CHALLENGE' }) {
  const cache = new LinkedInSqliteCache(':memory:');
  let loads = 0;
  const rt = new ReaderRuntime({
    cache,
    mirrorAuditToFile: false,
    collectPage: async (req) => {
      loads += 1;
      return collect(req.targetUrl);
    },
  });
  return { rt, cache, loads: () => loads };
}

describe('Bug 2: duplicate_text never returns a false "clear"', () => {
  registerAllReaders();

  it('threads post.replies with nothing rendered is not complete', () => {
    const parsed = parseThreadsPostReplies(fixture('threads-post-logged-out'));
    expect(parsed.data.replies_complete).toBe(false);
    expect(parsed.missing_required).toContain('replies');
  });

  it('logged-out Threads page (0 replies read) gives unknown, not clear', async () => {
    const { rt, cache } = runtimeWith(() => ({ ok: true, snapshot: fixture('threads-post-logged-out') }));
    try {
      const env = await rt.check('duplicate_text', { site: 'threads', thread_url: THREAD_URL, text: JANG_REPLY }, caller);
      expect((env.data as { verdict: string }).verdict).toBe('unknown');
      expect(env.complete).toBe(false);
    } finally {
      cache.close();
    }
  });

  it("finds Jang's own earlier reply (jangtrinhsg) as a duplicate instead of skipping it", async () => {
    const page = snap(THREAD_URL, {
      axNodes: [
        { role: 'article', name: 'author_a 10/31/26 What makes an experience feel premium to you?' },
        { role: 'article', name: `jangtrinhsg 11/01/26 ${JANG_REPLY}` },
      ],
    });
    const parsed = parseThreadsPostReplies(page);
    expect((parsed.data.owner_items as unknown[]).length).toBe(1);
    const { rt, cache } = runtimeWith(() => ({ ok: true, snapshot: page }));
    try {
      const env = await rt.check('duplicate_text', { site: 'threads', thread_url: THREAD_URL, text: JANG_REPLY }, caller);
      const data = env.data as { verdict: string; matches: Array<{ author_is_jang: boolean }> };
      expect(data.verdict).toBe('duplicate');
      expect(data.matches[0].author_is_jang).toBe(true);
    } finally {
      cache.close();
    }
  });

  it('no candidates and no thread_url is unknown (nothing was checked)', async () => {
    const { rt, cache } = runtimeWith(() => ({ ok: true, snapshot: snap(THREAD_URL) }));
    try {
      const env = await rt.check('duplicate_text', { site: 'threads', text: JANG_REPLY }, caller);
      expect((env.data as { verdict: string }).verdict).toBe('unknown');
      expect(env.complete).toBe(false);
    } finally {
      cache.close();
    }
  });

  it('a failed read propagates as unknown with the upstream gate', async () => {
    const { rt, cache } = runtimeWith(() => ({ ok: false, gate: 'BLOCKED_AUTH' }));
    try {
      const env = await rt.check('duplicate_text', { site: 'threads', thread_url: THREAD_URL, text: JANG_REPLY }, caller);
      expect((env.data as { verdict: string }).verdict).toBe('unknown');
      expect(env.gate).not.toBe('CLEAR');
    } finally {
      cache.close();
    }
  });

  it('still clears when complete replies were read and none match', async () => {
    const page = snap(THREAD_URL, {
      axNodes: [{ role: 'article', name: 'author_a 10/31/26 Completely different reply about color tokens.' }],
    });
    const { rt, cache } = runtimeWith(() => ({ ok: true, snapshot: page }));
    try {
      const env = await rt.check('duplicate_text', { site: 'threads', thread_url: THREAD_URL, text: JANG_REPLY }, caller);
      expect((env.data as { verdict: string }).verdict).toBe('clear');
      expect(env.complete).toBe(true);
    } finally {
      cache.close();
    }
  });
});

describe('Bug 4: subreddit_rules never passes on empty rules', () => {
  registerAllReaders();
  const draft = { subreddit: 'FigmaDesign', draft_title: 'My plugin', draft_text: 'Try it: https://design-os.example' };

  it('the rules reader marks a page with zero rules as incomplete', () => {
    const parsed = parseRedditSubredditRules(fixture('reddit-rules-network-block'), { subreddit: 'FigmaDesign' });
    expect(parsed.missing_required).toContain('rules');
  });

  it('a Reddit network-security block page gives unknown / not allowed', async () => {
    const { rt, cache } = runtimeWith(() => ({ ok: true, snapshot: fixture('reddit-rules-network-block') }));
    try {
      const env = await rt.check('subreddit_rules', draft, caller);
      const data = env.data as { verdict: string; allowed: boolean };
      expect(data.verdict).toBe('unknown');
      expect(data.allowed).toBe(false);
      expect(env.complete).toBe(false);
      expect(env.error_code).toBeTruthy();
    } finally {
      cache.close();
    }
  });

  it('a failed rules read gives unknown / not allowed with the gate', async () => {
    const { rt, cache } = runtimeWith(() => ({ ok: false, gate: 'BLOCKED_CHALLENGE' }));
    try {
      const env = await rt.check('subreddit_rules', draft, caller);
      expect((env.data as { verdict: string; allowed: boolean }).allowed).toBe(false);
      expect((env.data as { verdict: string }).verdict).toBe('unknown');
      expect(env.gate).not.toBe('CLEAR');
    } finally {
      cache.close();
    }
  });

  it('explicit rules still evaluate (no false negatives)', async () => {
    const { rt, cache } = runtimeWith(() => ({ ok: true, snapshot: snap('https://www.reddit.com/') }));
    try {
      const env = await rt.check('subreddit_rules', { ...draft, rules_override: { no_links: true, raw_rules: ['1. No links'] } }, caller);
      expect((env.data as { verdict: string }).verdict).toBe('warn');
      expect(env.complete).toBe(true);
    } finally {
      cache.close();
    }
  });
});

describe('Bug 5: link_status never returns ok without checking', () => {
  registerAllReaders();

  it('unloaded public URLs (signed_in false) are unchecked and the verdict is unknown', async () => {
    const { rt, cache, loads } = runtimeWith(() => ({ ok: true, snapshot: snap('https://example.com/') }));
    try {
      const env = await rt.check('link_status', { urls: ['https://example.com/fake-404-page'], signed_in: false }, caller);
      const data = env.data as { verdict: string; items: Array<{ ok: boolean | null; checked: boolean }> };
      expect(loads()).toBe(0);
      expect(data.items[0].ok).toBeNull();
      expect(data.items[0].checked).toBe(false);
      expect(data.verdict).toBe('unknown');
      expect(env.complete).toBe(false);
    } finally {
      cache.close();
    }
  });

  it('a live read does not assume HTTP 200 and flags a rendered "Page not found"', async () => {
    const { rt, cache } = runtimeWith((url) => ({ ok: true, snapshot: snap(url, { title: 'Page not found · GitHub' }) }));
    try {
      const env = await rt.check('link_status', { urls: ['https://github.com/jangtrinh/no-such-repo'], signed_in: true }, caller);
      const item = (env.data as { items: Array<{ ok: boolean | null; status: number | null }> }).items[0];
      expect(item.status).toBeNull();
      expect(item.ok).toBe(false);
      expect((env.data as { verdict: string }).verdict).toBe('warn');
    } finally {
      cache.close();
    }
  });

  it('a live read that fails is unchecked, not ok', async () => {
    const { rt, cache } = runtimeWith(() => ({ ok: false, gate: 'BLOCKED_CHALLENGE' }));
    try {
      const env = await rt.check('link_status', { urls: ['https://x.com/jangtrinh'], signed_in: true }, caller);
      const item = (env.data as { items: Array<{ ok: boolean | null; checked: boolean }> }).items[0];
      expect(item.ok).toBeNull();
      expect(item.checked).toBe(false);
      expect((env.data as { verdict: string }).verdict).toBe('unknown');
    } finally {
      cache.close();
    }
  });

  it('an empty URL list is unknown, not clear', async () => {
    const { rt, cache } = runtimeWith(() => ({ ok: true }));
    try {
      const env = await rt.check('link_status', { urls: [] }, caller);
      expect((env.data as { verdict: string }).verdict).toBe('unknown');
    } finally {
      cache.close();
    }
  });
});
