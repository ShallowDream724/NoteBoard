/* global window, document */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { preview } from 'vite';
import { installBrowserNativeShell } from './browser-native-shell.mjs';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const cdp = process.env.NOTEBOARD_TEST_CDP, paths = cdp ? JSON.parse(process.env.NOTEBOARD_RESTORE_PATHS) : ['C:/qa/one.png', 'C:/qa/two.png'];
const out = `.tmp/resource-restore/${cdp ? 'native' : 'browser'}`;
await fs.mkdir(out, { recursive: true });
const server = cdp ? null : await preview({ configFile: false, build: { outDir: 'dist' }, preview: { host: '127.0.0.1', port: 15171 }, logLevel: 'error' });
const browser = cdp ? await chromium.connectOverCDP(cdp) : await chromium.launch({ channel: 'msedge', headless: true });
const context = cdp ? browser.contexts()[0] : await browser.newContext({ viewport: { width: 1440, height: 950 } });
const page = cdp ? context.pages().find(page => !page.url().startsWith('devtools:')) : await context.newPage();
const protocol = await context.newCDPSession(page), report = { native: !!cdp, images: [], errors: [] };
if (cdp) await protocol.send('Emulation.setFocusEmulationEnabled', { enabled: true });
page.on('pageerror', error => report.errors.push(String(error)));
const basename = path => path.split(/[\\/]/).pop();
const memory = async () => { await protocol.send('HeapProfiler.collectGarbage'); return { ...(await protocol.send('Runtime.getHeapUsage')), ...(await protocol.send('Memory.getDOMCounters')) }; };
async function show(path) {
  await page.getByRole('tab', { name: basename(path), exact: true }).click();
  const image = page.locator('img[data-image-preview-transform]:visible').last();
  await image.waitFor();
  const ready = await page.waitForFunction(name => [...document.querySelectorAll('img[data-image-preview-transform]')].some(image => image.alt === name && image.complete && image.naturalWidth > 0), basename(path));
  await ready.dispose();
  return image.evaluate(image => ({ name: image.alt, width: image.naturalWidth, height: image.naturalHeight }));
}
try {
  if (!cdp) {
    await installBrowserNativeShell(page);
    await page.addInitScript(paths => {
      const invoke = window.__TAURI_INTERNALS__.invoke;
      window.__qaImagePrepareCount = 0;
      window.__TAURI_INTERNALS__.convertFileSrc = () => 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aip8AAAAASUVORK5CYII=';
      window.__TAURI_INTERNALS__.invoke = async (command, args) => {
        if (command === 'load_settings') { const settings = await invoke(command, args); settings.file.restoreSession = true; return settings; }
        if (command === 'load_session') return { schemaVersion: 1, savedAt: Date.now(), windows: [{ seq: 0, explorerRoot: '',
          layout: { explorerVisible: false, explorerWidth: 260, outlineVisible: false, outlineWidth: 240 }, activeKey: paths[0],
          tabs: paths.map(key => ({ key, sourcePath: key, stagedPath: null, displayName: key.split('/').pop(), isPinned: false, viewMode: null })) }] };
        if (command === 'path_exists') return { exists: true, isDir: false };
        if (command === 'prepare_document') { window.__qaImagePrepareCount++; return { type: 'image', key: args.path, displayName: args.path.split('/').pop(), dirPath: 'C:/qa', size: 1, mtime: 1 }; }
        if (command === 'register_document') return { type: 'ok' };
        return invoke(command, args);
      };
    }, paths);
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
  }
  await page.getByRole('tab', { name: basename(paths[0]), exact: true }).waitFor();
  if (!cdp) assert.equal(await page.evaluate(() => window.__qaImagePrepareCount), 0, 'Home restores descriptors without loading image resources');
  for (const path of paths) report.images.push(await show(path));
  await page.screenshot({ path: `${out}/restored-image.png` });
  if (!cdp) assert.equal(await page.evaluate(() => window.__qaImagePrepareCount), 2);
  const before = await memory();
  for (let index = 0; index < 20; index++) for (const path of paths) await show(path);
  const after = await memory();
  assert(after.usedSize - before.usedSize < 5 * 1024 * 1024, 'Repeated restored-image switching retains bounded heap');
  assert(after.nodes - before.nodes < 100, 'Image viewers do not accumulate detached DOM');
  assert(after.jsEventListeners - before.jsEventListeners < 50, 'Image listeners do not accumulate');
  if (!cdp) assert.equal(await page.evaluate(() => window.__qaImagePrepareCount), 2, 'Tab switching never reloads image metadata');
  report.memory = { cycles: 20, before, after };
  if (cdp && process.env.NOTEBOARD_INTERACTION_PATH) {
    await page.keyboard.press('Control+o');
    await page.getByRole('textbox', { name: '文件或文件夹路径', exact: true }).fill(process.env.NOTEBOARD_INTERACTION_PATH);
    await page.getByRole('button', { name: '打开', exact: true }).click();
    await page.getByRole('tab', { name: basename(process.env.NOTEBOARD_INTERACTION_PATH), exact: true }).waitFor();
    // Parked viewers intentionally remain mounted. End the image fixture before
    // direct editor probes, whose :visible selector is not an activation oracle.
    for (const path of paths) await page.getByRole('button', { name: `关闭 ${basename(path)}`, exact: true }).click();
    await page.getByRole('tab', { name: basename(process.env.NOTEBOARD_INTERACTION_PATH), exact: true }).click();
    await page.locator('.nb-prose.ProseMirror[contenteditable="true"]:visible').last().waitFor();
  }
  assert.equal(report.errors.length, 0); report.passed = true;
} finally {
  if (!report.passed) await page.screenshot({ path: `${out}/failure.png` }).catch(() => {});
  await fs.writeFile(`${out}/results.json`, JSON.stringify(report, null, 2));
  await protocol.detach(); await browser.close(); await server?.httpServer.close();
}
console.log(JSON.stringify({ passed: report.passed, out, imageCount: report.images.length }));
