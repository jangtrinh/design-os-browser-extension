import type { HumanGateState } from '../../../shared/rpc-envelope.js';

export interface HumanGateCheckInput {
  url: string;
  title?: string;
  statusCodes?: number[];
  domMarkers?: string[];
  bodyTextSample?: string;
}

export interface HumanGateCheckResult {
  state: HumanGateState;
  reason?: string;
  retryable: false;
}

const CHALLENGE_URL_RE = /\/(checkpoint|challenge|security-verification|captcha)(\/|\?|$)/i;
const AUTH_URL_RE = /\/(uas\/login|authwall|login|signup\/cold-join)(\/|\?|$)/i;
const PAYMENT_URL_RE = /\/(premium\/products|premium\/checkout|sales\/login|recruiter\/login)(\/|\?|$)/i;

const CHALLENGE_MARKER_RE =
  /(arkose|funcaptcha|recaptcha|hcaptcha|checkpoint-challenge|captcha-internal|px-captcha)/i;
const CHALLENGE_TEXT_RE =
  /(quick security check|security verification|let's do a quick verification|unusual activity|verify you are a human)/i;
const AUTH_TEXT_RE = /(sign in to linkedin|join linkedin to view|session_key|authwall)/i;
const PAYMENT_MARKER_RE = /(premium-upsell-wall|paywall-gate|subscription-paywall)/i;

/**
 * Pure non-bypass gate classifier. Always halts and hands visible tab control back to the human user.
 */
export function detectHumanGate(input: HumanGateCheckInput): HumanGateCheckResult {
  const url = input.url ?? '';
  const statusCodes = input.statusCodes ?? [];
  const markers = (input.domMarkers ?? []).join(' ');
  const combinedText = `${input.title ?? ''} ${input.bodyTextSample ?? ''}`;

  if (statusCodes.includes(451) || statusCodes.includes(429)) {
    const code = statusCodes.includes(451) ? 451 : 429;
    return {
      state: 'BLOCKED_CHALLENGE',
      reason: `Received HTTP ${code} rate/security signal from page stream. Halted for human resolution.`,
      retryable: false,
    };
  }

  if (CHALLENGE_URL_RE.test(url) || CHALLENGE_MARKER_RE.test(markers) || CHALLENGE_TEXT_RE.test(combinedText)) {
    return {
      state: 'BLOCKED_CHALLENGE',
      reason: `Security checkpoint or CAPTCHA detected (${url || 'DOM marker'}). Complete verification in the browser tab.`,
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

  if (AUTH_URL_RE.test(url) || (AUTH_TEXT_RE.test(combinedText) && !url.includes('/in/') && !url.includes('/feed'))) {
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

  if (doc.querySelector('[data-test-id="checkpoint-challenge"], [data-test="checkpoint-challenge"]')) {
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

  const bodySample = (doc.body?.innerText ?? doc.body?.textContent ?? '').slice(0, 1200);
  return detectHumanGate({
    url,
    title: doc.title,
    statusCodes: recentStatusCodes,
    domMarkers,
    bodyTextSample: bodySample,
  });
}
