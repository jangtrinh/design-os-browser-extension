import { beforeEach, describe, expect, it, vi } from 'vitest';

// Engine harness: fake tab + content script; no browser, no network.
const harness = vi.hoisted(() => ({
  landedUrl: 'https://x.com/jangtrinh/following',
  contentScript: 'throws' as 'throws' | 'ok',
}));

vi.mock('../extension/src/background/tab-router.js', () => ({
  resolveTargetTab: async () => ({ id: 9, url: 'about:blank' }),
  navigateAndWait: async () => harness.landedUrl,
}));

vi.mock('../extension/src/core/webext-polyfill.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../extension/src/core/webext-polyfill.js')>();
  return {
    ...real,
    getSessionStore: () => real.createMemoryKeyValueStore(),
    getLocalStore: () => real.createMemoryKeyValueStore(),
    captureVisibleTabPng: async () => undefined,
    sendTabMessage: async () => {
      if (harness.contentScript === 'throws') {
        // What chrome.tabs.sendMessage does on chrome-error://chromewebdata (x.com HTTP 403).
        throw new Error('Could not establish connection. Receiving end does not exist.');
      }
      return { ok: true, outcome: 'COMMITTED', gate: { state: 'CLEAR' }, data: {} };
    },
  };
});

const { ExtensionEngine } = await import('../extension/src/background/engine.js');
const { createMemoryKeyValueStore } = await import('../extension/src/core/webext-polyfill.js');

const newEngine = () =>
  new ExtensionEngine({
    capabilities: { tier: 'tier1-chromium' } as never,
    sessionStore: createMemoryKeyValueStore(),
    localStore: createMemoryKeyValueStore(),
  });

const collect = (url: string) => ({ id: 'c1', action: 'reader.collect', params: { url } });

describe('Bug 1: reader.collect on unreadable pages and sign-in redirects', () => {
  beforeEach(() => {
    harness.landedUrl = 'https://x.com/jangtrinh/following';
    harness.contentScript = 'throws';
  });

  it('a browser error page (x.com 403) answers fast with BLOCKED_CHALLENGE instead of timing out', async () => {
    const res = await newEngine().handleRpc(collect('https://x.com/jangtrinh/following') as never);
    expect(res.ok).toBe(false);
    expect(res.humanGate).toBe('BLOCKED_CHALLENGE');
    expect(res.error?.code).toBe('PAGE_UNREADABLE');
    expect(res.error?.message).toMatch(/HTTP 403|could not be read/i);
  });

  it('gates on the URL the tab landed on, not the requested URL (YouTube Studio -> Google sign-in)', async () => {
    harness.landedUrl = 'https://accounts.google.com/v3/signin/identifier?continue=https%3A%2F%2Fstudio.youtube.com';
    harness.contentScript = 'ok';
    const res = await newEngine().handleRpc(collect('https://studio.youtube.com/') as never);
    expect(res.ok).toBe(false);
    expect(res.humanGate).toBe('BLOCKED_AUTH');
  });
});
