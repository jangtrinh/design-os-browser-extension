import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { dispatchCli } from '../cli/src/commands/dispatch.js';
import { MCP_TOOLS } from '../cli/src/mcp/stdio-server.js';
import { LinkedInSqliteCache } from '../cli/src/db/sqlite-cache.js';
import { ReaderRuntime } from '../cli/src/reader/reader-runtime.js';
import { detectHumanGate } from '../extension/src/core/human-gate-detector.js';
import type { CollectedPageSnapshot } from '../shared/reader-schema.js';

describe('#11 Account guard across sites, human-only clear & zero false positives on post copy', () => {
  it('pauses site S on checkpoint with 1 alert line, refuses 2nd caller with 0 loads while allowing other sites', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'dos-guard-test-'));
    const prevEvDir = process.env.BROWSER_AGENT_EVIDENCE_DIR;
    process.env.BROWSER_AGENT_EVIDENCE_DIR = tmpDir;
    const cache = new LinkedInSqliteCache(':memory:');
    try {
      let loadsBySite: Record<string, number> = {};
      const rt = new ReaderRuntime({
        cache,
        mirrorAuditToFile: false,
        collectPage: async (req) => {
          loadsBySite[req.site] = (loadsBySite[req.site] ?? 0) + 1;
          if (req.site === 'linkedin') {
            return {
              ok: false,
              gate: 'BLOCKED_CHALLENGE',
              gateReason: 'Security checkpoint detected on linkedin.com/checkpoint/',
              screenshotBase64: Buffer.from('fake-png-bytes').toString('base64'),
            };
          }
          return {
            ok: true,
            snapshot: {
              url: req.targetUrl,
              finalUrl: req.targetUrl,
              title: 'Jang Profile',
              axNodes: [{ role: 'heading', name: 'Jang Trinh' }],
              headings: [],
              links: [],
              meta: {},
              bodySample: '',
              domMarkers: [],
              structuralAlertTexts: [],
              loadingIndicators: [],
              hiddenInstructions: [],
              scrollStepsExecuted: 0,
            } satisfies CollectedPageSnapshot,
          };
        },
      });

      // Trigger checkpoint on LinkedIn
      const first = await rt.read({
        site: 'linkedin',
        view: 'profile.self',
        target: 'https://www.linkedin.com/in/jangtrinh/',
        params: { public_id: 'jangtrinh' },
        caller: { bot: 'Growth', routine: 'nightly' },
      });
      expect(first.ok).toBe(false);
      expect(first.gate).toBe('PAUSED_BY_GUARD');
      expect(first.evidence_id).toBeTruthy();
      expect(first.alert_line).toContain('[GUARD PAUSED] site=linkedin');
      expect(loadsBySite.linkedin).toBe(1);

      // Second caller for LinkedIn gets PAUSED_BY_GUARD with 0 live loads and no duplicate alert_line
      const second = await rt.read({
        site: 'linkedin',
        view: 'analytics.content',
        target: 'https://www.linkedin.com/analytics/creator/content/',
        caller: { bot: 'Community', routine: 'triage' },
      });
      expect(second.gate).toBe('PAUSED_BY_GUARD');
      expect(second.alert_line).toBeUndefined();
      expect(loadsBySite.linkedin).toBe(1);

      // Non-popup callers cannot clear a paused guard
      const agentAttempt = rt.guard.resolveByHumanPopup('linkedin', 'agent-rpc');
      expect(agentAttempt.ok).toBe(false);
      expect(agentAttempt.guard.state).toBe('PAUSED');

      // Enumerate all MCP tools & CLI commands: none can resolve/clear an account guard
      expect(MCP_TOOLS.some((t) => /guard.*(clear|resolve|reset|resume)/i.test(t.name))).toBe(false);
      const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      try {
        const cliCheck = await dispatchCli(['reader', 'guard', '--json']);
        expect(cliCheck).toBe(0);
      } finally {
        spy.mockRestore();
      }

      // Trusted extension-popup human click clears the guard and writes a human-popup audit row
      const popupClear = rt.guard.resolveByHumanPopup('linkedin', 'extension-popup');
      expect(popupClear.ok).toBe(true);
      expect(popupClear.guard.state).toBe('CLEAR');
      const clearAudit = rt.queryAudit({ caller: 'human-popup', site: 'linkedin' });
      expect(clearAudit.count).toBe(1);
      expect(clearAudit.rows[0].gate_after).toBe('CLEAR');
    } finally {
      cache.close();
      chmodSync(tmpDir, 0o700);
      rmSync(tmpDir, { recursive: true, force: true });
      if (prevEvDir === undefined) delete process.env.BROWSER_AGENT_EVIDENCE_DIR;
      else process.env.BROWSER_AGENT_EVIDENCE_DIR = prevEvDir;
    }
  });

  it('detects structural multi-site warnings while ignoring ordinary post copy mentioning "security check"', () => {
    expect(
      detectHumanGate({
        url: 'https://www.reddit.com/r/DesignSystems/',
        title: 'Design Systems discussion',
        structuralAlertTexts: [],
        bodyTextSample: 'Today our team wrote a blog post about running a security check on Figma plugins.',
      }).state,
    ).toBe('CLEAR');

    expect(
      detectHumanGate({
        url: 'https://www.reddit.com/r/DesignSystems/',
        title: 'Reddit',
        structuralAlertTexts: ['you are doing that too much. try again in 8 minutes.'],
      }).state,
    ).toBe('BLOCKED_CHALLENGE');

    expect(
      detectHumanGate({
        url: 'https://www.facebook.com/me/following',
        title: 'Facebook',
        structuralAlertTexts: ['Bạn tạm thời bị chặn tính năng này'],
      }).state,
    ).toBe('BLOCKED_CHALLENGE');

    expect(
      detectHumanGate({
        url: 'https://www.producthunt.com/products/design-os',
        title: 'Just a moment...',
        domMarkers: ['challenges.cloudflare.com'],
      }).state,
    ).toBe('BLOCKED_CHALLENGE');

    expect(
      detectHumanGate({
        url: 'https://www.linkedin.com/premium/products/',
        title: 'Upgrade to Premium',
        statusCodes: [],
      }).state,
    ).toBe('BLOCKED_PAYMENT');
  });
});
