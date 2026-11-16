import type {
  CopilotDraftKind,
  CopilotQueueItem,
  CopilotQueueStatus,
} from '../../../../shared/linkedin-schema.js';
import type { CallerOrigin, HumanGateState, PageFence } from '../../../../shared/rpc-envelope.js';
import type { KeyValueStore } from '../../core/webext-polyfill.js';

const COPILOT_QUEUE_STORAGE_KEY = 'design_os_linkedin_copilot_queue';

export interface ComposerPrefillOutcome {
  prefilled: boolean;
  sent: false;
  selectorMatched?: string;
  length: number;
  reason?: string;
}

const COMPOSER_SELECTORS = [
  '[data-test-composer-input]',
  '.msg-form__contenteditable[contenteditable="true"]',
  'div[role="textbox"][contenteditable="true"]',
  'textarea[name="message"]',
  'textarea[data-test="copilot-textarea"]',
];

/**
 * Safely fills a visible LinkedIn composer without EVER clicking Send/Submit.
 */
export function prefillVisibleComposer(
  doc: Document,
  body: string,
): ComposerPrefillOutcome {
  let targetEl: Element | null = null;
  let selectorMatched: string | undefined;

  for (const sel of COMPOSER_SELECTORS) {
    const found = doc.querySelector(sel);
    if (found && !found.hasAttribute('hidden') && found.getAttribute('aria-hidden') !== 'true') {
      targetEl = found;
      selectorMatched = sel;
      break;
    }
  }

  if (!targetEl) {
    return {
      prefilled: false,
      sent: false,
      length: 0,
      reason: 'No visible composer input found on current page; draft saved in Copilot Approval Queue only.',
    };
  }

  if (targetEl instanceof HTMLTextAreaElement || targetEl instanceof HTMLInputElement) {
    targetEl.focus();
    targetEl.value = body;
    targetEl.dispatchEvent(new Event('input', { bubbles: true }));
    targetEl.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    (targetEl as HTMLElement).focus();
    targetEl.textContent = body;
    targetEl.dispatchEvent(new Event('input', { bubbles: true }));
  }

  targetEl.setAttribute('data-design-os-prefilled', 'true');
  targetEl.setAttribute('data-copilot-awaiting-human-send', 'true');

  return {
    prefilled: true,
    sent: false,
    selectorMatched,
    length: body.length,
  };
}

function makeQueueId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `cp_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
  }
  return `cp_${Math.random().toString(36).slice(2, 12)}`;
}

export class CopilotQueueManager {
  private readonly store: KeyValueStore;

  constructor(store: KeyValueStore) {
    this.store = store;
  }

  async list(status?: CopilotQueueStatus): Promise<CopilotQueueItem[]> {
    const data = await this.store.get([COPILOT_QUEUE_STORAGE_KEY]);
    const raw = (data[COPILOT_QUEUE_STORAGE_KEY] as CopilotQueueItem[] | undefined) ?? [];
    if (!status) return raw;
    return raw.filter((item) => item.status === status);
  }

  async enqueue(input: {
    kind: CopilotDraftKind;
    target: string;
    targetUrl?: string;
    body: string;
    prefilled: boolean;
    fence?: PageFence;
    callerOrigin: CallerOrigin;
    note?: string;
  }): Promise<CopilotQueueItem> {
    const existing = await this.list();
    const now = new Date().toISOString();
    const item: CopilotQueueItem = {
      queueId: makeQueueId(),
      kind: input.kind,
      target: input.target,
      ...(input.targetUrl ? { targetUrl: input.targetUrl } : {}),
      body: input.body,
      status: input.prefilled ? 'prefilled' : 'pending',
      prefilled: input.prefilled,
      sent: false,
      createdBy: input.callerOrigin,
      ...(input.fence ? { fence: input.fence } : {}),
      createdAt: now,
      updatedAt: now,
      ...(input.note ? { note: input.note } : {}),
    };
    const next = [item, ...existing].slice(0, 200);
    await this.store.set({ [COPILOT_QUEUE_STORAGE_KEY]: next });
    return item;
  }

  async decide(input: {
    queueId: string;
    decision: 'approved' | 'rejected';
    callerOrigin: CallerOrigin;
    note?: string;
  }): Promise<
    | { ok: true; item: CopilotQueueItem }
    | { ok: false; humanGate: HumanGateState; code: string; message: string }
  > {
    if (input.callerOrigin !== 'extension-popup') {
      return {
        ok: false,
        humanGate: 'BLOCKED_POLICY',
        code: 'COPILOT_HUMAN_APPROVAL_REQUIRED',
        message:
          'Agent RPC callers cannot approve or reject their own Copilot queue items. Only a human clicking inside extension-popup may decide.',
      };
    }

    const items = await this.list();
    const idx = items.findIndex((entry) => entry.queueId === input.queueId);
    if (idx === -1) {
      return {
        ok: false,
        humanGate: 'CLEAR',
        code: 'COPILOT_QUEUE_ITEM_NOT_FOUND',
        message: `Queue item ${input.queueId} not found.`,
      };
    }

    const updated: CopilotQueueItem = {
      ...items[idx],
      status: input.decision,
      decidedBy: input.callerOrigin,
      updatedAt: new Date().toISOString(),
      ...(input.note ? { note: input.note } : {}),
    };
    items[idx] = updated;
    await this.store.set({ [COPILOT_QUEUE_STORAGE_KEY]: items });
    return { ok: true, item: updated };
  }
}
