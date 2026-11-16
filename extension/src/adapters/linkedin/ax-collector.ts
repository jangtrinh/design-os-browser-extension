import { inferName, inferRole, isHiddenElement, normalizeWhitespace } from '../../core/dom-snapshot.js';
import type { AxNode } from './aria-nodes.js';

const DEFAULT_MAX_NODES = 1500;
const NAME_MAX = 300;
const TEXT_MAX = 3000;

/** Interactive + landmark nodes (same family as `observe`) plus comment/article containers and body text. */
const AX_SELECTOR = [
  'h1', 'h2', 'h3', 'a[href]', 'button',
  '[role="button"]', '[role="link"]', '[role="heading"]', '[role="tab"]',
  '[role="comment"]', '[role="article"]', 'article',
  'p', 'span[dir="ltr"]',
].join(', ');

function containerRole(el: Element): 'comment' | 'article' | undefined {
  const role = el.getAttribute('role');
  if (role === 'comment') return 'comment';
  if (role === 'article' || el.tagName.toLowerCase() === 'article') {
    const label = el.getAttribute('aria-label') ?? '';
    return /^(comment|reply)\b/i.test(label) ? 'comment' : 'article';
  }
  return undefined;
}

/**
 * Collects an accessibility-shaped node list from the live DOM for the ARIA readers.
 * Body text (`p`, `span[dir=ltr]`) becomes role `text`, skipping text already inside a
 * link/button or inside another collected text node, so each sentence appears once.
 */
export function collectAxNodes(doc: Document, maxNodes = DEFAULT_MAX_NODES): AxNode[] {
  const out: AxNode[] = [];
  const textOwners: Element[] = [];
  for (const el of Array.from(doc.querySelectorAll(AX_SELECTOR))) {
    if (out.length >= maxNodes) break;
    if (isHiddenElement(el) || el.closest('[aria-hidden="true"]')) continue;
    const tag = el.tagName.toLowerCase();

    const container = containerRole(el);
    if (container) {
      out.push({
        role: container,
        name: normalizeWhitespace(el.getAttribute('aria-label')).slice(0, NAME_MAX),
        text: normalizeWhitespace(el.textContent).slice(0, TEXT_MAX),
      });
      continue;
    }

    if (tag === 'p' || tag === 'span') {
      if (el.closest('a[href], button, [role="button"], [role="link"]')) continue;
      if (textOwners.some((owner) => owner.contains(el))) continue;
      const text = normalizeWhitespace(el.textContent);
      if (text.length < 2) continue;
      textOwners.push(el);
      out.push({ role: 'text', name: text.slice(0, NAME_MAX), text: text.slice(0, TEXT_MAX) });
      continue;
    }

    const name = inferName(el, NAME_MAX);
    if (!name) continue;
    const href = tag === 'a' ? (el as HTMLAnchorElement).href || el.getAttribute('href') || undefined : undefined;
    out.push({ role: inferRole(el), name, ...(href ? { href } : {}) });
  }
  return out;
}
