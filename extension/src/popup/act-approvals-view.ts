import type { ActApproval } from '../core/act-approvals.js';

/**
 * Renders write acts (browser.act) waiting for a human. The panel stays hidden when nothing
 * is pending. Approving lets the agent run that one exact act once, within two minutes.
 */
export function renderActApprovals(
  items: ActApproval[],
  onDecide: (approvalId: string, decision: 'approved' | 'rejected') => void,
): void {
  const panel = document.getElementById('act-panel');
  const list = document.getElementById('act-list');
  const count = document.getElementById('act-count');
  if (!panel || !list || !count) return;
  const pending = items.filter((a) => a.status === 'pending');
  panel.hidden = pending.length === 0;
  count.textContent = String(pending.length);
  list.textContent = '';
  for (const item of pending.slice(0, 5)) {
    const li = document.createElement('li');
    li.className = 'queue-item';
    const meta = document.createElement('div');
    meta.className = 'queue-meta';
    const what = document.createElement('span');
    what.className = 'queue-target';
    const verb = item.op === 'fill_ref' ? `Type ${item.valueLength ?? 0} chars into` : 'Click';
    what.textContent = `${verb} ${item.target.role} "${item.target.name.slice(0, 60)}"`;
    meta.append(what);
    const where = document.createElement('p');
    where.className = 'queue-body';
    where.textContent = `${item.pageUrl} · ${item.reason}`;
    const actions = document.createElement('div');
    actions.className = 'queue-actions';
    const approve = document.createElement('button');
    approve.type = 'button';
    approve.className = 'btn btn-secondary';
    approve.textContent = 'Allow once';
    approve.addEventListener('click', () => onDecide(item.approvalId, 'approved'));
    const reject = document.createElement('button');
    reject.type = 'button';
    reject.className = 'btn btn-danger';
    reject.textContent = 'Deny';
    reject.addEventListener('click', () => onDecide(item.approvalId, 'rejected'));
    actions.append(approve, reject);
    li.append(meta, where, actions);
    list.append(li);
  }
}
