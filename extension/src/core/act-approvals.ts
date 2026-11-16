import type { CallerOrigin } from '../../../shared/rpc-envelope.js';
import type { ActOp, ActTarget } from './act-policy.js';

const APPROVAL_TTL_MS = 120_000;

export interface ActApproval {
  approvalId: string;
  op: ActOp;
  ref: number;
  tabId: number;
  epoch: number;
  pageUrl: string;
  target: ActTarget;
  valueLength?: number;
  valueDigest?: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'used';
  createdAt: number;
}

/** Small non-cryptographic digest so an approval binds to the exact text without storing it twice. */
export function digestValue(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

/**
 * Per-call human approvals for write acts. In memory only: an MV3 worker restart drops
 * every pending or approved entry, which fails closed. Approvals are single-use, expire
 * after two minutes, bind to (op, ref, tab, epoch, value) and only `extension-popup` may decide.
 */
export class ActApprovalStore {
  private readonly items = new Map<string, ActApproval>();
  private counter = 0;

  constructor(private readonly now: () => number = Date.now) {}

  request(input: Omit<ActApproval, 'approvalId' | 'status' | 'createdAt'>): ActApproval {
    this.prune();
    this.counter += 1;
    const approval: ActApproval = {
      ...input,
      approvalId: `act_${this.now().toString(36)}_${this.counter}`,
      status: 'pending',
      createdAt: this.now(),
    };
    this.items.set(approval.approvalId, approval);
    return approval;
  }

  list(): ActApproval[] {
    this.prune();
    return [...this.items.values()].filter((a) => a.status === 'pending' || a.status === 'approved');
  }

  decide(approvalId: string, decision: 'approved' | 'rejected', origin: CallerOrigin): { ok: boolean; message: string } {
    if (origin !== 'extension-popup') {
      return { ok: false, message: 'Only a human in the extension popup can decide write actions.' };
    }
    this.prune();
    const item = this.items.get(approvalId);
    if (!item || item.status !== 'pending') return { ok: false, message: 'No pending approval with that id.' };
    item.status = decision;
    return { ok: true, message: decision };
  }

  /** Consumes an approved entry if it matches this exact call. */
  consume(approvalId: string, call: { op: ActOp; ref: number; tabId: number; epoch: number; value?: string }): boolean {
    this.prune();
    const item = this.items.get(approvalId);
    if (!item || item.status !== 'approved') return false;
    const matches =
      item.op === call.op &&
      item.ref === call.ref &&
      item.tabId === call.tabId &&
      item.epoch === call.epoch &&
      item.valueDigest === digestValue(call.value);
    if (!matches) return false;
    item.status = 'used';
    return true;
  }

  private prune(): void {
    const cutoff = this.now() - APPROVAL_TTL_MS;
    for (const [id, a] of this.items) {
      if (a.createdAt < cutoff || a.status === 'used' || a.status === 'rejected') this.items.delete(id);
    }
  }
}
