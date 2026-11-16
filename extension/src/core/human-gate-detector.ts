import type { HumanGateState } from '../../../shared/rpc-envelope.js';

export interface HumanGateCheckInput {
  url: string;
  title?: string;
  statusCodes?: number[];
  domMarkers?: string[];
  bodyTextSample?: string;
  structuralAlertTexts?: string[];
}

export interface HumanGateCheckResult {
  state: HumanGateState;
  reason?: string;
  retryable: false;
}

const CHALLENGE_URL_RE =
  /\/(checkpoint|challenge|security-verification|captcha|cdn-cgi\/challenge-platform|account\/access)(\/|\?|$)/i;
const AUTH_URL_RE = /\/(uas\/login|authwall|login|signup\/cold-join)(\/|\?|$)/i;
const PAYMENT_URL_RE = /\/(premium\/products|premium\/checkout|sales\/login|recruiter\/login)(\/|\?|$)/i;

const CHALLENGE_MARKER_RE =
  /(arkose|funcaptcha|recaptcha|hcaptcha|turnstile|challenges\.cloudflare\.com|checkpoint-challenge|captcha-internal|px-captcha|cf-challenge)/i;
const CHALLENGE_STRUCTURAL_TEXT_RE =
  /(quick security check|security verification|let's do a quick verification|unusual activity|verify you are a human|temporarily blocked|tạm thời bị chặn|you're temporarily blocked|you are doing that too much|whoa there, pardner|your account has been locked|just a moment\.\.\.|checking your browser|account restricted)/i;
const AUTH_TEXT_RE = /(sign in to linkedin|join linkedin to view|session_key|authwall|log in to continue)/i;
const PAYMENT_MARKER_RE = /(premium-upsell-wall|paywall-gate|subscription-paywall)/i;

/**
 * Pure non-bypass gate classifier. Always halts and hands visible tab control back to the human user.
 * Warning/restriction phrases are matched against URLs, title, and structural markers/alerts,
 * NEVER ordinary social-post body copy mentioning phrases like "security check".
 */
export function detectHumanGate(input: HumanGateCheckInput): HumanGateCheckResult {
  const url = input.url ?? '';
  const statusCodes = input.statusCodes ?? [];
  const markers = (input.domMarkers ?? []).join(' ');
  const structuralText = `${input.title ?? ''} ${(input.structuralAlertTexts ?? []).join(' ')}`;
  const bodySample = input.bodyTextSample ?? '';

  if (statusCodes.includes(451) || statusCodes.includes(429)) {
    const code = statusCodes.includes(451) ? 451 : 429;
    return {
      state: 'BLOCKED_CHALLENGE',
      reason: `Received HTTP ${code} rate/security signal from page stream. Halted for human resolution.`,
      retryable: false,
    };
  }

  if (
    CHALLENGE_URL_RE.test(url) ||
    CHALLENGE_MARKER_RE.test(markers) ||
    CHALLENGE_STRUCTURAL_TEXT_RE.test(structuralText)
  ) {
    return {
      state: 'BLOCKED_CHALLENGE',
      reason: `Security checkpoint or CAPTCHA detected (${url || structuralText.trim().slice(0, 80) || 'DOM marker'}). Complete verification in the browser tab.`,
      retryable: false,
    };
  }

  if (PAYMENT_URL_RE.test(url) || PAYMENT_MARKER_RE.test(markers)) {
    return {
      state: 'BLOCKED_PAYMENT',
      reason: `Premium or paywall gate detected (${url || 'DOM marker'}). Human upgrade required in browser.`,
      retryable: false,
    };
  }

  const combinedAuth = `${structuralText} ${markers.includes('login-form') ? bodySample : ''}`;
  if (
    AUTH_URL_RE.test(url) ||
    markers.includes('login-form') ||
    (AUTH_TEXT_RE.test(combinedAuth) && !url.includes('/in/') && !url.includes('/feed'))
  ) {
    return {
      state: 'BLOCKED_AUTH',
      reason: `Authentication or authwall detected (${url || 'login form'}). Sign in manually in the browser tab.`,
      retryable: false,
    };
  }

  return { state: 'CLEAR', retryable: false };
}

export function scanDocumentHumanGate(
  doc: Document,
  url: string,
  recentStatusCodes: number[] = [],
): HumanGateCheckResult {
  const domMarkers: string[] = [];
  const structuralAlertTexts: string[] = [];

  if (doc.querySelector('[data-test-id="checkpoint-challenge"], [data-test="checkpoint-challenge"], #challenge-running, #challenge-form')) {
    domMarkers.push('checkpoint-challenge');
  }
  const iframes = Array.from(doc.querySelectorAll('iframe'));
  for (const frame of iframes) {
    const src = frame.getAttribute('src') ?? '';
    if (CHALLENGE_MARKER_RE.test(src)) {
      domMarkers.push(src);
    }
  }
  if (doc.querySelector('form[action*="uas/login"], input#username[name="session_key"]')) {
    domMarkers.push('login-form');
  }
  if (doc.querySelector('[data-test-id="premium-upsell-wall"], [data-test="paywall-gate"]')) {
    domMarkers.push('premium-upsell-wall');
  }

  const alertEls = Array.from(
    doc.querySelectorAll('[role="alert"], [role="dialog"] h1, [role="dialog"] h2, main > h1, .challenge-error, #cf-error-details'),
  );
  for (const el of alertEls) {
    const txt = (el.textContent ?? '').trim();
    if (txt) structuralAlertTexts.push(txt.slice(0, 300));
  }

  const bodySample = (doc.body?.innerText ?? doc.body?.textContent ?? '').slice(0, 1200);
  return detectHumanGate({
    url,
    title: doc.title,
    statusCodes: recentStatusCodes,
    domMarkers,
    structuralAlertTexts,
    bodyTextSample: bodySample,
  });
}
