/**
 * Policy for `browser.act` (pilot 2026-11-16, gap 6: click_ref/fill_ref could click any
 * element, including Send, Like or Connect, and --url could navigate anywhere).
 *
 * Read-only by default: an act is allowed without a human only when it is a click that
 * navigates within an allowlisted host or expands/paginates content. Every other act is a
 * write and needs a per-call human approval from the extension popup (default deny).
 */

export const ACT_OPS = ['click_ref', 'fill_ref'] as const;
export type ActOp = (typeof ACT_OPS)[number];

export const DEFAULT_ALLOWED_HOSTS = ['www.linkedin.com', 'linkedin.com', '127.0.0.1', 'localhost'];

export interface ActTarget {
  role: string;
  name: string;
  tag: string;
  href?: string;
  inputType?: string;
  inForm?: boolean;
  editable?: boolean;
}

export type ActClass = 'read' | 'write';

export type ActDecision =
  | { allowed: true; cls: 'read'; reason: string }
  | { allowed: false; cls: ActClass | 'invalid'; code: string; message: string; needsHuman: boolean };

/** Visible labels of actions that change state for someone (LinkedIn and generic web). */
const WRITE_NAME_RE =
  /\b(send|post|publish|submit|like|react|reaction|celebrate|support|love|insightful|funny|curious|comment|reply|repost|share|connect|invite|follow|unfollow|message|accept|ignore|withdraw|endorse|apply|save|delete|remove|report|block|hide|mute|pay|buy|purchase|subscribe|upgrade|confirm|boost|edit|add|create|recommend|vote|sign|log ?out|join|enroll|book|reserve|download)\b/i;

/** Clicks that only reveal, paginate or close content on the current page. */
const READ_BUTTON_RE =
  /^(show|see|load|view) (more|all|less|previous|translation|details|analytics|replies|comments|more comments|more replies|previous comments|previous replies)\b|^(…|\.\.\.)?\s*more$|^(next|previous|page \d+|close|dismiss|cancel|back|expand|collapse)$/i;

/** Same-host links that open a write flow even though they are links. */
const WRITE_PATH_RE =
  /\/(messaging\/compose|sharing|share|campaignmanager|boost|preload\/search-custom-invite|edit|premium|checkout|payments|purchase|subscription|settings|logout|uas\/logout)\b/i;

export function isAllowedUrl(rawUrl: string | undefined, hosts: string[] = DEFAULT_ALLOWED_HOSTS): boolean {
  if (!rawUrl) return false;
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    if (u.protocol === 'http:' && !['127.0.0.1', 'localhost'].includes(u.hostname)) return false;
    return hosts.includes(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function classifyAct(op: ActOp, target: ActTarget, pageUrl: string): { cls: ActClass; reason: string } {
  if (op === 'fill_ref') return { cls: 'write', reason: 'typing into a field is a write' };
  const name = target.name.trim();
  if (WRITE_NAME_RE.test(name)) return { cls: 'write', reason: `label "${name.slice(0, 60)}" names a write action` };
  if (target.inputType === 'submit' || (target.tag === 'button' && target.inForm)) {
    return { cls: 'write', reason: 'submits a form' };
  }
  if (target.role === 'link' && target.href) {
    let href: URL;
    try {
      href = new URL(target.href, pageUrl);
    } catch {
      return { cls: 'write', reason: 'unparseable link' };
    }
    if (WRITE_PATH_RE.test(href.pathname)) return { cls: 'write', reason: `link opens a write flow (${href.pathname})` };
    if (href.protocol === 'javascript:') return { cls: 'write', reason: 'javascript: link' };
    return { cls: 'read', reason: 'navigation link' };
  }
  if (target.role === 'tab' || READ_BUTTON_RE.test(name)) return { cls: 'read', reason: 'reveals or paginates content' };
  return { cls: 'write', reason: 'unknown control; treated as a write by default' };
}

export function evaluateActPolicy(input: {
  op: string;
  target: ActTarget;
  pageUrl: string;
  allowedHosts?: string[];
}): ActDecision {
  const hosts = input.allowedHosts ?? DEFAULT_ALLOWED_HOSTS;
  if (!(ACT_OPS as readonly string[]).includes(input.op)) {
    return { allowed: false, cls: 'invalid', code: 'ACT_OP_NOT_ALLOWED', message: `Op "${input.op}" is not in the act allowlist (${ACT_OPS.join(', ')}).`, needsHuman: false };
  }
  if (!isAllowedUrl(input.pageUrl, hosts)) {
    return { allowed: false, cls: 'invalid', code: 'ACT_DOMAIN_NOT_ALLOWED', message: `browser.act is not allowed on ${safeHost(input.pageUrl)}.`, needsHuman: false };
  }
  const { cls, reason } = classifyAct(input.op as ActOp, input.target, input.pageUrl);
  if (cls === 'read' && input.target.role === 'link' && input.target.href) {
    const dest = new URL(input.target.href, input.pageUrl).href;
    if (!isAllowedUrl(dest, hosts)) {
      return { allowed: false, cls: 'invalid', code: 'ACT_DOMAIN_NOT_ALLOWED', message: `Link leaves the allowlist (${safeHost(dest)}).`, needsHuman: false };
    }
  }
  if (cls === 'read') return { allowed: true, cls, reason };
  return {
    allowed: false,
    cls,
    code: 'ACT_REQUIRES_HUMAN_APPROVAL',
    message: `Write action blocked (${reason}). A human must approve it in the extension popup, then retry with the approvalId.`,
    needsHuman: true,
  };
}

function safeHost(rawUrl: string): string {
  try {
    return new URL(rawUrl).host || rawUrl.slice(0, 60);
  } catch {
    return rawUrl.slice(0, 60);
  }
}
