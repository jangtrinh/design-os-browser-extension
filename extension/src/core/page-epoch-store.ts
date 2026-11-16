import type { PageFence } from '../../../shared/rpc-envelope.js';
import type { KeyValueStore } from './webext-polyfill.js';

export interface PageEpochRecord extends PageFence {
  url: string;
  leaseExpiresAt: number;
  updatedAt: number;
}

export type FenceVerification =
  | { ok: true; record: PageEpochRecord }
  | {
      ok: false;
      outcome: 'REJECTED_STALE';
      code: 'BROWSER_PAGE_STALE' | 'BROWSER_LEASE_EXPIRED' | 'BROWSER_NO_ACTIVE_LEASE';
      message: string;
    };

export type FencedDispatchResult<T> =
  | { ok: true; outcome: 'COMMITTED'; data: T }
  | {
      ok: false;
      outcome: 'REJECTED_STALE' | 'UNCERTAIN';
      code: string;
      message: string;
      retryable: false;
    };

const DEFAULT_LEASE_TTL_MS = 30_000;

function keyForTab(tabId: number): string {
  return `fence:tab:${tabId}`;
}

function randomToken(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  }
  return `${prefix}_${Math.random().toString(36).slice(2, 14)}`;
}

/**
 * Stores per-tab Page Epoch, navigation-bound pageId, and ownership lease in `storage.session`
 * so MV3 service worker restarts and SPA/URL transitions invalidate stale element refs cleanly.
 */
export class PageEpochStore {
  private readonly store: KeyValueStore;
  private readonly nowFn: () => number;

  constructor(store: KeyValueStore, nowFn: () => number = () => Date.now()) {
    this.store = store;
    this.nowFn = nowFn;
  }

  async getRecord(tabId: number): Promise<PageEpochRecord | null> {
    const key = keyForTab(tabId);
    const items = await this.store.get([key]);
    const rec = items[key] as PageEpochRecord | undefined;
    return rec ?? null;
  }

  async mintNavigation(
    tabId: number,
    url: string,
    leaseTtlMs: number = DEFAULT_LEASE_TTL_MS,
  ): Promise<PageEpochRecord> {
    const existing = await this.getRecord(tabId);
    const now = this.nowFn();
    const nextRecord: PageEpochRecord = {
      tabId,
      pageId: randomToken('pg'),
      epoch: (existing?.epoch ?? 0) + 1,
      leaseId: randomToken('ls'),
      leaseExpiresAt: now + leaseTtlMs,
      url,
      updatedAt: now,
    };
    await this.store.set({ [keyForTab(tabId)]: nextRecord });
    return nextRecord;
  }

  async ensureCurrent(
    tabId: number,
    url: string,
    leaseTtlMs: number = DEFAULT_LEASE_TTL_MS,
  ): Promise<PageEpochRecord> {
    const existing = await this.getRecord(tabId);
    const now = this.nowFn();
    if (!existing || existing.url !== url) {
      return this.mintNavigation(tabId, url, leaseTtlMs);
    }
    const renewed: PageEpochRecord = {
      ...existing,
      leaseExpiresAt: now + leaseTtlMs,
      updatedAt: now,
    };
    await this.store.set({ [keyForTab(tabId)]: renewed });
    return renewed;
  }

  async clearTab(tabId: number): Promise<void> {
    await this.store.remove([keyForTab(tabId)]);
  }

  async verifyFence(expected: PageFence): Promise<FenceVerification> {
    const current = await this.getRecord(expected.tabId);
    if (!current) {
      return {
        ok: false,
        outcome: 'REJECTED_STALE',
        code: 'BROWSER_NO_ACTIVE_LEASE',
        message: `No active lease stored in session storage for tab ${expected.tabId}. Re-observe page before dispatch.`,
      };
    }
    if (current.pageId !== expected.pageId || current.epoch !== expected.epoch) {
      return {
        ok: false,
        outcome: 'REJECTED_STALE',
        code: 'BROWSER_PAGE_STALE',
        message: `Stale target fence: expected pageId=${expected.pageId}@${expected.epoch}, current=${current.pageId}@${current.epoch}.`,
      };
    }
    const now = this.nowFn();
    if (now > current.leaseExpiresAt || current.leaseId !== expected.leaseId) {
      return {
        ok: false,
        outcome: 'REJECTED_STALE',
        code: 'BROWSER_LEASE_EXPIRED',
        message: `Lease mismatch or expired for tab ${expected.tabId}.`,
      };
    }
    return { ok: true, record: current };
  }

  /**
   * Executes an action under a verified fence. Timed-out mutations resolve to `UNCERTAIN`
   * (`retryable: false`) instead of blind retry.
   */
  async withFencedTimeout<T>(
    expected: PageFence,
    timeoutMs: number,
    fn: () => Promise<T>,
  ): Promise<FencedDispatchResult<T>> {
    const check = await this.verifyFence(expected);
    if (!check.ok) {
      return {
        ok: false,
        outcome: 'REJECTED_STALE',
        code: check.code,
        message: check.message,
        retryable: false,
      };
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const data = await Promise.race<T>([
        fn(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error('DISPATCH_TIMEOUT'));
          }, timeoutMs);
        }),
      ]);
      return { ok: true, outcome: 'COMMITTED', data };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === 'DISPATCH_TIMEOUT') {
        return {
          ok: false,
          outcome: 'UNCERTAIN',
          code: 'BROWSER_DISPATCH_UNCERTAIN',
          message: `Dispatch timed out after ${timeoutMs}ms. Re-read page state before any follow-up action; do not blind-retry.`,
          retryable: false,
        };
      }
      throw err;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}
