import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LinkedInSqliteCache } from '../cli/src/db/sqlite-cache.js';
import { resolveGuardScopeKey } from '../cli/src/reader/account-guard.js';
import { ReaderRuntime } from '../cli/src/reader/reader-runtime.js';
import {
  detectHumanGate,
  detectSnapshotGate,
  isInvisibleChallengeFrameSrc,
} from '../extension/src/core/human-gate-detector.js';
import type { CollectedPageSnapshot } from '../shared/reader-schema.js';

// Fixtures are sanitized captures from a fresh logged-out Chromium profile (2026-11-17 routine
// findings). Third-party names, tokens and query strings are removed.
const fixture = (name: string): CollectedPageSnapshot =>
  JSON.parse(readFileSync(join(__dirname, 'fixtures', 'walls', `${name}.snapshot.json`), 'utf8')) as CollectedPageSnapshot;

const cleanSnapshot = (url: string, overrides: Partial<CollectedPageSnapshot> = {}): CollectedPageSnapshot => ({
  url,
  finalUrl: url,
  title: 'Jang Trinh profile',
  axNodes: [{ role: 'heading', name: 'Jang Trinh' }],
  headings: [],
  links: Array.from({ length: 30 }, (_, i) => ({ text: `Link ${i}`, href: `${url}#${i}` })),
  meta: {},
  bodySample: 'Ordinary page copy. A post that talks about a security check and how to sign in is still a post.',
  domMarkers: [],
  structuralAlertTexts: [],
  loadingIndicators: [],
  hiddenInstructions: [],
  scrollStepsExecuted: 0,
  textLines: ['Jang Trinh', 'Ordinary page copy.'],
  dialogTexts: [],
  ...overrides,
});

describe('Bug 1: login walls and block pages fail loud (never ok/complete)', () => {
  it.each([
    ['facebook-login-redirect', 'https://www.facebook.com/me/following', 'BLOCKED_AUTH'],
    ['threads-login-modal', 'https://www.threads.com/@jangtrinhsg/post/DfMKyrKFT3i', 'BLOCKED_AUTH'],
    ['reddit-network-block', 'https://www.reddit.com/r/FigmaDesign', 'BLOCKED_CHALLENGE'],
    ['youtube-studio-google-signin', 'https://studio.youtube.com/', 'BLOCKED_AUTH'],
  ] as const)('%s is classified %s', (name, requested, expected) => {
    const res = detectSnapshotGate(fixture(name), requested);
    expect(res.state).toBe(expected);
    expect(res.reason).toBeTruthy();
  });

  it('classifies a redirect to Google sign-in by URL alone (engine uses the real tab URL)', () => {
    expect(detectHumanGate({ url: 'https://accounts.google.com/v3/signin/identifier?continue=x' }).state).toBe('BLOCKED_AUTH');
    expect(detectHumanGate({ url: 'https://www.reddit.com/r/FigmaDesign/?js_challenge=1' }).state).toBe('BLOCKED_CHALLENGE');
  });

  it('does not flag an ordinary readable page (zero false positives)', () => {
    const snap = cleanSnapshot('https://www.linkedin.com/in/jangtrinh/');
    expect(detectSnapshotGate(snap, snap.url).state).toBe('CLEAR');
    const fbPost = cleanSnapshot('https://www.facebook.com/jangtrinh/posts/1', {
      bodySample: 'How I log in to Facebook faster: use a password manager.',
      textLines: ['How I log in to Facebook faster', 'use a password manager.'],
    });
    expect(detectSnapshotGate(fbPost, fbPost.url).state).toBe('CLEAR');
  });

  it('a wall snapshot returned with ok:true becomes PAUSED_BY_GUARD with detected_gate, not ok/complete', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'dos-walls-test-'));
    const prevEvDir = process.env.BROWSER_AGENT_EVIDENCE_DIR;
    process.env.BROWSER_AGENT_EVIDENCE_DIR = tmpDir;
    const cache = new LinkedInSqliteCache(':memory:');
    try {
      const rt = new ReaderRuntime({
        cache,
        mirrorAuditToFile: false,
        collectPage: async () => ({ ok: true, gate: 'CLEAR', snapshot: fixture('youtube-studio-google-signin') }),
      });
      const env = await rt.read({
        site: 'generic',
        view: 'page.snapshot',
        target: 'https://studio.youtube.com/',
        caller: { bot: 'Growth', routine: 'yt-studio' },
      });
      expect(env.ok).toBe(false);
      expect(env.complete).toBe(false);
      expect(env.gate).toBe('PAUSED_BY_GUARD');
      expect((env.data as Record<string, unknown>).detected_gate).toBe('BLOCKED_AUTH');
    } finally {
      cache.close();
      rmSync(tmpDir, { recursive: true, force: true });
      if (prevEvDir === undefined) delete process.env.BROWSER_AGENT_EVIDENCE_DIR;
      else process.env.BROWSER_AGENT_EVIDENCE_DIR = prevEvDir;
    }
  });
});

describe('Bug 8: LinkedIn jobs sign-in modal is AUTH (not CAPTCHA) and the guard is per job board', () => {
  it('the logged-out LinkedIn jobs page is BLOCKED_AUTH, not BLOCKED_CHALLENGE', () => {
    const res = detectSnapshotGate(fixture('linkedin-jobs-signin-modal'), 'https://www.linkedin.com/jobs/search/');
    expect(res.state).toBe('BLOCKED_AUTH');
  });

  it('ignores the invisible reCAPTCHA Enterprise frame LinkedIn embeds on every logged-out page', () => {
    expect(isInvisibleChallengeFrameSrc('https://www.google.com/recaptcha/enterprise/anchor?ar=1&k=SITEKEY&hl=en&size=invisible')).toBe(true);
    expect(isInvisibleChallengeFrameSrc('https://www.google.com/recaptcha/api2/anchor?ar=1&k=SITEKEY&size=normal')).toBe(false);
  });

  it('scopes the jobs and generic guards per host', () => {
    expect(resolveGuardScopeKey('jobs', 'https://www.linkedin.com/jobs/search/')).toBe('jobs:www.linkedin.com');
    expect(resolveGuardScopeKey('jobs', 'https://dribbble.com/jobs')).toBe('jobs:dribbble.com');
    expect(resolveGuardScopeKey('linkedin', 'https://www.linkedin.com/feed/')).toBe('linkedin');
  });

  it('a LinkedIn jobs wall pauses only LinkedIn jobs; Dribbble and Wellfound keep reading', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'dos-jobs-guard-'));
    const prevEvDir = process.env.BROWSER_AGENT_EVIDENCE_DIR;
    process.env.BROWSER_AGENT_EVIDENCE_DIR = tmpDir;
    const cache = new LinkedInSqliteCache(':memory:');
    const loads: string[] = [];
    try {
      const rt = new ReaderRuntime({
        cache,
        mirrorAuditToFile: false,
        collectPage: async (req) => {
          loads.push(new URL(req.targetUrl).hostname);
          if (req.targetUrl.includes('linkedin.com')) {
            return { ok: true, gate: 'CLEAR', snapshot: fixture('linkedin-jobs-signin-modal') };
          }
          return { ok: true, gate: 'CLEAR', snapshot: cleanSnapshot(req.targetUrl, { title: 'Design jobs' }) };
        },
      });
      const caller = { bot: 'Career', routine: 'jobs-scan' };
      const li = await rt.read({ site: 'jobs', view: 'search.results', target: 'https://www.linkedin.com/jobs/search/', caller });
      expect(li.gate).toBe('PAUSED_BY_GUARD');
      expect((li.data as Record<string, unknown>).detected_gate).toBe('BLOCKED_AUTH');

      const dr = await rt.read({ site: 'jobs', view: 'search.results', target: 'https://dribbble.com/jobs', caller });
      expect(dr.gate).not.toBe('PAUSED_BY_GUARD');
      expect(loads).toContain('dribbble.com');

      expect(rt.guard.getGuard('jobs', 'https://www.linkedin.com/jobs/view/1').state).toBe('PAUSED');
      expect(rt.guard.getGuard('jobs', 'https://wellfound.com/jobs').state).toBe('CLEAR');
      expect(rt.guard.listGuards().some((g) => String(g.site) === 'jobs:www.linkedin.com' && g.state === 'PAUSED')).toBe(true);

      // The human popup can clear the per-host guard by its listed key.
      expect(rt.guard.resolveByHumanPopup('jobs:www.linkedin.com', 'extension-popup').ok).toBe(true);
      expect(rt.guard.getGuard('jobs', 'https://www.linkedin.com/jobs/search/').state).toBe('CLEAR');
    } finally {
      cache.close();
      rmSync(tmpDir, { recursive: true, force: true });
      if (prevEvDir === undefined) delete process.env.BROWSER_AGENT_EVIDENCE_DIR;
      else process.env.BROWSER_AGENT_EVIDENCE_DIR = prevEvDir;
    }
  });
});
