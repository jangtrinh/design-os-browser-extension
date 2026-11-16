import { PageEpochStore } from '../core/page-epoch-store.js';
import { getRuntimeApi, queryTabs, updateTabUrl } from '../core/webext-polyfill.js';
import type { WebExtTab } from '../core/webext-types.js';

export async function resolveTargetTab(preferredTabId?: number, targetUrl?: string): Promise<WebExtTab | null> {
  if (typeof preferredTabId === 'number') {
    const api = getRuntimeApi();
    const all = await queryTabs({});
    const exact = all.find((t: WebExtTab) => t.id === preferredTabId);
    if (exact) return exact;
    if (api?.tabs?.get) {
      try {
        const single = await new Promise<WebExtTab>((resolve) => {
          api.tabs?.get(preferredTabId, resolve);
        });
        if (single?.id) return single;
      } catch {
        // ignore missing tab
      }
    }
  }

  const allTabs = await queryTabs({});
  if (targetUrl) {
    try {
      const targetHost = new URL(targetUrl).hostname.toLowerCase();
      const matched = allTabs.find((t: WebExtTab) => {
        if (!t.url?.startsWith('http')) return false;
        try {
          return new URL(t.url).hostname.toLowerCase() === targetHost;
        } catch {
          return false;
        }
      });
      if (matched) return matched;
    } catch {
      // ignore invalid targetUrl
    }
  }

  const activeTabs = await queryTabs({ active: true, currentWindow: true });
  const active = activeTabs[0];
  if (active?.url && active.url.startsWith('http')) {
    return active;
  }

  return (
    allTabs.find((t: WebExtTab) => t.url?.includes('linkedin.com')) ??
    allTabs.find((t: WebExtTab) => t.url?.includes('127.0.0.1') && t.url?.includes('/fixture/')) ??
    allTabs.find((t: WebExtTab) => t.url?.startsWith('http')) ??
    active ??
    null
  );
}

export async function navigateAndWait(
  tabId: number,
  targetUrl: string,
  epochStore: PageEpochStore,
  timeoutMs = 15_000,
): Promise<void> {
  const api = getRuntimeApi();
  await updateTabUrl(tabId, targetUrl);
  await new Promise<void>((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        resolve();
      }
    }, timeoutMs);

    const finish = (): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      setTimeout(resolve, 250);
    };

    api?.tabs?.onUpdated?.addListener((updatedId, changeInfo, tab) => {
      if (updatedId !== tabId) return;
      if (
        changeInfo.status === 'complete' &&
        (!tab.url || tab.url === targetUrl || tab.url.startsWith(targetUrl.split('?')[0]))
      ) {
        finish();
      }
    });
  });
  await epochStore.mintNavigation(tabId, targetUrl);
}
