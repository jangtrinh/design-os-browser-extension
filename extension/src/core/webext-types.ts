export interface WebExtStorageArea {
  get(keys?: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

export interface ChromeCallbackStorageArea {
  get(
    keys: string | string[] | Record<string, unknown> | null,
    callback: (items: Record<string, unknown>) => void,
  ): void;
  set(items: Record<string, unknown>, callback?: () => void): void;
  remove(keys: string | string[], callback?: () => void): void;
}

export interface WebExtTab {
  id?: number;
  url?: string;
  title?: string;
  active?: boolean;
  windowId?: number;
}

export interface WebExtMessageSender {
  tab?: WebExtTab;
  frameId?: number;
  id?: string;
  url?: string;
  origin?: string;
}

export interface WebExtAlarm {
  name: string;
  scheduledTime: number;
  periodInMinutes?: number;
}

export interface WebExtApi {
  runtime: {
    id?: string;
    lastError?: { message?: string };
    getManifest?: () => { version?: string; name?: string };
    getURL?: (path: string) => string;
    sendMessage?: (...args: unknown[]) => unknown;
    onMessage?: {
      addListener(
        cb: (
          message: unknown,
          sender: WebExtMessageSender,
          sendResponse: (response?: unknown) => void,
        ) => boolean | void | Promise<unknown>,
      ): void;
    };
    onInstalled?: { addListener(cb: () => void): void };
    onStartup?: { addListener(cb: () => void): void };
  };
  storage: {
    local: ChromeCallbackStorageArea | WebExtStorageArea;
    session?: ChromeCallbackStorageArea | WebExtStorageArea;
  };
  tabs?: {
    query(
      queryInfo: { active?: boolean; currentWindow?: boolean; url?: string | string[] },
      callback?: (tabs: WebExtTab[]) => void,
    ): Promise<WebExtTab[]> | void;
    get(tabId: number, callback?: (tab: WebExtTab) => void): Promise<WebExtTab> | void;
    update(
      tabId: number,
      updateProperties: { url?: string; active?: boolean },
      callback?: (tab?: WebExtTab) => void,
    ): Promise<WebExtTab> | void;
    create(
      createProperties: { url: string; active?: boolean },
      callback?: (tab: WebExtTab) => void,
    ): Promise<WebExtTab> | void;
    sendMessage(
      tabId: number,
      message: unknown,
      callback?: (response: unknown) => void,
    ): Promise<unknown> | void;
    captureVisibleTab?: (
      windowId?: number,
      options?: { format?: 'png' | 'jpeg' },
      callback?: (dataUrl: string) => void,
    ) => Promise<string> | void;
    onUpdated?: {
      addListener(
        cb: (tabId: number, changeInfo: { url?: string; status?: string }, tab: WebExtTab) => void,
      ): void;
    };
    onRemoved?: {
      addListener(cb: (tabId: number) => void): void;
    };
  };
  alarms?: {
    create(name: string, alarmInfo: { periodInMinutes?: number; delayInMinutes?: number }): void;
    onAlarm?: {
      addListener(cb: (alarm: WebExtAlarm) => void): void;
    };
  };
}
