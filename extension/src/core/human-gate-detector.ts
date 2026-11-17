import type { CollectedPageSnapshot } from '../../../shared/reader-schema.js';
import type { HumanGateState } from '../../../shared/rpc-envelope.js';
import { isRenderedElement } from './dom-snapshot.js';

export interface HumanGateCheckInput {
  url: string;
  title?: string;
  statusCodes?: number[];
  domMarkers?: string[];
  bodyTextSample?: string;
  structuralAlertTexts?: string[];
  /** Visible text of open dialogs/modals (login modals, block pages). */
  dialogTexts?: string[];
}

export interface HumanGateCheckResult {
  state: HumanGateState;
  reason?: string;
  retryable: false;
}

const CHALLENGE_URL_RE =
  /\/(checkpoint|challenge|security-verification|captcha|cdn-cgi\/challenge-platform|account\/access)(\/|\?|$)|[?&]js_challenge=1\b/i;
const AUTH_URL_RE = /\/(uas\/login|authwall|login|signup\/cold-join|i\/flow\/login)(\/|\?|$)/i;
/** Identity-provider sign-in hosts a site redirects to when the session is missing (YouTube Studio -> Google). */
const AUTH_HOST_URL_RE = /^https?:\/\/(accounts\.google\.com\/(?:v\d\/)?(?:signin|ServiceLogin|AccountChooser)|login\.microsoftonline\.com\/|appleid\.apple\.com\/auth)/i;
const PAYMENT_URL_RE = /\/(premium\/products|premium\/checkout|sales\/login|recruiter\/login)(\/|\?|$)/i;

export const CHALLENGE_MARKER_RE =
  /(arkose|funcaptcha|recaptcha|hcaptcha|turnstile|challenges\.cloudflare\.com|checkpoint-challenge|captcha-internal|px-captcha|cf-challenge)/i;
const CHALLENGE_STRUCTURAL_TEXT_RE =
  /(quick security check|security verification|let's do a quick verification|unusual activity|verify you are a human|temporarily blocked|tạm thời bị chặn|you're temporarily blocked|you are doing that too much|whoa there, pardner|your account has been locked|just a moment\.\.\.|checking your browser|account restricted|blocked by network security|access to [\w.-]+ was denied|access denied|you don't have authorization to view this page)/i;
const AUTH_TEXT_RE =
  /(sign in to linkedin|join linkedin to view|session_key|authwall|log in to continue|sign in to x\b|log in to x\b|sign in to wellfound|sign in to view more|join or sign in|sign in to see|log in or sign up for threads|say more with threads|log in to see|log in to facebook|log into facebook|see more on facebook|sign in with your google account|to continue to youtube|log in to reddit)/i;
/** Text that only appears on a page whose main content is a password form. */
const PASSWORD_PAGE_TEXT_RE = /(forgot(?:ten)? (?:your )?password|create new account|log in|sign in)/i;

/** Invisible reCAPTCHA v3 / bot-score frames are not a challenge a human has to solve. */
export function isInvisibleChallengeFrameSrc(src: string): boolean {
  return /[?&]size=invisible\b/i.test(src);
}
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
  const structuralText = `${input.title ?? ''} ${(input.structuralAlertTexts ?? []).join(' ')} ${(input.dialogTexts ?? []).join(' ')}`;
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

  const hasLoginForm = markers.includes('login-form');
  const hasPasswordInput = markers.includes('password-input');
  const combinedAuth = `${structuralText} ${hasLoginForm || hasPasswordInput ? bodySample : ''}`;
  if (
    AUTH_URL_RE.test(url) ||
    AUTH_HOST_URL_RE.test(url) ||
    hasLoginForm ||
    (hasPasswordInput && PASSWORD_PAGE_TEXT_RE.test(`${structuralText} ${bodySample}`)) ||
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
    // LinkedIn's sign-in modal loads an invisible reCAPTCHA Enterprise frame (size=invisible, 0x0).
    // That is an auth wall, not a CAPTCHA; only a visible challenge frame counts.
    if (CHALLENGE_MARKER_RE.test(src) && !isInvisibleChallengeFrameSrc(src) && isRenderedElement(frame, 30, 30)) {
      domMarkers.push(src);
    }
  }
  if (doc.querySelector('form[action*="uas/login"], input#username[name="session_key"]')) {
    domMarkers.push('login-form');
  }
  if (doc.querySelector('[data-test-id="premium-upsell-wall"], [data-test="paywall-gate"]')) {
    domMarkers.push('premium-upsell-wall');
  }

  if (Array.from(doc.querySelectorAll('input[type="password"]')).some((el) => isRenderedElement(el))) {
    domMarkers.push('password-input');
  }
  const dialogTexts = Array.from(doc.querySelectorAll('[role="dialog"], [role="alertdialog"], [aria-modal="true"], dialog[open]'))
    .filter((el) => isRenderedElement(el))
    .map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 600))
    .filter(Boolean)
    .slice(0, 10);

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
    dialogTexts,
    bodyTextSample: bodySample,
  });
}

/** Distinctive block-page phrases, only trusted on thin pages (few links) so posts quoting them never trip. */
const THIN_BLOCK_PAGE_RE =
  /(you've been blocked by network security|access to [\w.-]+ was denied|http error 403|this page isn['’]t working|err_access_denied)/i;
const THIN_PAGE_MAX_LINKS = 15;
/** Persistent logged-out banners: the page renders, but only a signed-out teaser of it. */
const LOGGED_OUT_BANNER_RE =
  /(log in or sign up for threads|sign in to view more jobs|join or sign in to find your next job|log in to see more from|create new account\s+log in)/i;

function pathOf(raw: string): string {
  try {
    return new URL(raw).pathname.replace(/\/+$/, '') || '/';
  } catch {
    return '';
  }
}

/**
 * Classifies a collected reader snapshot (CLI side, after collect). Catches walls the in-page
 * scan can miss: redirects to an identity provider or to the site root with a password form
 * (Facebook /me/following -> /), login modals (Threads), and thin block pages (Reddit).
 */
export function detectSnapshotGate(snap: CollectedPageSnapshot, requestedUrl: string): HumanGateCheckResult {
  const finalUrl = snap.finalUrl || snap.url || requestedUrl;
  const base = detectHumanGate({
    url: finalUrl,
    title: snap.title,
    domMarkers: snap.domMarkers,
    structuralAlertTexts: snap.structuralAlertTexts,
    dialogTexts: snap.dialogTexts ?? [],
    bodyTextSample: snap.bodySample,
  });
  if (base.state !== 'CLEAR') return base;

  const thinPage = snap.links.length <= THIN_PAGE_MAX_LINKS;
  const visibleText = `${snap.headings.join(' ')} ${(snap.textLines ?? []).slice(0, 40).join(' ')} ${snap.bodySample.slice(0, 600)}`;
  if (thinPage && THIN_BLOCK_PAGE_RE.test(visibleText)) {
    return {
      state: 'BLOCKED_CHALLENGE',
      reason: `Block page detected (${visibleText.match(THIN_BLOCK_PAGE_RE)?.[0] ?? 'blocked'}) at ${finalUrl}. Resolve in the browser tab.`,
      retryable: false,
    };
  }

  const bannerText = `${(snap.textLines ?? []).slice(0, 300).join(' ')}`;
  if (LOGGED_OUT_BANNER_RE.test(bannerText)) {
    return {
      state: 'BLOCKED_AUTH',
      reason: `Signed-out view detected ("${bannerText.match(LOGGED_OUT_BANNER_RE)?.[0]}") at ${finalUrl}. Sign in manually in the browser tab.`,
      retryable: false,
    };
  }

  const requestedPath = pathOf(requestedUrl);
  const finalPath = pathOf(finalUrl);
  const bounced = requestedPath !== '' && requestedPath !== '/' && finalPath === '/';
  if (bounced && snap.domMarkers.includes('password-input')) {
    return {
      state: 'BLOCKED_AUTH',
      reason: `Redirected from ${requestedUrl} to a sign-in page (${finalUrl}). Sign in manually in the browser tab.`,
      retryable: false,
    };
  }
  return base;
}
