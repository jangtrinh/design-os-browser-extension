/**
 * MAIN-world rate-limit sentinel loaded at `document_start`.
 *
 * Until v0.2.0 this script cloned `/voyager/api/` JSON responses and normalized their
 * `included[]` entities. The 2026-11-16 live pilot showed it captured 0 entities on every
 * page: LinkedIn now serves profile, feed, post, search and analytics pages through
 * server-driven UI (`isSdui=true`), not Voyager JSON. Reading data now happens in the
 * ISOLATED world from the accessibility tree (`aria-readers.ts`).
 *
 * What remains is the one signal the tap still gave for free: HTTP 429/451 on the page's
 * own same-origin requests, which must flip the Human Gate. The sentinel never reads
 * response bodies, never initiates requests and never hardcodes endpoints or query hashes.
 */
(() => {
  const globalAny = window as unknown as Record<string, unknown>;
  if (globalAny.__DESIGN_OS_PASSIVE_OBSERVER_INSTALLED__) {
    return;
  }
  globalAny.__DESIGN_OS_PASSIVE_OBSERVER_INSTALLED__ = true;

  const nativePostMessage = window.postMessage.bind(window);
  const nativeFetch = window.fetch.bind(window);
  const GATE_STATUSES = new Set([429, 451]);

  function isSameOrigin(rawUrl: string): boolean {
    try {
      return new URL(rawUrl, window.location.href).origin === window.location.origin;
    } catch {
      return false;
    }
  }

  function emitStatus(url: string, status: number): void {
    if (!GATE_STATUSES.has(status) || !isSameOrigin(url)) return;
    try {
      nativePostMessage(
        { __designOsPassiveTap: true, url, status, entities: [], timestamp: Date.now() },
        window.location.origin,
      );
    } catch {
      // Never disrupt the host page
    }
  }

  window.fetch = function wrappedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const reqUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const promise = nativeFetch(input, init);
    promise.then((response) => emitStatus(reqUrl, response.status)).catch(() => {});
    return promise;
  };

  const nativeXhrOpen = XMLHttpRequest.prototype.open;
  const nativeXhrSend = XMLHttpRequest.prototype.send;
  const xhrUrls = new WeakMap<XMLHttpRequest, string>();

  XMLHttpRequest.prototype.open = function wrappedOpen(method: string, url: string | URL, ...rest: unknown[]): void {
    xhrUrls.set(this, typeof url === 'string' ? url : url.href);
    return (nativeXhrOpen as (...args: unknown[]) => void).apply(this, [method, url, ...rest]);
  };

  XMLHttpRequest.prototype.send = function wrappedSend(body?: Document | XMLHttpRequestBodyInit | null): void {
    const reqUrl = xhrUrls.get(this) ?? '';
    this.addEventListener('loadend', () => emitStatus(reqUrl, this.status), { once: true });
    return nativeXhrSend.call(this, body);
  };
})();
