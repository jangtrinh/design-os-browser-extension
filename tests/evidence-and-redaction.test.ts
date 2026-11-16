import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getEvidenceById, recordEvidenceBundle } from '../cli/src/reader/evidence-recorder.js';
import { redactPilotRawDir, redactReaderPayload } from '../cli/src/reader/redaction.js';
import { READER_SCHEMA_VERSION, REDACTION_POLICY_ID } from '../shared/reader-schema.js';

describe('#12 Evidence recorder & third-party-v1 redaction', () => {
  it('matches docs/pilot/2026-11-16-linkedin-live/redact.py output identically (empty diff) across all pilot raw JSONs', () => {
    const pilotDir = resolve(__dirname, '../docs/pilot/2026-11-16-linkedin-live');
    const workDir = mkdtempSync(join(tmpdir(), 'dos-redact-golden-'));
    try {
      cpSync(join(pilotDir, 'raw'), join(workDir, 'raw'), { recursive: true });
      cpSync(join(pilotDir, 'redact.py'), join(workDir, 'redact.py'));
      mkdirSync(join(workDir, 'redacted'), { recursive: true });

      const pythonBin = existsSync('/opt/homebrew/bin/python3') ? '/opt/homebrew/bin/python3' : 'python3';
      execFileSync(pythonBin, ['redact.py'], { cwd: workDir, encoding: 'utf8' });

      const tsOutDir = join(workDir, 'redacted-ts');
      redactPilotRawDir(join(workDir, 'raw'), tsOutDir);

      const pyFiles = readdirSync(join(workDir, 'redacted')).filter((f) => f.endsWith('.json')).sort();
      const tsFiles = readdirSync(tsOutDir).filter((f) => f.endsWith('.json')).sort();
      expect(tsFiles).toEqual(pyFiles);

      for (const f of pyFiles) {
        const pyJson = JSON.parse(readFileSync(join(workDir, 'redacted', f), 'utf8'));
        const tsJson = JSON.parse(readFileSync(join(tsOutDir, f), 'utf8'));
        expect(tsJson, `Diff in redacted/${f}`).toEqual(pyJson);
      }
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it('scrubs third-party PII, keeps Jang allowlist + aggregates, and writes 0700/0600 evidence with verified hashes', () => {
    const evRoot = mkdtempSync(join(tmpdir(), 'dos-evidence-root-'));
    const prevEnv = process.env.BROWSER_AGENT_EVIDENCE_DIR;
    process.env.BROWSER_AGENT_EVIDENCE_DIR = evRoot;
    try {
      const sample = {
        owner_name: 'Jang Trinh',
        owner_handle: 'jangtrinh',
        followers: 8741,
        email_leak: 'someone@example.com',
        phone_leak: '0912345678',
        third_party_viewer: {
          full_name: 'Nguyễn Văn Thử Nghiệm',
          public_identifier: 'nguyen-van-thu-nghiem',
          url: 'https://www.linkedin.com/in/nguyen-van-thu-nghiem/?trk=public_profile',
          third_party: false,
        },
      };

      const { redacted, fieldsRedacted } = redactReaderPayload(sample, {
        site: 'linkedin',
        view: 'analytics.profile_views',
        extraThirdPartyNames: ['Nguyễn Văn Thử Nghiệm'],
      });

      const serialized = JSON.stringify(redacted);
      expect(fieldsRedacted).toBeGreaterThanOrEqual(4);
      expect(serialized).toContain('Jang Trinh');
      expect(serialized).toContain('8741');
      expect(serialized).not.toContain('Nguyễn Văn Thử Nghiệm');
      expect(serialized).not.toContain('nguyen-van-thu-nghiem');
      expect(serialized).not.toContain('someone@example.com');
      expect(serialized).not.toContain('0912345678');

      const recorded = recordEvidenceBundle({
        mode: 'json+screenshot',
        screenshotBase64: Buffer.from('png-test-payload').toString('base64'),
        envelope: {
          ok: true,
          schema: READER_SCHEMA_VERSION,
          site: 'linkedin',
          view: 'analytics.profile_views',
          target: 'https://www.linkedin.com/analytics/profile-views/',
          target_key: 'linkedin:analytics.profile_views:self',
          captured_at: '2026-11-16T18:00:00+07:00',
          source: 'live',
          freshness: { max_age_s: 21600, age_s: 0, stale: false },
          complete: true,
          missing_required: [],
          gate: 'CLEAR',
          pacing: { site: 'linkedin', loads_left_hour: 29, loads_left_day: 149 },
          redaction: { policy: REDACTION_POLICY_ID, fields_redacted: fieldsRedacted },
          evidence_id: 'ev_linkedin_test001',
          audit_id: 'au_test001',
          caller: { bot: 'Growth', routine: 'test' },
          data: redacted,
          notes: [],
        },
      });

      expect(recorded).not.toBeNull();
      expect((statSync(recorded!.dir).mode & 0o777).toString(8)).toBe('700');
      expect((statSync(recorded!.resultPath).mode & 0o777).toString(8)).toBe('600');
      expect((statSync(recorded!.screenshotPath!).mode & 0o777).toString(8)).toBe('600');

      const fetched = getEvidenceById('ev_linkedin_test001');
      expect(fetched.ok).toBe(true);
      expect(fetched.hashesValid).toBe(true);
      expect(fetched.files).toHaveLength(2);
    } finally {
      if (prevEnv === undefined) delete process.env.BROWSER_AGENT_EVIDENCE_DIR;
      else process.env.BROWSER_AGENT_EVIDENCE_DIR = prevEnv;
      rmSync(evRoot, { recursive: true, force: true });
    }
  });
});
