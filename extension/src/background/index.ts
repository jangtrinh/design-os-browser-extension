import { buildCapabilities, type CapabilityTier } from '../../../shared/capability-tier.js';
import type { RpcRequest } from '../../../shared/rpc-envelope.js';
import { getLocalStore, getRuntimeApi, getSessionStore, hasSessionStorage } from '../core/webext-polyfill.js';
import { WsBridgeClient } from '../core/ws-bridge-client.js';
import { ExtensionEngine } from './engine.js';

function detectCapabilityTier(): { tier: CapabilityTier; browserName: string } {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (ua.includes('Firefox/')) {
    return { tier: 'tier2-firefox', browserName: 'firefox' };
  }
  return { tier: 'tier1-chromium', browserName: 'chromium' };
}

const { tier, browserName } = detectCapabilityTier();
const capabilities = buildCapabilities({
  tier,
  browserName,
  passiveMainObserver: true,
  sessionStorageFence: hasSessionStorage(),
  adapterIds: ['linkedin-zero-drift'],
});

const localStore = getLocalStore();
const sessionStore = getSessionStore();

let bridgeClient: WsBridgeClient | null = null;

const engine = new ExtensionEngine({
  capabilities,
  sessionStore,
  localStore,
  onHumanGateBlocked(state, reason, url) {
    bridgeClient?.sendEvent('human_gate_blocked', { state, reason, url });
  },
});

const api = getRuntimeApi();
const version = api?.runtime?.getManifest?.().version ?? '0.2.0';

bridgeClient = new WsBridgeClient({
  store: localStore,
  capabilities,
  extensionVersion: version,
  onRpcRequest: (req) => engine.handleRpc(req, 'agent-rpc'),
});

void bridgeClient.start();

// Service Worker / Event Page alarm backup revives WS connection after browser idle/sleep.
api?.alarms?.create('design_os_ws_keepalive', { periodInMinutes: 0.5 });
api?.alarms?.onAlarm?.addListener((alarm) => {
  if (alarm.name === 'design_os_ws_keepalive') {
    bridgeClient?.connect();
  }
});

api?.runtime?.onInstalled?.addListener(() => {
  bridgeClient?.connect();
});
api?.runtime?.onStartup?.addListener(() => {
  bridgeClient?.connect();
});

api?.tabs?.onUpdated?.addListener((tabId, changeInfo) => {
  if (changeInfo.url) {
    void engine.epochStore.mintNavigation(tabId, changeInfo.url);
  }
});

api?.tabs?.onRemoved?.addListener((tabId) => {
  void engine.epochStore.clearTab(tabId);
});

api?.runtime?.onMessage?.addListener((rawMsg, _sender, sendResponse) => {
  const msg = rawMsg as Record<string, unknown> | null;
  if (!msg) return;

  if (msg.__designOsContentEvent === true && msg.event === 'human_gate_signal') {
    engine.recordExternalHumanGateSignal(Number(msg.status ?? 429), String(msg.url ?? ''));
    sendResponse({ ok: true });
    return;
  }

  if (msg.__designOsPopupCmd === true) {
    void (async () => {
      const cmd = String(msg.cmd ?? '');
      if (cmd === 'get_state') {
        const statusRes = await engine.handleRpc(
          { id: 'popup_status', action: 'linkedin.status', params: {} },
          'extension-popup',
        );
        const queueRes = await engine.handleRpc(
          { id: 'popup_queue', action: 'linkedin.queue.list', params: {} },
          'extension-popup',
        );
        const config = await bridgeClient?.loadConfig();
        sendResponse({
          ok: true,
          bridge: bridgeClient?.getStatus(),
          config: {
            brokerUrl: config?.brokerUrl ?? '',
            hasToken: Boolean(config?.pairingToken),
          },
          capabilities,
          status: statusRes.data ?? null,
          humanGate: statusRes.humanGate ?? 'CLEAR',
          statusError: statusRes.error ?? null,
          queue: (queueRes.data as { items?: unknown[] } | undefined)?.items ?? [],
          actApprovals: engine.actApprovals.list(),
        });
        return;
      }

      if (cmd === 'save_config') {
        const saved = await bridgeClient?.saveConfig({
          brokerUrl: typeof msg.brokerUrl === 'string' ? msg.brokerUrl : undefined,
          pairingToken: typeof msg.pairingToken === 'string' ? msg.pairingToken : undefined,
        });
        sendResponse({ ok: true, config: saved, bridge: bridgeClient?.getStatus() });
        return;
      }

      if (cmd === 'reconnect') {
        await bridgeClient?.reconnectNow();
        sendResponse({ ok: true, bridge: bridgeClient?.getStatus() });
        return;
      }

      if (cmd === 'decide_queue') {
        const rpc: RpcRequest = {
          id: `popup_decide_${Date.now()}`,
          action: 'linkedin.queue.decide',
          params: {
            queueId: String(msg.queueId ?? ''),
            decision: msg.decision === 'rejected' ? 'rejected' : 'approved',
            note: typeof msg.note === 'string' ? msg.note : undefined,
          },
        };
        // Only the trusted popup message handler supplies 'extension-popup'.
        const out = await engine.handleRpc(rpc, 'extension-popup');
        sendResponse(out);
        return;
      }

      if (cmd === 'decide_act') {
        // Human decision on a write browser.act; only this popup path supplies 'extension-popup'.
        const out = await engine.handleRpc(
          {
            id: `popup_act_${Date.now()}`,
            action: 'browser.act.decide',
            params: { approvalId: String(msg.approvalId ?? ''), decision: msg.decision === 'approved' ? 'approved' : 'rejected' },
          },
          'extension-popup',
        );
        sendResponse(out);
        return;
      }

      sendResponse({ ok: false, error: `Unknown popup command: ${cmd}` });
    })();
    return true;
  }
});
