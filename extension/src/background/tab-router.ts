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

type TabUpdatedListener = (tabId: number, changeInfo: { url?: string; status?: string }, tab: WebExtTab) => void;

/**
 * Navigates and waits for the load to finish. Redirects count: a login wall often lands on a
 * different URL (studio.youtube.com -> accounts.google.com), so any `complete` after the
 * navigation started ends the wait instead of burning the full timeout. Returns the URL the
 * tab actually ended on.
 */
export async function navigateAndWait(
  tabId: number,
  targetUrl: string,
  epochStore: PageEpochStore,
  timeoutMs = 15_000,
): Promise<string> {
  const api = getRuntimeApi();
  let finalUrl = targetUrl;
  let sawNavigation = false;
  let listener: TabUpdatedListener | undefined;
  const done = new Promise<void>((resolve) => {
    let finished = false;
    const timer = setTimeout(() => finish(), timeoutMs);
    function finish(): void {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      setTimeout(resolve, 250);
    }
    listener = (updatedId, changeInfo, tab) => {
      if (updatedId !== tabId) return;
      if (changeInfo.status === 'loading' || changeInfo.url) sawNavigation = true;
      if (tab?.url) finalUrl = tab.url;
      const sameTarget = !tab?.url || tab.url === targetUrl || tab.url.startsWith(targetUrl.split('?')[0]);
      if (changeInfo.status === 'complete' && (sameTarget || sawNavigation)) finish();
    };
    api?.tabs?.onUpdated?.addListener(listener);
  });
  await updateTabUrl(tabId, targetUrl);
  await done;
  if (listener) api?.tabs?.onUpdated?.removeListener?.(listener);
  await epochStore.mintNavigation(tabId, finalUrl);
  return finalUrl;
}
