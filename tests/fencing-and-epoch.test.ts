import { describe, expect, it } from 'vitest';
import { PageEpochStore } from '../extension/src/core/page-epoch-store.js';
import { createMemoryKeyValueStore } from '../extension/src/core/webext-polyfill.js';

describe('PageEpochStore fenced dispatch', () => {
  it('increments epoch on navigation and rejects stale fences', async () => {
    let now = 1_000_000;
    const store = createMemoryKeyValueStore();
    const epochs = new PageEpochStore(store, () => now);

    const fence1 = await epochs.mintNavigation(7, 'https://www.linkedin.com/in/alice');
    expect(fence1.epoch).toBe(1);

    const validCheck = await epochs.verifyFence(fence1);
    expect(validCheck.ok).toBe(true);

    const fence2 = await epochs.mintNavigation(7, 'https://www.linkedin.com/in/bob');
    expect(fence2.epoch).toBe(2);
    expect(fence2.pageId).not.toBe(fence1.pageId);

    const staleCheck = await epochs.verifyFence(fence1);
    expect(staleCheck.ok).toBe(false);
    if (!staleCheck.ok) {
      expect(staleCheck.outcome).toBe('REJECTED_STALE');
      expect(staleCheck.code).toBe('BROWSER_PAGE_STALE');
    }
  });

  it('rejects expired leases and retires timed-out actions as UNCERTAIN without retry', async () => {
    let now = 5_000_000;
    const store = createMemoryKeyValueStore();
    const epochs = new PageEpochStore(store, () => now);

    const fence = await epochs.mintNavigation(9, 'https://www.linkedin.com/feed/', 500);
    now += 600;
    const expiredCheck = await epochs.verifyFence(fence);
    expect(expiredCheck.ok).toBe(false);
    if (!expiredCheck.ok) {
      expect(expiredCheck.outcome).toBe('REJECTED_STALE');
      expect(expiredCheck.code).toBe('BROWSER_LEASE_EXPIRED');
    }

    const fresh = await epochs.mintNavigation(9, 'https://www.linkedin.com/messaging/thread/1', 10_000);
    const uncertain = await epochs.withFencedTimeout(fresh, 15, async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
      return 'late';
    });
    expect(uncertain.ok).toBe(false);
    if (!uncertain.ok) {
      expect(uncertain.outcome).toBe('UNCERTAIN');
      expect(uncertain.code).toBe('BROWSER_DISPATCH_UNCERTAIN');
      expect(uncertain.retryable).toBe(false);
    }
  });
});
