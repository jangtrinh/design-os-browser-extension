import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');

describe('Cross-browser tier manifests', () => {
  it('ships Tier-1 Chromium MV3 manifest without chrome.debugger permission', () => {
    const raw = JSON.parse(
      readFileSync(resolve(ROOT, 'extension/manifests/chromium.manifest.json'), 'utf8'),
    ) as {
      manifest_version: number;
      permissions: string[];
      background: { service_worker?: string; scripts?: string[] };
      content_scripts: Array<{ world?: string; run_at?: string; js: string[] }>;
    };

    expect(raw.manifest_version).toBe(3);
    expect(raw.permissions).not.toContain('debugger');
    expect(raw.background.service_worker).toBe('background.js');
    expect(raw.content_scripts.some((c) => c.world === 'MAIN' && c.run_at === 'document_start')).toBe(
      true,
    );
  });

  it('ships Tier-2 Firefox MV3 manifest with background.scripts and gecko metadata', () => {
    const raw = JSON.parse(
      readFileSync(resolve(ROOT, 'extension/manifests/firefox.manifest.json'), 'utf8'),
    ) as {
      manifest_version: number;
      permissions: string[];
      background: { service_worker?: string; scripts?: string[] };
      browser_specific_settings?: { gecko?: { id?: string; strict_min_version?: string } };
    };

    expect(raw.manifest_version).toBe(3);
    expect(raw.permissions).not.toContain('debugger');
    expect(raw.background.service_worker).toBeUndefined();
    expect(raw.background.scripts).toEqual(['background.js']);
    expect(raw.browser_specific_settings?.gecko?.id).toBe('browser-agent@design-os.local');
  });
});
