/**
 * Passive MAIN-world response observer loaded at `document_start`.
 * Captures native bindings before page scripts load, never initiates synthetic requests,
 * and never hardcodes GraphQL `queryId` hashes.
 */
(() => {
  const globalAny = window as unknown as Record<string, unknown>;
  if (globalAny.__DESIGN_OS_PASSIVE_OBSERVER_INSTALLED__) {
    return;
  }
  globalAny.__DESIGN_OS_PASSIVE_OBSERVER_INSTALLED__ = true;

  const nativePostMessage = window.postMessage.bind(window);
  const hasOwn = Object.prototype.hasOwnProperty;
  const nativeFetch = window.fetch.bind(window);
  const nativeClone = Response.prototype.clone;

  function isVoyagerApiUrl(rawUrl: string): boolean {
    return rawUrl.includes('/voyager/api/') || rawUrl.includes('/api/voyager/');
  }

  function extractEntitiesFromPayload(payload: unknown): Record<string, unknown>[] {
    if (!payload || typeof payload !== 'object') return [];
    const obj = payload as Record<string, unknown>;
    const entities: Record<string, unknown>[] = [];

    if (hasOwn.call(obj, 'included') && Array.isArray(obj.included)) {
      for (const item of obj.included) {
        if (item && typeof item === 'object') {
          entities.push(item as Record<string, unknown>);
        }
      }
    }

    if (hasOwn.call(obj, 'elements') && Array.isArray(obj.elements)) {
      for (const item of obj.elements) {
        if (item && typeof item === 'object') {
          entities.push(item as Record<string, unknown>);
        }
      }
    }

    if (hasOwn.call(obj, 'data') && obj.data && typeof obj.data === 'object') {
      const dataObj = obj.data as Record<string, unknown>;
      if (hasOwn.call(dataObj, 'included') && Array.isArray(dataObj.included)) {
        for (const item of dataObj.included) {
          if (item && typeof item === 'object') {
            entities.push(item as Record<string, unknown>);
          }
        }
      } else {
        entities.push(dataObj);
      }
    }

    return entities;
  }

  function emitPassiveTap(url: string, status: number, payload: unknown): void {
    try {
      const entities = extractEntitiesFromPayload(payload);
      const safeEntities = JSON.parse(JSON.stringify(entities.slice(0, 200)));
      nativePostMessage(
        {
          __designOsPassiveTap: true,
          url,
          status,
          entities: safeEntities,
          timestamp: Date.now(),
        },
        window.location.origin,
      );
    } catch {
      // Ignore cross-origin or unserializable passive payloads cleanly
    }
  }

  window.fetch = function wrappedFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const reqUrl =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;

    const promise = nativeFetch(input, init);
    if (typeof reqUrl === 'string' && isVoyagerApiUrl(reqUrl)) {
      promise
        .then((response) => {
          try {
            const status = response.status;
            if (status === 429 || status === 451) {
              emitPassiveTap(reqUrl, status, {});
              return;
            }
            const contentType = response.headers.get('content-type') ?? '';
            if (!contentType.includes('json') && !reqUrl.includes('voyager')) {
              return;
            }
            const cloned = nativeClone.call(response);
            void cloned
              .json()
              .then((json) => emitPassiveTap(reqUrl, status, json))
              .catch(() => {});
          } catch {
            // Never disrupt the host page's fetch lifecycle
          }
        })
        .catch(() => {});
    }
    return promise;
  };

  const nativeXhrOpen = XMLHttpRequest.prototype.open;
  const nativeXhrSend = XMLHttpRequest.prototype.send;
  const xhrUrls = new WeakMap<XMLHttpRequest, string>();

  XMLHttpRequest.prototype.open = function wrappedOpen(
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ): void {
    const urlStr = typeof url === 'string' ? url : url.href;
    xhrUrls.set(this, urlStr);
    return (nativeXhrOpen as (...args: unknown[]) => void).apply(this, [method, url, ...rest]);
  };

  XMLHttpRequest.prototype.send = function wrappedSend(
    body?: Document | XMLHttpRequestBodyInit | null,
  ): void {
    const reqUrl = xhrUrls.get(this) ?? '';
    if (isVoyagerApiUrl(reqUrl)) {
      this.addEventListener(
        'load',
        () => {
          try {
            const status = this.status;
            if (status === 429 || status === 451) {
              emitPassiveTap(reqUrl, status, {});
              return;
            }
            if (typeof this.responseText === 'string' && this.responseText.trim().startsWith('{')) {
              const json = JSON.parse(this.responseText) as unknown;
              emitPassiveTap(reqUrl, status, json);
            }
          } catch {
            // Passive tap must never throw into host XHR handlers
          }
        },
        { once: true },
      );
    }
    return nativeXhrSend.call(this, body);
  };
})();
