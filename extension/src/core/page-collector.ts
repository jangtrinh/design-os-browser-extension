import type { CollectedItemBlock, CollectedPageSnapshot } from '../../../shared/reader-schema.js';
import { collectAxNodes } from '../adapters/linkedin/ax-collector.js';
import { isRenderedElement, normalizeWhitespace, visibleTextOf } from './dom-snapshot.js';
import { CHALLENGE_MARKER_RE, isInvisibleChallengeFrameSrc } from './human-gate-detector.js';

const PROMPT_INJECTION_LINE_RE =
  /(ignore\s+(all\s+)?previous\s+instructions|disregard\s+system\s+prompt|system\s*prompt\s*:|<\|im_start\|>|assistant\s*:\s*please|you\s+must\s+override)/i;

const SPINNER_TEXT_RE = /(đang tải\.\.\.|loading\.\.\.|please wait|still loading)/i;

const MAX_TEXT_LINES = 1500;
const MAX_LINE_LENGTH = 300;
const DIALOG_SELECTOR = '[role="dialog"], [role="alertdialog"], [aria-modal="true"], dialog[open]';
const LOGIN_FORM_SELECTOR =
  'form[action*="login" i], form[action*="signin" i], form[action*="sign_in" i], form[action*="uas/login"], input[name="session_key"]';

/**
 * Pure read-only page snapshot collector for the Shared Browser Layer.
 * Never clicks, types, focuses, submits, or dispatches synthetic input events.
 * Scrolling (for R7 lists) uses `window.scrollBy` only when explicitly requested.
 */
export function collectPageSnapshot(
  doc: Document,
  url: string,
  options: { scrollSteps?: number; maxNodes?: number; itemSelector?: string } = {},
): CollectedPageSnapshot {
  let scrollStepsExecuted = 0;
  const maxScrollSteps = Math.max(0, Math.min(options.scrollSteps ?? 0, 12));
  for (let i = 0; i < maxScrollSteps; i += 1) {
    if (typeof window !== 'undefined' && typeof window.scrollBy === 'function') {
      window.scrollBy(0, 700);
      scrollStepsExecuted += 1;
    }
  }

  const axNodes = collectAxNodes(doc, options.maxNodes ?? 1500);
  const headings = Array.from(doc.querySelectorAll('h1, h2, h3, [role="heading"]'))
    .map((h) => normalizeWhitespace(h.textContent))
    .filter(Boolean)
    .slice(0, 80);

  const links = Array.from(doc.querySelectorAll('a[href]'))
    .map((a) => ({
      text: normalizeWhitespace(a.textContent).slice(0, 200),
      href: (a as HTMLAnchorElement).href || a.getAttribute('href') || '',
    }))
    .filter((l) => l.href)
    .slice(0, 400);

  const meta: Record<string, string> = {};
  for (const m of Array.from(doc.querySelectorAll('meta[name], meta[property]'))) {
    const key = m.getAttribute('name') || m.getAttribute('property');
    const val = m.getAttribute('content');
    if (key && val) meta[key] = val.slice(0, 300);
  }

  const domMarkers: string[] = [];
  if (doc.querySelector('#challenge-running, #challenge-form, [data-test-id="checkpoint-challenge"]')) {
    domMarkers.push('checkpoint-challenge');
  }
  if (doc.querySelector('[data-test-id="premium-upsell-wall"], [data-test="paywall-gate"]')) {
    domMarkers.push('premium-upsell-wall');
  }
  if (Array.from(doc.querySelectorAll('input[type="password"]')).some((el) => isRenderedElement(el))) {
    domMarkers.push('password-input');
  }
  if (Array.from(doc.querySelectorAll(LOGIN_FORM_SELECTOR)).some((el) => isRenderedElement(el))) {
    domMarkers.push('login-form');
  }
  for (const frame of Array.from(doc.querySelectorAll('iframe'))) {
    const src = frame.getAttribute('src') ?? '';
    // Invisible reCAPTCHA v3 / bot-score frames sit on many sign-in modals; only a frame a
    // human can actually see and solve counts as a challenge.
    if (CHALLENGE_MARKER_RE.test(src) && !isInvisibleChallengeFrameSrc(src) && isRenderedElement(frame, 30, 30)) {
      domMarkers.push('challenge-iframe');
      break;
    }
  }

  const dialogTexts = Array.from(doc.querySelectorAll(DIALOG_SELECTOR))
    .filter((el) => isRenderedElement(el))
    .map((el) => normalizeWhitespace(visibleTextOf(el)).slice(0, 600))
    .filter(Boolean)
    .slice(0, 10);

  const structuralAlertTexts = Array.from(
    doc.querySelectorAll('[role="alert"], [role="dialog"] h1, [role="dialog"] h2, main > h1, .challenge-error'),
  )
    .map((el) => normalizeWhitespace(el.textContent).slice(0, 300))
    .filter(Boolean);

  const loadingIndicators: string[] = [];
  for (const el of Array.from(doc.querySelectorAll('[role="progressbar"], [aria-busy="true"], [data-testid*="spinner"], .loading-spinner'))) {
    const txt = normalizeWhitespace(el.textContent || el.getAttribute('aria-label') || 'loading');
    if (txt) loadingIndicators.push(txt.slice(0, 120));
  }
  const bodyText = visibleTextOf(doc.body);
  const bodySample = normalizeWhitespace(bodyText).slice(0, 4000);
  const textLines = bodyText
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(line).slice(0, MAX_LINE_LENGTH))
    .filter(Boolean)
    .slice(0, MAX_TEXT_LINES);
  const spinnerMatch = bodySample.match(SPINNER_TEXT_RE);
  if (spinnerMatch && !loadingIndicators.includes(spinnerMatch[0])) {
    loadingIndicators.push(spinnerMatch[0]);
  }

  const hiddenInstructions: string[] = [];
  for (const el of Array.from(doc.querySelectorAll('[aria-hidden="true"], [style*="display:none"], [style*="opacity:0"], script[type="text/plain"], template'))) {
    const t = normalizeWhitespace(el.textContent ?? '');
    if (t && PROMPT_INJECTION_LINE_RE.test(t)) {
      hiddenInstructions.push(t.slice(0, 200));
    }
  }
  if (PROMPT_INJECTION_LINE_RE.test(bodySample)) {
    hiddenInstructions.push('body_prompt_instruction');
  }

  const stalled =
    loadingIndicators.length > 0 &&
    axNodes.filter((n) => n.role === 'link' || n.role === 'text').length < 5;

  return {
    url,
    finalUrl: doc.location?.href || url,
    title: doc.title || '',
    axNodes,
    headings,
    links,
    meta,
    bodySample,
    domMarkers,
    structuralAlertTexts,
    loadingIndicators,
    hiddenInstructions,
    scrollStepsExecuted,
    stalled,
    textLines,
    dialogTexts,
    ...(options.itemSelector ? { items: collectItemBlocks(doc, options.itemSelector) } : {}),
  };
}

const MAX_ITEM_BLOCKS = 200;
const MAX_ITEM_LINES = 40;
const MAX_ITEM_LINKS = 20;

/** Read-only: returns visible text lines, links and heading of each block matching `selector`. */
export function collectItemBlocks(doc: Document, selector: string): CollectedItemBlock[] {
  if (!selector || selector.length > 300) return [];
  let nodes: Element[];
  try {
    nodes = Array.from(doc.querySelectorAll(selector));
  } catch {
    return [];
  }
  const out: CollectedItemBlock[] = [];
  for (const el of nodes) {
    if (out.length >= MAX_ITEM_BLOCKS) break;
    const lines = visibleTextOf(el)
      .split(/\r?\n/)
      .map((line) => normalizeWhitespace(line).slice(0, MAX_LINE_LENGTH))
      .filter(Boolean)
      .slice(0, MAX_ITEM_LINES);
    const links = Array.from(el.querySelectorAll?.('a[href]') ?? [])
      .slice(0, MAX_ITEM_LINKS)
      .map((a) => ({
        text: normalizeWhitespace(a.textContent).slice(0, 200),
        href: (a as HTMLAnchorElement).href || a.getAttribute('href') || '',
      }))
      .filter((l) => l.href);
    const headingEl = el.querySelector?.('h1, h2, h3, h4, h5, h6');
    const parentBlock = el.parentElement?.closest?.(selector) ?? null;
    out.push({
      id: el.getAttribute('id') || null,
      parentId: parentBlock?.getAttribute('id') || null,
      lines,
      links,
      heading: headingEl ? normalizeWhitespace(headingEl.textContent).slice(0, 200) || null : null,
    });
  }
  return out;
}
