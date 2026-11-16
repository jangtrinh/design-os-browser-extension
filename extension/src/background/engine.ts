import type {
  CopilotDraftKind,
  CopilotQueueStatus,
  LinkedInSearchCategory,
  LinkedInStatusReport,
  PacingSnapshot,
} from '../../../shared/linkedin-schema.js';
import type { EngineCapabilities } from '../../../shared/capability-tier.js';
import type {
  CallerOrigin,
  HumanGateState,
  PageFence,
  RpcRequest,
  RpcResponse,
} from '../../../shared/rpc-envelope.js';
import { CopilotQueueManager } from '../adapters/linkedin/copilot-composer.js';
import { detectHumanGate } from '../core/human-gate-detector.js';
import { PageEpochStore } from '../core/page-epoch-store.js';
import {
  getLocalStore,
  getSessionStore,
  sendTabMessage,
  type KeyValueStore,
} from '../core/webext-polyfill.js';
import { navigateAndWait, resolveTargetTab } from './tab-router.js';

export interface EngineDeps {
  capabilities: EngineCapabilities;
  sessionStore?: KeyValueStore;
  localStore?: KeyValueStore;
  onHumanGateBlocked?: (state: HumanGateState, reason: string, url: string) => void;
}

const READS_HOUR_LIMIT = 120;
const PREFILLS_HOUR_LIMIT = 30;
const ONE_HOUR_MS = 3_600_000;

interface IsolatedReply {
  ok: boolean;
  outcome?: RpcResponse['outcome'];
  humanGate?: HumanGateState;
  humanGateReason?: string;
  data?: unknown;
  passiveCapturedCount?: number;
  gate?: { state: HumanGateState; reason?: string };
  url?: string;
  error?: RpcResponse['error'];
}

export class ExtensionEngine {
  readonly capabilities: EngineCapabilities;
  readonly epochStore: PageEpochStore;
  readonly copilotQueue: CopilotQueueManager;
  private readonly onHumanGateBlocked?: (state: HumanGateState, reason: string, url: string) => void;

  private readTimestamps: number[] = [];
  private prefillTimestamps: number[] = [];
  private passiveCapturedCount = 0;
  private lastActionAt: string | undefined;
  private lastHumanGate: { state: HumanGateState; reason?: string; url?: string } = { state: 'CLEAR' };

  constructor(deps: EngineDeps) {
    this.capabilities = deps.capabilities;
    this.epochStore = new PageEpochStore(deps.sessionStore ?? getSessionStore());
    this.copilotQueue = new CopilotQueueManager(deps.localStore ?? getLocalStore());
    this.onHumanGateBlocked = deps.onHumanGateBlocked;
  }

  recordPassiveCount(count: number | undefined): void {
    if (typeof count === 'number' && count > this.passiveCapturedCount) {
      this.passiveCapturedCount = count;
    }
  }

  recordExternalHumanGateSignal(status: number, url: string): void {
    const check = detectHumanGate({ url, statusCodes: [status] });
    if (check.state !== 'CLEAR') {
      this.lastHumanGate = { state: check.state, reason: check.reason, url };
      this.onHumanGateBlocked?.(check.state, check.reason ?? 'Blocked', url);
    }
  }

  getPacingSnapshot(): PacingSnapshot {
    const cutoff = Date.now() - ONE_HOUR_MS;
    this.readTimestamps = this.readTimestamps.filter((t) => t >= cutoff);
    this.prefillTimestamps = this.prefillTimestamps.filter((t) => t >= cutoff);
    return {
      readsLastHour: this.readTimestamps.length,
      readsHourLimit: READS_HOUR_LIMIT,
      prefillsLastHour: this.prefillTimestamps.length,
      prefillsHourLimit: PREFILLS_HOUR_LIMIT,
      passiveCapturedCount: this.passiveCapturedCount,
      ...(this.lastActionAt ? { lastActionAt: this.lastActionAt } : {}),
    };
  }

  private bumpRead(): boolean {
    const snap = this.getPacingSnapshot();
    if (snap.readsLastHour >= READS_HOUR_LIMIT) return false;
    this.readTimestamps.push(Date.now());
    this.lastActionAt = new Date().toISOString();
    return true;
  }

  private bumpPrefill(): boolean {
    const snap = this.getPacingSnapshot();
    if (snap.prefillsLastHour >= PREFILLS_HOUR_LIMIT) return false;
    this.prefillTimestamps.push(Date.now());
    this.lastActionAt = new Date().toISOString();
    return true;
  }

  private blockedResponse(
    id: string,
    state: HumanGateState,
    code: string,
    message: string,
    fence?: PageFence,
  ): RpcResponse {
    return {
      id,
      ok: false,
      outcome: 'BLOCKED',
      humanGate: state,
      ...(fence ? { fence } : {}),
      error: { code, message, humanGate: state, retryable: false },
    };
  }

  async handleRpc(req: RpcRequest, trustedOrigin: CallerOrigin = 'agent-rpc'): Promise<RpcResponse> {
    const action = req.action;

    if (action === 'browser.capabilities') {
      return {
        id: req.id,
        ok: true,
        outcome: 'COMMITTED',
        humanGate: this.lastHumanGate.state,
        data: this.capabilities,
      };
    }

    if (action === 'linkedin.queue.list') {
      const status = typeof req.params?.status === 'string'
        ? (req.params.status as CopilotQueueStatus)
        : undefined;
      const items = await this.copilotQueue.list(status);
      return {
        id: req.id,
        ok: true,
        outcome: 'COMMITTED',
        humanGate: this.lastHumanGate.state,
        data: { items, total: items.length },
      };
    }

    if (action === 'linkedin.queue.decide') {
      const queueId = String(req.params?.queueId ?? '');
      const decision = req.params?.decision === 'rejected' ? 'rejected' : 'approved';
      const note = typeof req.params?.note === 'string' ? req.params.note : undefined;
      // Only trusted popup callers may approve or reject; agent-rpc requests are refused.
      const res = await this.copilotQueue.decide({
        queueId,
        decision,
        callerOrigin: trustedOrigin,
        note,
      });
      if (!res.ok) {
        return this.blockedResponse(req.id, res.humanGate, res.code, res.message);
      }
      return {
        id: req.id,
        ok: true,
        outcome: 'COMMITTED',
        humanGate: this.lastHumanGate.state,
        data: res.item,
      };
    }

    const tab = await resolveTargetTab(req.fence?.tabId);
    if (!tab || typeof tab.id !== 'number') {
      return {
        id: req.id,
        ok: false,
        outcome: 'BLOCKED',
        error: {
          code: 'NO_ACTIVE_TARGET_TAB',
          message: 'No active LinkedIn or local fixture tab found in browser.',
          retryable: false,
        },
      };
    }

    const targetUrl = typeof req.params?.url === 'string' && req.params.url.startsWith('http')
      ? req.params.url
      : undefined;
    if (targetUrl && targetUrl !== tab.url) {
      await navigateAndWait(tab.id, targetUrl, this.epochStore);
      tab.url = targetUrl;
    }

    const activeUrl = tab.url ?? '';
    const fence = await this.epochStore.ensureCurrent(tab.id, activeUrl);

    if (action === 'linkedin.status') {
      let gate = detectHumanGate({ url: activeUrl });
      try {
        const reply = await sendTabMessage<IsolatedReply>(tab.id, {
          __designOsIsolatedRpc: true,
          op: 'inspect_gate',
        });
        this.recordPassiveCount(reply?.passiveCapturedCount);
        if (reply?.gate) gate = { ...reply.gate, retryable: false };
      } catch {
        // Content script may not run on browser:// or restricted pages
      }
      this.lastHumanGate = { state: gate.state, reason: gate.reason, url: activeUrl };
      const pending = await this.copilotQueue.list('pending');
      const prefilled = await this.copilotQueue.list('prefilled');
      const report: LinkedInStatusReport = {
        connected: true,
        activeTabId: tab.id,
        activeUrl,
        humanGate: gate.state,
        ...(gate.reason ? { humanGateReason: gate.reason } : {}),
        fence,
        pacing: this.getPacingSnapshot(),
        pendingCopilotCount: pending.length + prefilled.length,
      };
      return {
        id: req.id,
        ok: gate.state === 'CLEAR',
        outcome: gate.state === 'CLEAR' ? 'COMMITTED' : 'BLOCKED',
        humanGate: gate.state,
        fence,
        data: report,
        ...(gate.state !== 'CLEAR'
          ? {
              error: {
                code: gate.state,
                message: gate.reason ?? 'Human Gate active on current tab.',
                humanGate: gate.state,
                retryable: false,
              },
            }
          : {}),
      };
    }

    const urlGate = detectHumanGate({ url: activeUrl });
    if (urlGate.state !== 'CLEAR') {
      this.lastHumanGate = { state: urlGate.state, reason: urlGate.reason, url: activeUrl };
      this.onHumanGateBlocked?.(urlGate.state, urlGate.reason ?? 'Blocked', activeUrl);
      return this.blockedResponse(req.id, urlGate.state, urlGate.state, urlGate.reason ?? 'Human gate active', fence);
    }

    if (req.fence && (action === 'browser.act' || action === 'linkedin.composer.prefill')) {
      const check = await this.epochStore.verifyFence(req.fence);
      if (!check.ok) {
        return {
          id: req.id,
          ok: false,
          outcome: 'REJECTED_STALE',
          fence,
          error: { code: check.code, message: check.message, retryable: false },
        };
      }
    }

    if (action === 'linkedin.draft.create') {
      const kind = String(req.params?.kind ?? 'message') as CopilotDraftKind;
      const target = String(req.params?.target ?? 'unknown');
      const body = String(req.params?.body ?? '');
      const shouldPrefill = Boolean(req.params?.prefill);
      const targetHref = typeof req.params?.targetUrl === 'string' ? req.params.targetUrl : activeUrl;

      let prefilled = false;
      if (shouldPrefill) {
        if (!this.bumpPrefill()) {
          return this.blockedResponse(req.id, 'BLOCKED_CHALLENGE', 'PACING_LIMIT_EXCEEDED', 'Hourly Copilot prefill cap reached.', fence);
        }
        const dispatched = await this.epochStore.withFencedTimeout(
          req.fence ?? fence,
          req.timeoutMs ?? 8000,
          () =>
            sendTabMessage<IsolatedReply>(tab.id!, {
              __designOsIsolatedRpc: true,
              op: 'linkedin.composer.prefill',
              fence: req.fence ?? fence,
              params: { body },
            }),
        );
        if (!dispatched.ok) {
          return {
            id: req.id,
            ok: false,
            outcome: dispatched.outcome,
            fence,
            error: {
              code: dispatched.code,
              message: dispatched.message,
              retryable: false,
            },
          };
        }
        if (!dispatched.data.ok) {
          const g = dispatched.data.humanGate ?? 'BLOCKED_CHALLENGE';
          return this.blockedResponse(req.id, g, dispatched.data.error?.code ?? g, dispatched.data.error?.message ?? 'Blocked', fence);
        }
        prefilled = Boolean((dispatched.data.data as { prefilled?: boolean } | undefined)?.prefilled);
        this.recordPassiveCount(dispatched.data.passiveCapturedCount);
      }

      const queued = await this.copilotQueue.enqueue({
        kind,
        target,
        targetUrl: targetHref,
        body,
        prefilled,
        fence,
        callerOrigin: trustedOrigin,
      });

      return {
        id: req.id,
        ok: true,
        outcome: 'QUEUED_COPILOT',
        humanGate: 'CLEAR',
        fence,
        data: queued,
      };
    }

    if (action === 'browser.act') {
      const opType = req.params?.op === 'fill_ref' ? 'fill_ref' : 'click_ref';
      const dispatched = await this.epochStore.withFencedTimeout(
        req.fence ?? fence,
        req.timeoutMs ?? 8000,
        () =>
          sendTabMessage<IsolatedReply>(tab.id!, {
            __designOsIsolatedRpc: true,
            op: opType,
            fence: req.fence ?? fence,
            params: req.params ?? {},
          }),
      );
      if (!dispatched.ok) {
        return {
          id: req.id,
          ok: false,
          outcome: dispatched.outcome,
          fence,
          error: { code: dispatched.code, message: dispatched.message, retryable: false },
        };
      }
      if (!dispatched.data.ok) {
        return {
          id: req.id,
          ok: false,
          outcome: dispatched.data.outcome ?? 'BLOCKED',
          fence,
          ...(dispatched.data.humanGate ? { humanGate: dispatched.data.humanGate } : {}),
          error: dispatched.data.error,
        };
      }
      return {
        id: req.id,
        ok: true,
        outcome: 'COMMITTED',
        humanGate: 'CLEAR',
        fence,
        data: dispatched.data.data,
      };
    }

    if (!this.bumpRead()) {
      return this.blockedResponse(req.id, 'BLOCKED_CHALLENGE', 'PACING_LIMIT_EXCEEDED', 'Hourly read cap reached to protect account safety.', fence);
    }

    const opMap: Record<string, string> = {
      'browser.observe': 'observe',
      'linkedin.profile.get': 'linkedin.profile.get',
      'linkedin.post.get': 'linkedin.post.get',
      'linkedin.company.get': 'linkedin.company.get',
      'linkedin.job.get': 'linkedin.job.get',
      'linkedin.inbox.list': 'linkedin.inbox.list',
      'linkedin.inbox.thread': 'linkedin.inbox.thread',
      'linkedin.search': 'linkedin.search',
      'linkedin.feed.read': 'linkedin.feed.read',
      'linkedin.analytics.read': 'linkedin.analytics.read',
      'linkedin.comments.read': 'linkedin.comments.read',
      'linkedin.composer.prefill': 'linkedin.composer.prefill',
    };

    const isolatedOp = opMap[action];
    if (!isolatedOp) {
      return {
        id: req.id,
        ok: false,
        outcome: 'BLOCKED',
        fence,
        error: { code: 'UNKNOWN_RPC_ACTION', message: `Unsupported action: ${action}`, retryable: false },
      };
    }

    const reply = await sendTabMessage<IsolatedReply>(tab.id, {
      __designOsIsolatedRpc: true,
      op: isolatedOp,
      fence,
      params: {
        ...(req.params ?? {}),
        ...(action === 'linkedin.search'
          ? {
              category: (req.params?.category ?? 'people') as LinkedInSearchCategory,
              query: String(req.params?.query ?? ''),
            }
          : {}),
      },
    });

    this.recordPassiveCount(reply?.passiveCapturedCount);

    if (!reply?.ok) {
      const gate = reply?.humanGate ?? 'CLEAR';
      if (gate !== 'CLEAR') {
        this.lastHumanGate = { state: gate, reason: reply?.error?.message, url: activeUrl };
        this.onHumanGateBlocked?.(gate, reply?.error?.message ?? 'Blocked', activeUrl);
      }
      return {
        id: req.id,
        ok: false,
        outcome: reply?.outcome ?? 'BLOCKED',
        fence,
        ...(gate !== 'CLEAR' ? { humanGate: gate } : {}),
        error: reply?.error ?? { code: 'EXTRACTION_FAILED', message: 'Tab extraction failed', retryable: false },
      };
    }

    return {
      id: req.id,
      ok: true,
      outcome: reply.outcome ?? 'COMMITTED',
      humanGate: 'CLEAR',
      fence,
      data: reply.data,
    };
  }
}
