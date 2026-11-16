import type { DomSnapshotResult, SnapshotNode } from '../../../shared/linkedin-schema.js';
import type { HumanGateState, PageFence } from '../../../shared/rpc-envelope.js';

const DEFAULT_MAX_NODES = 120;

const SNAPSHOT_SELECTOR =
  'h1, h2, h3, a[href], button, input, textarea, [role="button"], [role="link"], [role="textbox"], [role="combobox"], [role="article"], [data-view-name]';

function normalizeWhitespace(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function inferRole(el: Element): string {
  const explicit = el.getAttribute('role');
  if (explicit) return explicit;
  const tag = el.tagName.toLowerCase();
  if (tag === 'a') return 'link';
  if (tag === 'button') return 'button';
  if (tag === 'textarea') return 'textbox';
  if (tag === 'input') return el.getAttribute('type') === 'submit' ? 'button' : 'textbox';
  if (tag === 'h1' || tag === 'h2' || tag === 'h3') return 'heading';
  if (el.getAttribute('contenteditable') === 'true') return 'textbox';
  return tag;
}

function isHiddenElement(el: Element): boolean {
  if (el.getAttribute('aria-hidden') === 'true') return true;
  if (el.hasAttribute('hidden')) return true;
  const styleAttr = el.getAttribute('style') ?? '';
  if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test(styleAttr)) return true;
  return false;
}

function inferName(el: Element): string {
  const ariaLabel = normalizeWhitespace(el.getAttribute('aria-label'));
  if (ariaLabel) return ariaLabel.slice(0, 120);
  const placeholder = normalizeWhitespace(el.getAttribute('placeholder'));
  if (placeholder) return placeholder.slice(0, 120);
  const text = normalizeWhitespace(el.textContent);
  return text.slice(0, 120);
}

/**
 * Builds a compact token-saving ARIA/DOM snapshot capped to relevant interactive and landmark nodes.
 */
export function buildCompactDomSnapshot(
  doc: Document,
  fence: PageFence,
  gate: { state: HumanGateState; reason?: string },
  maxNodes: number = DEFAULT_MAX_NODES,
): { snapshot: DomSnapshotResult; refMap: Map<number, Element> } {
  const nodes: SnapshotNode[] = [];
  const refMap = new Map<number, Element>();
  const candidates = Array.from(doc.querySelectorAll(SNAPSHOT_SELECTOR));

  let refCounter = 1;
  for (const el of candidates) {
    if (nodes.length >= maxNodes) break;
    if (isHiddenElement(el)) continue;

    const tag = el.tagName.toLowerCase();
    const role = inferRole(el);
    const name = inferName(el);
    if (!name && role !== 'textbox') continue;

    const editable =
      tag === 'textarea' ||
      tag === 'input' ||
      el.getAttribute('contenteditable') === 'true' ||
      role === 'textbox';

    const href = tag === 'a' ? (el.getAttribute('href') ?? undefined) : undefined;
    const node: SnapshotNode = {
      ref: refCounter,
      role,
      name: name || '(empty textbox)',
      tag,
      ...(href ? { href } : {}),
      ...(editable ? { editable: true } : {}),
    };
    nodes.push(node);
    refMap.set(refCounter, el);
    refCounter += 1;
  }

  const lines = nodes.map((n) => {
    const attrs = [
      n.editable ? 'editable' : '',
      n.href ? `href=${n.href}` : '',
    ]
      .filter(Boolean)
      .join(' ');
    return `[ref=${n.ref}] ${n.role} "${n.name}"${attrs ? ` (${attrs})` : ''}`;
  });

  return {
    snapshot: {
      url: doc.location?.href ?? '',
      title: doc.title ?? '',
      fence,
      humanGate: gate.state,
      ...(gate.reason ? { humanGateReason: gate.reason } : {}),
      compactText: lines.join('\n'),
      nodes,
    },
    refMap,
  };
}
