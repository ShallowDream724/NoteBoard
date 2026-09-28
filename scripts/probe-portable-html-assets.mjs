import { build } from 'vite';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const directory = await mkdtemp(join(tmpdir(), 'noteboard-asset-probe-'));
const bundle = join(directory, 'probe.js');
const result = await build({
  configFile: false,
  build: {
    write: false,
    minify: false,
    lib: { entry: resolve('test/native/portableHtmlAssetProbe.ts'), name: 'AssetProbe', formats: ['iife'] },
  },
});
const output = Array.isArray(result) ? result[0] : result;
const js = output.output.find(file => file.type === 'chunk');
if (!js) throw new Error('Vite did not produce the probe bundle');
await writeFile(bundle, js.code);
try {
  const run = spawnSync('cargo', [
    'run', '--release', '--features', 'tauri/custom-protocol', '--example', 'portable_html_asset_smoke', '--', bundle,
  ], { cwd: resolve('src-tauri'), stdio: 'inherit' });
  if (run.error) throw run.error;
  process.exitCode = run.status ?? 1;
} finally {
  await rm(directory, { recursive: true, force: true });
}
