import type {
  ChromeCallbackStorageArea,
  WebExtApi,
  WebExtStorageArea,
  WebExtTab,
} from './webext-types.js';

export interface KeyValueStore {
  get(keys: string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
}

export function createMemoryKeyValueStore(): KeyValueStore {
  const map = new Map<string, unknown>();
  return {
    async get(keys) {
      const out: Record<string, unknown> = {};
      if (!keys) {
        for (const [k, v] of map.entries()) out[k] = v;
        return out;
      }
      for (const k of keys) {
        if (map.has(k)) out[k] = map.get(k);
      }
      return out;
    },
    async set(items) {
      for (const [k, v] of Object.entries(items)) {
        map.set(k, v);
      }
    },
    async remove(keys) {
      for (const k of keys) map.delete(k);
    },
  };
}

function getRawApi(): WebExtApi | undefined {
  const g = globalThis as typeof globalThis & { browser?: WebExtApi; chrome?: WebExtApi };
  return g.browser ?? g.chrome;
}

function wrapStorageArea(area: ChromeCallbackStorageArea | WebExtStorageArea): KeyValueStore {
  return {
    get(keys) {
      return new Promise((resolve, reject) => {
        try {
          const maybePromise = (area as WebExtStorageArea).get(keys);
          if (maybePromise && typeof (maybePromise as Promise<Record<string, unknown>>).then === 'function') {
            (maybePromise as Promise<Record<string, unknown>>).then(resolve, reject);
            return;
          }
        } catch {
          // Fall through to callback style
        }
        (area as ChromeCallbackStorageArea).get(keys, (items) => {
          const err = getRawApi()?.runtime?.lastError;
          if (err?.message) reject(new Error(err.message));
          else resolve(items ?? {});
        });
      });
    },
    set(items) {
      return new Promise((resolve, reject) => {
        try {
          const maybePromise = (area as WebExtStorageArea).set(items);
          if (maybePromise && typeof (maybePromise as Promise<void>).then === 'function') {
            (maybePromise as Promise<void>).then(resolve, reject);
            return;
          }
        } catch {
          // Fall through to callback style
        }
        (area as ChromeCallbackStorageArea).set(items, () => {
          const err = getRawApi()?.runtime?.lastError;
          if (err?.message) reject(new Error(err.message));
          else resolve();
        });
      });
    },
    remove(keys) {
      return new Promise((resolve, reject) => {
        try {
          const maybePromise = (area as WebExtStorageArea).remove(keys);
          if (maybePromise && typeof (maybePromise as Promise<void>).then === 'function') {
            (maybePromise as Promise<void>).then(resolve, reject);
            return;
          }
        } catch {
          // Fall through to callback style
        }
        (area as ChromeCallbackStorageArea).remove(keys, () => {
          const err = getRawApi()?.runtime?.lastError;
          if (err?.message) reject(new Error(err.message));
          else resolve();
        });
      });
    },
  };
}

const fallbackSession = createMemoryKeyValueStore();
const fallbackLocal = createMemoryKeyValueStore();

export function getSessionStore(): KeyValueStore {
  const api = getRawApi();
  if (api?.storage?.session) return wrapStorageArea(api.storage.session);
  return fallbackSession;
}

export function getLocalStore(): KeyValueStore {
  const api = getRawApi();
  if (api?.storage?.local) return wrapStorageArea(api.storage.local);
  return fallbackLocal;
}

export function hasSessionStorage(): boolean {
  return Boolean(getRawApi()?.storage?.session);
}

export function getRuntimeApi(): WebExtApi | undefined {
  return getRawApi();
}

export async function queryTabs(queryInfo: {
  active?: boolean;
  currentWindow?: boolean;
  url?: string | string[];
}): Promise<WebExtTab[]> {
  const tabs = getRawApi()?.tabs;
  if (!tabs) return [];
  return new Promise((resolve, reject) => {
    try {
      const maybe = tabs.query(queryInfo);
      if (maybe && typeof (maybe as Promise<WebExtTab[]>).then === 'function') {
        (maybe as Promise<WebExtTab[]>).then(resolve, reject);
        return;
      }
    } catch {
      // callback path
    }
    tabs.query(queryInfo, (res) => {
      const err = getRawApi()?.runtime?.lastError;
      if (err?.message) reject(new Error(err.message));
      else resolve(res ?? []);
    });
  });
}

export async function updateTabUrl(tabId: number, url: string): Promise<WebExtTab | undefined> {
  const tabs = getRawApi()?.tabs;
  if (!tabs) return undefined;
  return new Promise((resolve, reject) => {
    try {
      const maybe = tabs.update(tabId, { url, active: true });
      if (maybe && typeof (maybe as Promise<WebExtTab | undefined>).then === 'function') {
        (maybe as Promise<WebExtTab | undefined>).then(resolve, reject);
        return;
      }
    } catch {
      // callback path
    }
    tabs.update(tabId, { url, active: true }, (tab) => {
      const err = getRawApi()?.runtime?.lastError;
      if (err?.message) reject(new Error(err.message));
      else resolve(tab);
    });
  });
}

export async function sendTabMessage<T = unknown>(tabId: number, message: unknown): Promise<T> {
  const tabs = getRawApi()?.tabs;
  if (!tabs) throw new Error('TABS_API_UNAVAILABLE');
  return new Promise((resolve, reject) => {
    try {
      const maybe = tabs.sendMessage(tabId, message);
      if (maybe && typeof (maybe as Promise<unknown>).then === 'function') {
        (maybe as Promise<unknown>).then((v) => resolve(v as T), reject);
        return;
      }
    } catch {
      // callback path
    }
    tabs.sendMessage(tabId, message, (res) => {
      const err = getRawApi()?.runtime?.lastError;
      if (err?.message) reject(new Error(err.message));
      else resolve(res as T);
    });
  });
}

export async function captureVisibleTabPng(windowId?: number): Promise<string | undefined> {
  const tabs = getRawApi()?.tabs;
  if (!tabs?.captureVisibleTab) return undefined;
  return new Promise((resolve) => {
    try {
      const maybe = tabs.captureVisibleTab!(windowId, { format: 'png' });
      if (maybe && typeof (maybe as Promise<string>).then === 'function') {
        (maybe as Promise<string>).then(
          (url) => resolve(url),
          () => resolve(undefined),
        );
        return;
      }
    } catch {
      // callback fallback
    }
    try {
      tabs.captureVisibleTab!(windowId, { format: 'png' }, (dataUrl) => {
        if (getRawApi()?.runtime?.lastError?.message) resolve(undefined);
        else resolve(dataUrl || undefined);
      });
    } catch {
      resolve(undefined);
    }
  });
}
