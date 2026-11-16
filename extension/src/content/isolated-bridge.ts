import {
  prefillVisibleComposer,
  type ComposerPrefillOutcome,
} from '../adapters/linkedin/copilot-composer.js';
import { readAnalytics, readComments } from '../adapters/linkedin/aria-analytics.js';
import { readFeed, readPost, readProfile, readSearch } from '../adapters/linkedin/aria-readers.js';
import { collectAxNodes } from '../adapters/linkedin/ax-collector.js';
import {
  extractCompanyFromDocument,
  extractInboxListFromDocument,
  extractInboxThreadFromDocument,
  extractJobFromDocument,
} from '../adapters/linkedin/dom-extractors.js';
import {
  createPassiveEntityStore,
  ingestPassiveTap,
} from '../adapters/linkedin/entity-normalizer.js';
import type { LinkedInSearchCategory } from '../../../shared/linkedin-schema.js';
import type { PageFence } from '../../../shared/rpc-envelope.js';
import { buildCompactDomSnapshot } from '../core/dom-snapshot.js';
import { scanDocumentHumanGate } from '../core/human-gate-detector.js';
import { getRuntimeApi } from '../core/webext-polyfill.js';

interface IsolatedActionMessage {
  __designOsIsolatedRpc?: true;
  op:
    | 'inspect_gate'
    | 'observe'
    | 'click_ref'
    | 'fill_ref'
    | 'linkedin.profile.get'
    | 'linkedin.post.get'
    | 'linkedin.company.get'
    | 'linkedin.job.get'
    | 'linkedin.inbox.list'
    | 'linkedin.inbox.thread'
    | 'linkedin.search'
    | 'linkedin.feed.read'
    | 'linkedin.analytics.read'
    | 'linkedin.comments.read'
    | 'linkedin.composer.prefill'
    | 'passive_stats';
  fence?: PageFence;
  params?: Record<string, unknown>;
}

const passiveStore = createPassiveEntityStore();
let lastRefMap = new Map<number, Element>();
let lastRefEpoch = -1;

window.addEventListener('message', (event: MessageEvent) => {
  if (event.source !== window) return;
  if (event.origin !== window.location.origin) return;
  const data = event.data as Record<string, unknown> | null;
  if (!data || data.__designOsPassiveTap !== true) return;

  const status = typeof data.status === 'number' ? data.status : undefined;
  const entities = Array.isArray(data.entities)
    ? (data.entities as Record<string, unknown>[])
    : [];
  ingestPassiveTap(passiveStore, { status, entities });

  if (status === 429 || status === 451) {
    try {
      const api = getRuntimeApi();
      api?.runtime?.sendMessage?.({
        __designOsContentEvent: true,
        event: 'human_gate_signal',
        status,
        url: window.location.href,
      });
    } catch {
      // Ignore transient worker wake failures
    }
  }
});

function currentGate(): ReturnType<typeof scanDocumentHumanGate> {
  return scanDocumentHumanGate(document, window.location.href, passiveStore.recentStatuses);
}

function handleIsolatedRpc(msg: IsolatedActionMessage): Record<string, unknown> {
  const url = window.location.href;
  const gate = currentGate();

  if (msg.op === 'passive_stats') {
    return {
      ok: true,
      passiveCapturedCount: passiveStore.totalEntitiesIngested,
      recentStatuses: [...passiveStore.recentStatuses],
      humanGate: gate.state,
      ...(gate.reason ? { humanGateReason: gate.reason } : {}),
    };
  }

  if (msg.op === 'inspect_gate') {
    return {
      ok: true,
      url,
      title: document.title,
      gate,
      passiveCapturedCount: passiveStore.totalEntitiesIngested,
    };
  }

  if (gate.state !== 'CLEAR') {
    return {
      ok: false,
      outcome: 'BLOCKED',
      humanGate: gate.state,
      error: {
        code: gate.state,
        message: gate.reason ?? 'Human gate active on page.',
        humanGate: gate.state,
        retryable: false,
      },
    };
  }

  if (msg.op === 'observe') {
    const fence: PageFence = msg.fence ?? { tabId: 0, pageId: 'untracked', epoch: 0, leaseId: 'none' };
    const maxNodes = typeof msg.params?.maxNodes === 'number' ? msg.params.maxNodes : undefined;
    const { snapshot, refMap } = buildCompactDomSnapshot(document, fence, gate, maxNodes);
    lastRefMap = refMap;
    lastRefEpoch = fence.epoch;
    return {
      ok: true,
      outcome: 'COMMITTED',
      data: snapshot,
      passiveCapturedCount: passiveStore.totalEntitiesIngested,
    };
  }

  if (msg.op === 'click_ref' || msg.op === 'fill_ref') {
    const ref = typeof msg.params?.ref === 'number' ? msg.params.ref : -1;
    if (msg.fence && lastRefEpoch !== msg.fence.epoch) {
      return {
        ok: false,
        outcome: 'REJECTED_STALE',
        error: {
          code: 'BROWSER_REF_STALE',
          message: `Snapshot ref=${ref} belongs to stale epoch ${lastRefEpoch} (current ${msg.fence.epoch}). Re-observe first.`,
          retryable: false,
        },
      };
    }
    const target = lastRefMap.get(ref);
    if (!target || !target.isConnected) {
      return {
        ok: false,
        outcome: 'REJECTED_STALE',
        error: {
          code: 'BROWSER_REF_MISSING',
          message: `Element ref=${ref} is no longer connected to DOM.`,
          retryable: false,
        },
      };
    }

    if (msg.op === 'click_ref') {
      (target as HTMLElement).click();
      return { ok: true, outcome: 'COMMITTED', data: { clickedRef: ref } };
    }

    const value = typeof msg.params?.value === 'string' ? msg.params.value : '';
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      target.focus();
      target.value = value;
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      (target as HTMLElement).focus();
      target.textContent = value;
      target.dispatchEvent(new Event('input', { bubbles: true }));
    }
    return { ok: true, outcome: 'COMMITTED', data: { filledRef: ref, length: value.length } };
  }

  if (msg.op === 'linkedin.composer.prefill') {
    const body = typeof msg.params?.body === 'string' ? msg.params.body : '';
    const res: ComposerPrefillOutcome = prefillVisibleComposer(document, body);
    return {
      ok: true,
      outcome: res.prefilled ? 'QUEUED_COPILOT' : 'COMMITTED',
      data: res,
      passiveCapturedCount: passiveStore.totalEntitiesIngested,
    };
  }

  if (msg.op === 'linkedin.profile.get') {
    const id = typeof msg.params?.publicId === 'string' ? msg.params.publicId : undefined;
    return {
      ok: true,
      outcome: 'COMMITTED',
      data: readProfile(collectAxNodes(document), url, id),
      passiveCapturedCount: passiveStore.totalEntitiesIngested,
    };
  }

  if (msg.op === 'linkedin.post.get') {
    const urn = typeof msg.params?.postUrn === 'string' ? msg.params.postUrn : undefined;
    return {
      ok: true,
      outcome: 'COMMITTED',
      data: readPost(collectAxNodes(document), url, urn),
      passiveCapturedCount: passiveStore.totalEntitiesIngested,
    };
  }

  if (msg.op === 'linkedin.company.get') {
    const slug = typeof msg.params?.slug === 'string' ? msg.params.slug : undefined;
    return {
      ok: true,
      outcome: 'COMMITTED',
      data: extractCompanyFromDocument(document, url, passiveStore, slug),
      passiveCapturedCount: passiveStore.totalEntitiesIngested,
    };
  }

  if (msg.op === 'linkedin.job.get') {
    const jobId = typeof msg.params?.jobId === 'string' ? msg.params.jobId : undefined;
    return {
      ok: true,
      outcome: 'COMMITTED',
      data: extractJobFromDocument(document, url, passiveStore, jobId),
      passiveCapturedCount: passiveStore.totalEntitiesIngested,
    };
  }

  if (msg.op === 'linkedin.search') {
    const category =
      (typeof msg.params?.category === 'string' ? msg.params.category : 'people') as LinkedInSearchCategory;
    const query = typeof msg.params?.query === 'string' ? msg.params.query : '';
    return {
      ok: true,
      outcome: 'COMMITTED',
      data: readSearch(collectAxNodes(document), url, category, query),
      passiveCapturedCount: passiveStore.totalEntitiesIngested,
    };
  }

  if (msg.op === 'linkedin.inbox.list') {
    return {
      ok: true,
      outcome: 'COMMITTED',
      data: extractInboxListFromDocument(document, url, passiveStore),
      passiveCapturedCount: passiveStore.totalEntitiesIngested,
    };
  }

  if (msg.op === 'linkedin.inbox.thread') {
    const threadId = typeof msg.params?.threadId === 'string' ? msg.params.threadId : undefined;
    return {
      ok: true,
      outcome: 'COMMITTED',
      data: extractInboxThreadFromDocument(document, url, passiveStore, threadId),
      passiveCapturedCount: passiveStore.totalEntitiesIngested,
    };
  }

  if (msg.op === 'linkedin.feed.read') {
    return {
      ok: true,
      outcome: 'COMMITTED',
      data: readFeed(collectAxNodes(document), url),
      passiveCapturedCount: passiveStore.totalEntitiesIngested,
    };
  }

  if (msg.op === 'linkedin.analytics.read') {
    return { ok: true, outcome: 'COMMITTED', data: readAnalytics(collectAxNodes(document), url) };
  }

  if (msg.op === 'linkedin.comments.read') {
    const urn = typeof msg.params?.postUrn === 'string' ? msg.params.postUrn : undefined;
    return { ok: true, outcome: 'COMMITTED', data: readComments(collectAxNodes(document), url, urn) };
  }

  return {
    ok: false,
    outcome: 'BLOCKED',
    error: { code: 'UNKNOWN_ISOLATED_OP', message: `Unsupported op: ${String(msg.op)}` },
  };
}

const runtimeApi = getRuntimeApi();
runtimeApi?.runtime?.onMessage?.addListener((rawMessage, _sender, sendResponse) => {
  const msg = rawMessage as IsolatedActionMessage | null;
  if (!msg || msg.__designOsIsolatedRpc !== true) {
    return;
  }
  try {
    sendResponse(handleIsolatedRpc(msg));
  } catch (err) {
    sendResponse({
      ok: false,
      outcome: 'BLOCKED',
      error: {
        code: 'ISOLATED_EXTRACTION_ERROR',
        message: err instanceof Error ? err.message : String(err),
      },
    });
  }
  return true;
});
