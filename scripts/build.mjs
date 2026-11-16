import * as esbuild from 'esbuild';
import { chmodSync, copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2] ?? 'all';

async function buildCli() {
  const outFile = resolve(root, 'cli/dist/browser-agent.js');
  mkdirSync(dirname(outFile), { recursive: true });
  await esbuild.build({
    entryPoints: [resolve(root, 'cli/src/browser-agent.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    outfile: outFile,
    banner: { js: '#!/usr/bin/env -S node --no-warnings' },
    external: ['ws', 'node:sqlite', 'node:*'],
    logLevel: 'info',
  });
  chmodSync(outFile, 0o755);
}

async function buildExtensionTarget(browserTarget) {
  const distDir = resolve(root, `extension/dist/${browserTarget}`);
  mkdirSync(distDir, { recursive: true });

  await Promise.all([
    esbuild.build({
      entryPoints: [resolve(root, 'extension/src/background/index.ts')],
      bundle: true,
      platform: 'browser',
      format: 'esm',
      target: 'es2022',
      outfile: resolve(distDir, 'background.js'),
      logLevel: 'info',
    }),
    esbuild.build({
      entryPoints: [resolve(root, 'extension/src/adapters/linkedin/passive-observer.ts')],
      bundle: true,
      platform: 'browser',
      format: 'iife',
      target: 'es2022',
      outfile: resolve(distDir, 'passive-observer.js'),
      logLevel: 'info',
    }),
    esbuild.build({
      entryPoints: [resolve(root, 'extension/src/content/isolated-bridge.ts')],
      bundle: true,
      platform: 'browser',
      format: 'iife',
      target: 'es2022',
      outfile: resolve(distDir, 'isolated-bridge.js'),
      logLevel: 'info',
    }),
    esbuild.build({
      entryPoints: [resolve(root, 'extension/src/popup/popup.ts')],
      bundle: true,
      platform: 'browser',
      format: 'esm',
      target: 'es2022',
      outfile: resolve(distDir, 'popup.js'),
      logLevel: 'info',
    }),
  ]);

  copyFileSync(
    resolve(root, `extension/manifests/${browserTarget}.manifest.json`),
    resolve(distDir, 'manifest.json'),
  );
  copyFileSync(
    resolve(root, 'extension/src/popup/popup.html'),
    resolve(distDir, 'popup.html'),
  );
  copyFileSync(
    resolve(root, 'extension/src/popup/popup.css'),
    resolve(distDir, 'popup.css'),
  );
}

async function main() {
  if (target === 'cli' || target === 'all') {
    await buildCli();
  }
  if (target === 'chromium' || target === 'all') {
    await buildExtensionTarget('chromium');
  }
  if (target === 'firefox' || target === 'all') {
    await buildExtensionTarget('firefox');
  }
}

void main();
