import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SHIPPED_ADAPTER_IDS } from '../shared/capability-tier.js';

describe('Finding #12: /health adapterIds lists every shipped adapter', () => {
  it('has one id per adapter directory (linkedin keeps its historical id)', () => {
    const root = join(__dirname, '..', 'extension', 'src', 'adapters');
    const dirs = readdirSync(root).filter((d) => statSync(join(root, d)).isDirectory());
    const expected = dirs.map((d) => (d === 'linkedin' ? 'linkedin-zero-drift' : d)).sort();
    expect([...SHIPPED_ADAPTER_IDS].sort()).toEqual(expected);
  });

});
