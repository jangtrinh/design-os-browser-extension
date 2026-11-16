export interface SyncedGuardItem {
  site: string;
  state: 'CLEAR' | 'PAUSED';
  reason?: string | null;
  since?: string | null;
  evidence_id?: string | null;
}

/**
 * Renders paused account guards inside the popup. Clearing is human-only via the
 * "Resolved, resume" button; zero MCP or CLI tools expose guard resume.
 */
export function renderAccountGuards(
  guards: SyncedGuardItem[],
  onResolve: (site: string) => void,
): void {
  const panel = document.getElementById('guard-panel');
  const list = document.getElementById('guard-list');
  const count = document.getElementById('guard-count');
  if (!panel || !list || !count) return;

  const paused = guards.filter((g) => g.state === 'PAUSED');
  panel.hidden = paused.length === 0;
  count.textContent = String(paused.length);
  list.textContent = '';

  for (const item of paused) {
    const li = document.createElement('li');
    li.className = 'queue-item';

    const meta = document.createElement('div');
    meta.className = 'queue-meta';
    const siteSpan = document.createElement('span');
    siteSpan.className = 'queue-target';
    siteSpan.textContent = `Site paused: ${item.site}`;
    const sinceSpan = document.createElement('span');
    sinceSpan.className = 'meta-tag';
    sinceSpan.textContent = item.since ? item.since.slice(0, 19) : 'PAUSED';
    meta.append(siteSpan, sinceSpan);

    const reasonP = document.createElement('p');
    reasonP.className = 'queue-body';
    reasonP.textContent = item.reason || 'Account guard paused reads for this site.';

    const actions = document.createElement('div');
    actions.className = 'queue-actions';
    const resumeBtn = document.createElement('button');
    resumeBtn.type = 'button';
    resumeBtn.className = 'btn btn-secondary';
    resumeBtn.textContent = 'Resolved, resume';
    resumeBtn.addEventListener('click', () => onResolve(item.site));
    actions.append(resumeBtn);

    li.append(meta, reasonP, actions);
    list.append(li);
  }
}
