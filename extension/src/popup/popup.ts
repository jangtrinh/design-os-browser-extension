import type { CopilotQueueItem, LinkedInStatusReport } from '../../../shared/linkedin-schema.js';
import type { EngineCapabilities } from '../../../shared/capability-tier.js';
import type { HumanGateState } from '../../../shared/rpc-envelope.js';
import type { ActApproval } from '../core/act-approvals.js';
import { getRuntimeApi } from '../core/webext-polyfill.js';
import { renderActApprovals } from './act-approvals-view.js';
import { renderAccountGuards, type SyncedGuardItem } from './guard-view.js';

interface PopupStateResponse {
  ok: boolean;
  bridge?: {
    connected: boolean;
    brokerUrl: string;
    hasToken: boolean;
    lastError?: string;
  };
  config?: {
    brokerUrl: string;
    hasToken: boolean;
  };
  capabilities?: EngineCapabilities;
  status?: LinkedInStatusReport | null;
  humanGate?: HumanGateState;
  statusError?: { code?: string; message?: string } | null;
  queue?: CopilotQueueItem[];
  actApprovals?: ActApproval[];
  accountGuards?: SyncedGuardItem[];
}

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing popup element #${id}`);
  return node as T;
}

function sendPopupCommand<T>(payload: Record<string, unknown>): Promise<T> {
  const api = getRuntimeApi();
  if (!api?.runtime?.sendMessage) {
    return Promise.reject(new Error('Extension runtime unavailable'));
  }
  return new Promise((resolve, reject) => {
    try {
      const maybe = api.runtime.sendMessage?.({ __designOsPopupCmd: true, ...payload }, (res: unknown) => {
        const err = api.runtime.lastError;
        if (err?.message) reject(new Error(err.message));
        else resolve(res as T);
      });
      if (maybe && typeof (maybe as Promise<unknown>).then === 'function') {
        (maybe as Promise<unknown>).then((v) => resolve(v as T), reject);
      }
    } catch (err) {
      reject(err);
    }
  });
}

function renderState(res: PopupStateResponse): void {
  const pill = el<HTMLSpanElement>('bridge-status-pill');
  const pillText = el<HTMLSpanElement>('bridge-status-text');
  const gateAlert = el<HTMLElement>('human-gate-alert');
  const gateCode = el<HTMLElement>('gate-alert-code');
  const gateReason = el<HTMLParagraphElement>('gate-alert-reason');

  const humanGate = res.status?.humanGate ?? res.humanGate ?? 'CLEAR';
  if (humanGate !== 'CLEAR') {
    gateAlert.hidden = false;
    gateCode.textContent = humanGate;
    gateReason.textContent =
      res.status?.humanGateReason ?? res.statusError?.message ?? 'Human resolution required in browser tab.';
    pill.className = 'pill pill-blocked';
    pillText.textContent = humanGate;
  } else if (res.bridge?.connected) {
    gateAlert.hidden = true;
    pill.className = 'pill pill-ok';
    pillText.textContent = 'Broker Online';
  } else {
    gateAlert.hidden = true;
    pill.className = 'pill pill-warn';
    pillText.textContent = res.config?.hasToken ? 'Reconnecting' : 'Unpaired';
  }

  el<HTMLSpanElement>('tier-label').textContent = res.capabilities?.tier ?? 'tier1-chromium';
  el<HTMLElement>('metric-epoch').textContent = String(res.status?.fence?.epoch ?? 0);
  el<HTMLElement>('metric-passive').textContent = String(res.status?.pacing.passiveCapturedCount ?? 0);
  el<HTMLElement>('metric-reads').textContent = res.status
    ? `${res.status.pacing.readsLastHour} / ${res.status.pacing.readsHourLimit}`
    : '0 / 120';
  el<HTMLElement>('metric-prefills').textContent = res.status
    ? `${res.status.pacing.prefillsLastHour} / ${res.status.pacing.prefillsHourLimit}`
    : '0 / 30';

  el<HTMLParagraphElement>('active-url').textContent =
    res.status?.activeUrl || res.bridge?.lastError || 'Open a LinkedIn tab to inspect.';

  const brokerInput = el<HTMLInputElement>('broker-url-input');
  if (res.config?.brokerUrl && document.activeElement !== brokerInput) {
    brokerInput.value = res.config.brokerUrl;
  }

  renderAccountGuards(res.accountGuards ?? [], (site) => {
    void sendPopupCommand({ cmd: 'resolve_guard', site }).then(() => refreshState());
  });

  renderActApprovals(res.actApprovals ?? [], (approvalId, decision) => {
    void sendPopupCommand({ cmd: 'decide_act', approvalId, decision }).then(() => refreshState());
  });

  const queue = res.queue ?? [];
  const actionable = queue.filter((q) => q.status === 'pending' || q.status === 'prefilled');
  el<HTMLSpanElement>('queue-count').textContent = String(actionable.length);

  const emptyNode = el<HTMLDivElement>('queue-empty');
  const listNode = el<HTMLUListElement>('queue-list');
  listNode.textContent = '';

  if (queue.length === 0) {
    emptyNode.hidden = false;
  } else {
    emptyNode.hidden = true;
    for (const item of queue.slice(0, 8)) {
      const li = document.createElement('li');
      li.className = 'queue-item';

      const meta = document.createElement('div');
      meta.className = 'queue-meta';
      const targetSpan = document.createElement('span');
      targetSpan.className = 'queue-target';
      targetSpan.textContent = `${item.kind} -> ${item.target}`;
      const statusSpan = document.createElement('span');
      statusSpan.className = 'meta-tag';
      statusSpan.textContent = item.status;
      meta.append(targetSpan, statusSpan);

      const bodyP = document.createElement('p');
      bodyP.className = 'queue-body';
      bodyP.textContent = item.body;

      li.append(meta, bodyP);

      if (item.status === 'pending' || item.status === 'prefilled') {
        const actions = document.createElement('div');
        actions.className = 'queue-actions';

        const approveBtn = document.createElement('button');
        approveBtn.type = 'button';
        approveBtn.className = 'btn btn-secondary';
        approveBtn.textContent = 'Mark Ready (Human)';
        approveBtn.addEventListener('click', () => {
          void decideItem(item.queueId, 'approved');
        });

        const rejectBtn = document.createElement('button');
        rejectBtn.type = 'button';
        rejectBtn.className = 'btn btn-danger';
        rejectBtn.textContent = 'Discard';
        rejectBtn.addEventListener('click', () => {
          void decideItem(item.queueId, 'rejected');
        });

        actions.append(approveBtn, rejectBtn);
        li.append(actions);
      }

      listNode.append(li);
    }
  }
}

async function decideItem(queueId: string, decision: 'approved' | 'rejected'): Promise<void> {
  await sendPopupCommand({ cmd: 'decide_queue', queueId, decision });
  await refreshState();
}

async function refreshState(): Promise<void> {
  try {
    const res = await sendPopupCommand<PopupStateResponse>({ cmd: 'get_state' });
    renderState(res);
  } catch (err) {
    el<HTMLSpanElement>('bridge-status-text').textContent = 'Offline';
    el<HTMLParagraphElement>('active-url').textContent =
      err instanceof Error ? err.message : String(err);
  }
}

el<HTMLButtonElement>('refresh-btn').addEventListener('click', () => {
  void refreshState();
});

el<HTMLFormElement>('pairing-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const brokerUrl = el<HTMLInputElement>('broker-url-input').value.trim();
  const pairingToken = el<HTMLInputElement>('pairing-token-input').value.trim();
  const feedback = el<HTMLParagraphElement>('form-feedback');

  void (async () => {
    try {
      await sendPopupCommand({ cmd: 'save_config', brokerUrl, pairingToken });
      feedback.textContent = 'Saved pairing config. Reconnecting to broker.';
      await new Promise((r) => setTimeout(r, 350));
      await refreshState();
    } catch (err) {
      feedback.textContent = err instanceof Error ? err.message : String(err);
    }
  })();
});

void refreshState();
