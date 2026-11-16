import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { formatIsoWithOffset, mintUlid } from '../../../shared/hash.js';
import type { EvidenceMode, ReaderEnvelope } from '../../../shared/reader-schema.js';

export function resolveEvidenceRoot(): string {
  return (
    process.env.BROWSER_AGENT_EVIDENCE_DIR?.trim() ||
    join(homedir(), '.design-os-browser-extension', 'evidence')
  );
}

export interface EvidenceManifest {
  evidence_id: string;
  created_at: string;
  mode: EvidenceMode;
  envelope: Omit<ReaderEnvelope<unknown>, 'data'>;
  files: Record<string, { sha256: string; bytes: number }>;
}

export interface RecordedEvidence {
  evidence_id: string;
  dir: string;
  manifestPath: string;
  resultPath: string;
  screenshotPath?: string;
  manifest: EvidenceManifest;
}

function writePrivateFile(path: string, data: string | Buffer): { sha256: string; bytes: number } {
  const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
  writeFileSync(path, buf, { mode: 0o600 });
  chmodSync(path, 0o600);
  const sha256 = createHash('sha256').update(buf).digest('hex');
  return { sha256, bytes: buf.byteLength };
}

function decodePngBase64(dataUrlOrBase64: string): Buffer {
  const commaIdx = dataUrlOrBase64.indexOf(',');
  const b64 = commaIdx !== -1 ? dataUrlOrBase64.slice(commaIdx + 1) : dataUrlOrBase64;
  return Buffer.from(b64, 'base64');
}

function truncateListsForEvidence(data: unknown, maxItems: number): unknown {
  if (Array.isArray(data)) {
    return data.slice(0, maxItems);
  }
  if (data && typeof data === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      if (Array.isArray(v) && v.length > maxItems) {
        out[k] = v.slice(0, maxItems);
        out[`${k}_total_count`] = v.length;
      } else {
        out[k] = v;
      }
    }
    return out;
  }
  return data;
}

export function recordEvidenceBundle(params: {
  mode: EvidenceMode;
  envelope: ReaderEnvelope<unknown>;
  screenshotBase64?: string;
  maxListItems?: number;
  now?: Date;
}): RecordedEvidence | null {
  if (params.mode === 'off') return null;
  const now = params.now ?? new Date();
  const dateDir = formatIsoWithOffset(now).slice(0, 10);
  const evidenceId = params.envelope.evidence_id || mintUlid(`ev_${params.envelope.site}`, now.getTime());
  const rootDir = resolveEvidenceRoot();
  mkdirSync(rootDir, { recursive: true, mode: 0o700 });
  chmodSync(rootDir, 0o700);
  const dayDir = join(rootDir, dateDir);
  mkdirSync(dayDir, { recursive: true, mode: 0o700 });
  chmodSync(dayDir, 0o700);
  const dir = join(dayDir, evidenceId);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);

  const boundedData = truncateListsForEvidence(params.envelope.data, params.maxListItems ?? 50);
  const resultPath = join(dir, 'result.redacted.json');
  const files: EvidenceManifest['files'] = {};
  files['result.redacted.json'] = writePrivateFile(
    resultPath,
    `${JSON.stringify({ ...params.envelope, evidence_id: evidenceId, data: boundedData }, null, 2)}\n`,
  );

  let screenshotPath: string | undefined;
  if (params.mode === 'json+screenshot' && params.screenshotBase64) {
    screenshotPath = join(dir, 'screenshot.png');
    files['screenshot.png'] = writePrivateFile(screenshotPath, decodePngBase64(params.screenshotBase64));
  }

  const { data: _omitted, ...headerOnly } = params.envelope;
  const manifest: EvidenceManifest = {
    evidence_id: evidenceId,
    created_at: formatIsoWithOffset(now),
    mode: params.mode,
    envelope: { ...headerOnly, evidence_id: evidenceId },
    files,
  };
  const manifestPath = join(dir, 'manifest.json');
  writePrivateFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  return { evidence_id: evidenceId, dir, manifestPath, resultPath, screenshotPath, manifest };
}

export function getEvidenceById(evidenceId: string): {
  ok: boolean;
  evidence_id: string;
  dir?: string;
  manifest?: EvidenceManifest;
  files?: string[];
  hashesValid?: boolean;
  error?: string;
} {
  const root = resolveEvidenceRoot();
  if (!existsSync(root)) return { ok: false, evidence_id: evidenceId, error: 'EVIDENCE_NOT_FOUND' };
  for (const day of readdirSync(root).sort().reverse()) {
    const candidate = join(root, day, evidenceId);
    const manifestPath = join(candidate, 'manifest.json');
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as EvidenceManifest;
      let hashesValid = true;
      for (const [rel, meta] of Object.entries(manifest.files)) {
        const fPath = join(candidate, rel);
        if (!existsSync(fPath)) {
          hashesValid = false;
          continue;
        }
        const actualHash = createHash('sha256').update(readFileSync(fPath)).digest('hex');
        if (actualHash !== meta.sha256) hashesValid = false;
      }
      return {
        ok: true,
        evidence_id: evidenceId,
        dir: candidate,
        manifest,
        files: Object.keys(manifest.files).map((f) => join(candidate, f)),
        hashesValid,
      };
    }
  }
  return { ok: false, evidence_id: evidenceId, error: 'EVIDENCE_NOT_FOUND' };
}
