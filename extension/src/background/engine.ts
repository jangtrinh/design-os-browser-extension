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
import { ActApprovalStore, digestValue } from '../core/act-approvals.js';
import { ACT_OPS, evaluateActPolicy, isAllowedUrl, type ActOp, type ActTarget } from '../core/act-policy.js';
import { detectHumanGate } from '../core/human-gate-detector.js';
import { PageEpochStore } from '../core/page-epoch-store.js';
import {
  captureVisibleTabPng,
  getLocalStore,
  getSessionStore,
  sendTabMessage,
  type KeyValueStore,
} from '../core/webext-polyfill.js';
import { navigateAndWait, resolveTargetTab } from './tab-router.js';

function isSafeReaderNavigationUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (parsed.protocol === 'http:' && host === '127.0.0.1' && parsed.pathname.startsWith('/fixture/')) return true;
    if (parsed.protocol !== 'https:') return false;
    if (!host || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return false;
    if (/^(127\.|10\.|192\.168\.|0\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) return false;
    if (/^(::1|fc[0-9a-f]{2}:|fd[0-9a-f]{2}:|fe80:)/i.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}

export interface EngineDeps {
  capabilities: EngineCapabilities;
  sessionStore?: KeyValueStore;
  localStore?: KeyValueStore;
  onHumanGateBlocked?: (state: HumanGateState, reason: string, url: string) => void;
}

const READS_HOUR_LIMIT = 120;
const PREFILLS_HOUR_LIMIT = 30;
const ACT_WRITES_HOUR_LIMIT = 30;
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
  readonly actApprovals = new ActApprovalStore();
  private readonly onHumanGateBlocked?: (state: HumanGateState, reason: string, url: string) => void;

  private readTimestamps: number[] = [];
  private prefillTimestamps: number[] = [];
  private actWriteTimestamps: number[] = [];
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
    this.actWriteTimestamps = this.actWriteTimestamps.filter((t) => t >= cutoff);
    return {
      readsLastHour: this.readTimestamps.length,
      readsHourLimit: READS_HOUR_LIMIT,
      prefillsLastHour: this.prefillTimestamps.length,
      prefillsHourLimit: PREFILLS_HOUR_LIMIT,
      actWritesLastHour: this.actWriteTimestamps.length,
      actWritesHourLimit: ACT_WRITES_HOUR_LIMIT,
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

  private bumpActWrite(): boolean {
    const snap = this.getPacingSnapshot();
    if ((snap.actWritesLastHour ?? 0) >= ACT_WRITES_HOUR_LIMIT) return false;
    this.actWriteTimestamps.push(Date.now());
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

  /**
   * Allowlist + read/write classification for browser.act. Returns a response when the act
   * must not run now (rejected, needs human approval, or pacing), otherwise null.
   */
  private async checkActPolicy(req: RpcRequest, tabId: number, pageUrl: string, fence: PageFence): Promise<RpcResponse | null> {
    const op = String(req.params?.op ?? '');
    const ref = typeof req.params?.ref === 'number' ? req.params.ref : -1;
    const value = typeof req.params?.value === 'string' ? req.params.value : undefined;
    if (!(ACT_OPS as readonly string[]).includes(op)) {
      return this.blockedResponse(req.id, 'BLOCKED_POLICY', 'ACT_OP_NOT_ALLOWED', `Op "${op}" is not in the act allowlist.`, fence);
    }
    if (!isAllowedUrl(pageUrl)) {
      return this.blockedResponse(req.id, 'BLOCKED_POLICY', 'ACT_DOMAIN_NOT_ALLOWED', 'browser.act is not allowed on this host.', fence);
    }
    const described = await sendTabMessage<IsolatedReply>(tabId, {
      __designOsIsolatedRpc: true,
      op: 'describe_ref',
      fence,
      params: { ref },
    });
    if (!described?.ok || !described.data) {
      return {
        id: req.id,
        ok: false,
        outcome: described?.outcome ?? 'REJECTED_STALE',
        fence,
        error: described?.error ?? { code: 'BROWSER_REF_MISSING', message: 'Target ref could not be described.', retryable: false },
      };
    }
    const target = described.data as ActTarget;
    const decision = evaluateActPolicy({ op, target, pageUrl });
    if (decision.allowed) {
      return this.bumpRead()
        ? null
        : this.blockedResponse(req.id, 'BLOCKED_CHALLENGE', 'PACING_LIMIT_EXCEEDED', 'Hourly read cap reached.', fence);
    }
    if (!decision.needsHuman) {
      return this.blockedResponse(req.id, 'BLOCKED_POLICY', decision.code, decision.message, fence);
    }

    const call = { op: op as ActOp, ref, tabId, epoch: fence.epoch, value };
    const approvalId = typeof req.params?.approvalId === 'string' ? req.params.approvalId : '';
    if (approvalId && this.actApprovals.consume(approvalId, call)) {
      return this.bumpActWrite()
        ? null
        : this.blockedResponse(req.id, 'BLOCKED_POLICY', 'PACING_LIMIT_EXCEEDED', 'Hourly approved-write cap reached.', fence);
    }
    const pending =
      this.actApprovals.list().find((a) => a.approvalId === approvalId && a.status === 'pending') ??
      this.actApprovals.request({
        op: call.op,
        ref,
        tabId,
        epoch: fence.epoch,
        pageUrl,
        target,
        ...(value !== undefined ? { valueLength: value.length, valueDigest: digestValue(value) } : {}),
        reason: decision.message,
      });
    this.onHumanGateBlocked?.('BLOCKED_POLICY', decision.message, pageUrl);
    return {
      ...this.blockedResponse(req.id, 'BLOCKED_POLICY', decision.code, decision.message, fence),
      data: { approvalId: pending.approvalId, target: { role: target.role, name: target.name.slice(0, 80) } },
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

    if (action === 'browser.act.approvals') {
      return { id: req.id, ok: true, outcome: 'COMMITTED', humanGate: this.lastHumanGate.state, data: { items: this.actApprovals.list() } };
    }

    if (action === 'browser.act.decide') {
      // Only the trusted popup handler passes 'extension-popup'; agent-rpc decisions are refused.
      const res = this.actApprovals.decide(
        String(req.params?.approvalId ?? ''),
        req.params?.decision === 'approved' ? 'approved' : 'rejected',
        trustedOrigin,
      );
      return res.ok
        ? { id: req.id, ok: true, outcome: 'COMMITTED', humanGate: 'CLEAR', data: { decision: res.message } }
        : this.blockedResponse(req.id, 'BLOCKED_POLICY', 'ACT_DECISION_REFUSED', res.message);
    }

    const requestedUrl = typeof req.params?.url === 'string' && req.params.url.startsWith('http')
      ? req.params.url
      : undefined;
    const tab = await resolveTargetTab(req.fence?.tabId, requestedUrl);
    if (!tab || typeof tab.id !== 'number') {
      return {
        id: req.id,
        ok: false,
        outcome: 'BLOCKED',
        error: {
          code: 'NO_ACTIVE_TARGET_TAB',
          message: 'No active target tab found in browser.',
          retryable: false,
        },
      };
    }

    const targetUrl = requestedUrl;
    const urlAllowed = targetUrl
      ? action === 'reader.collect'
        ? isSafeReaderNavigationUrl(targetUrl)
        : isAllowedUrl(targetUrl)
      : true;
    if (targetUrl && !urlAllowed) {
      return this.blockedResponse(
        req.id,
        'BLOCKED_POLICY',
        'NAVIGATION_DOMAIN_NOT_ALLOWED',
        action === 'reader.collect'
          ? 'Reader navigation rejected unsafe or private target URL.'
          : 'The url parameter must point to an allowlisted host (LinkedIn or local fixtures).',
      );
    }
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
      if (action === 'reader.collect') {
        const screenshotBase64 = await captureVisibleTabPng(tab.windowId);
        return {
          ...this.blockedResponse(req.id, urlGate.state, urlGate.state, urlGate.reason ?? 'Human gate active', fence),
          data: { ...(screenshotBase64 ? { screenshotBase64 } : {}), gateReason: urlGate.reason },
        };
      }
      return this.blockedResponse(req.id, urlGate.state, urlGate.state, urlGate.reason ?? 'Human gate active', fence);
    }

    if (action === 'reader.collect') {
      const reply = await sendTabMessage<IsolatedReply>(tab.id, {
        __designOsIsolatedRpc: true,
        op: 'reader.collect',
        fence,
        params: req.params ?? {},
      });
      this.recordPassiveCount(reply?.passiveCapturedCount);
      if (!reply?.ok) {
        const gate = reply?.humanGate ?? 'BLOCKED_CHALLENGE';
        this.lastHumanGate = { state: gate, reason: reply?.error?.message, url: activeUrl };
        this.onHumanGateBlocked?.(gate, reply?.error?.message ?? 'Blocked', activeUrl);
        const screenshotBase64 = await captureVisibleTabPng(tab.windowId);
        return {
          id: req.id,
          ok: false,
          outcome: reply?.outcome ?? 'BLOCKED',
          fence,
          humanGate: gate,
          data: { ...(screenshotBase64 ? { screenshotBase64 } : {}), gateReason: reply?.error?.message },
          error: reply?.error ?? { code: gate, message: 'Human gate triggered during collect', retryable: false },
        };
      }
      const wantShot = Boolean(req.params?.captureScreenshot);
      const screenshotBase64 = wantShot ? await captureVisibleTabPng(tab.windowId) : undefined;
      return {
        id: req.id,
        ok: true,
        outcome: 'COMMITTED',
        humanGate: 'CLEAR',
        fence,
        data: { snapshot: reply.data, ...(screenshotBase64 ? { screenshotBase64 } : {}) },
      };
    }

    if (action === 'browser.captureScreenshot') {
      const screenshotBase64 = await captureVisibleTabPng(tab.windowId);
      return {
        id: req.id,
        ok: Boolean(screenshotBase64),
        outcome: screenshotBase64 ? 'COMMITTED' : 'BLOCKED',
        humanGate: 'CLEAR',
        fence,
        data: { screenshotBase64 },
      };
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
      const gateRes = await this.checkActPolicy(req, tab.id, activeUrl, req.fence ?? fence);
      if (gateRes) return gateRes;
      const opType = req.params?.op as ActOp;
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
