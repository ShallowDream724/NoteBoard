/* global window, document, getComputedStyle, performance */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import { preview } from 'vite';
import { installBrowserNativeShell } from './browser-native-shell.mjs';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const native = Boolean(process.env.NOTEBOARD_TEST_CDP);
const out = `.tmp/file-icons/${native ? 'native' : 'browser'}`;
const sampleRoot = process.env.NOTEBOARD_ICON_SAMPLES || 'C:/qa/File-Icon-Samples';
const names = ['Notes.nb', 'README.md', 'Photo.png', 'main.js', 'config.json', 'view.tsx', 'index.html', 'run.log',
  'main.go', 'source.py', 'report.pdf', 'records.xlsx', 'diagram.excalidraw', 'ideas.mindmap', 'data.bitable',
  'flow.drawio', 'chart.mmd', 'chart.infographic', 'formula.tex', 'archive.zip', 'audio.mp3', 'movie.mp4',
  'Dockerfile', '.gitignore', '.env.local', 'package.json', 'vite.config.ts', 'unknown.bin'];
await fs.mkdir(out, { recursive: true });
const server = native ? null : await preview({ configFile: false, build: { outDir: 'dist' }, preview: { host: '127.0.0.1', port: 0, headers: { 'Cache-Control': 'public, max-age=31536000, immutable' } }, logLevel: 'error' });
const browser = native ? await chromium.connectOverCDP(process.env.NOTEBOARD_TEST_CDP)
  : await chromium.launch({ channel: 'msedge', headless: true });
const context = native ? browser.contexts()[0] : await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = native ? context.pages().find(item => !item.url().startsWith('devtools:')) : await context.newPage();
const report = { native, productionBundle: true, browser: await browser.version(), errors: [], limitations: native
  ? ['The isolated application opens its real sample directory through the ordinary command-line path. All IPC remains native.']
  : ['Filesystem IPC is mocked; icon rendering, tree, menus and styles use the production bundle.'] };
page.on('pageerror', error => report.errors.push(String(error)));
const resources = [];
page.on('request', request => { if (/file-icons.*\.svg/.test(request.url())) resources.push(request.url().split('#')[0]); });
const transport = await context.newCDPSession(page);
const spriteRequestIds = new Set(), transfers = [], cacheHits = new Set();
await transport.send('Network.enable');
transport.on('Network.requestWillBeSent', event => {
  if (/file-icons.*\.svg/.test(event.request.url)) spriteRequestIds.add(event.requestId);
});
transport.on('Network.requestServedFromCache', event => {
  if (spriteRequestIds.has(event.requestId)) cacheHits.add(event.requestId);
});
transport.on('Network.loadingFinished', event => {
  if (spriteRequestIds.has(event.requestId)) transfers.push(event.encodedDataLength);
});

async function installFixture() {
  const fixture = ({ sampleRoot, names, native }) => {
    const original = window.__TAURI_INTERNALS__.invoke;
    window.__TAURI_INTERNALS__.invoke = async (command, args) => {
      if (command === 'plugin:dialog|open' && args?.options?.directory) return sampleRoot;
      if (!native && command === 'read_native_headers') return [];
      if (!native && command === 'read_dir') {
        const isStress = args.path.endsWith('/stress');
        const rows = isStress ? Array.from({ length: 1000 }, (_, index) => `file-${index}.${['md', 'png', 'json', 'js', 'go'][index % 5]}`) : names;
        const files = rows.map(name => ({ name, path: `${args.path}/${name}`, isDir: false, kind: 'code', size: 12, mtime: 0, isHidden: name.startsWith('.'), isSymlink: false }));
        if (!isStress) files.unshift({ name: 'stress', path: `${args.path}/stress`, isDir: true, kind: null, size: null, mtime: null, isHidden: false, isSymlink: false });
        return files;
      }
      return original(command, args);
    };
  };
  if (!native) await page.addInitScript(fixture, { sampleRoot, names, native });
}

const snapshot = () => page.evaluate(() => [...document.querySelectorAll('[data-file-icon]')].map(icon => {
  const bbox = icon.querySelector('use').getBBox();
  return { symbol: icon.dataset.fileIcon, size: icon.getAttribute('width'), color: getComputedStyle(icon).color,
    secondary: getComputedStyle(icon).getPropertyValue('--file-icon-secondary').trim(), bbox: { width: bbox.width, height: bbox.height },
    href: icon.querySelector('use').getAttribute('href') };
}));

try {
  if (!native) await installBrowserNativeShell(page);
  await installFixture();
  if (!native) await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
  await page.getByRole('button', { name: '新建或打开', exact: true }).waitFor();
  const guide = page.getByRole('button', { name: '退出引导', exact: true });
  if (await guide.isVisible()) await guide.click();
  if (!native) {
    await page.getByRole('button', { name: '新建或打开', exact: true }).click();
    await page.getByRole('menuitem', { name: /打开文件夹/ }).click();
  }
  await page.locator('[data-explorer-row]').first().waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('[data-file-icon] use')].every(use => use.getBBox().width > 0));
  report.initial = await snapshot();
  assert(report.initial.some(icon => icon.symbol === 'lang-markdown'));
  assert(report.initial.some(icon => icon.symbol === 'image-duo'));
  for (const theme of ['chen-guang', 'hu-po', 'mo-ye']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    report[theme] = await snapshot();
    assert(report[theme].every(icon => icon.bbox.width > 0 && icon.bbox.height > 0));
    await page.screenshot({ path: `${out}/${theme}.png` });
  }
  const light = report['chen-guang'].find(icon => icon.symbol === 'image-duo');
  const dark = report['mo-ye'].find(icon => icon.symbol === 'image-duo');
  assert.notEqual(light.color, dark.color);
  report.spriteRequests = [...new Set(resources)];
  assert(report.spriteRequests.length <= 2, 'Only two shared sprite resources are needed');
  const initialTransferred = transfers.reduce((sum, bytes) => sum + bytes, 0);

  if (!native) {
    const cdp = await context.newCDPSession(page);
    const stress = page.locator('[data-explorer-row]').filter({ hasText: /^stress$/ });
    const memory = async () => {
      await cdp.send('HeapProfiler.collectGarbage');
      const heap = await cdp.send('Runtime.getHeapUsage');
      const dom = await cdp.send('Memory.getDOMCounters');
      return { usedSize: heap.usedSize, ...dom };
    };
    report.memory = [];
    for (let round = 0; round < 10; round++) {
      const start = performance.now();
      await stress.click();
      await page.waitForFunction(() => document.querySelectorAll('[data-explorer-row]').length >= 1000);
      const expanded = await memory();
      await stress.click();
      await page.waitForFunction(() => document.querySelectorAll('[data-explorer-row]').length < 1000);
      const collapsed = await memory();
      report.memory.push({ round, cycleMs: performance.now() - start, expanded, collapsed });
    }
    const steady = report.memory.slice(-5).map(item => item.collapsed);
    assert(Math.max(...steady.map(item => item.usedSize)) - Math.min(...steady.map(item => item.usedSize)) < 2 * 1024 * 1024, 'Steady heap keeps growing');
    assert(Math.max(...steady.map(item => item.nodes)) - Math.min(...steady.map(item => item.nodes)) < 100, 'Detached DOM keeps growing');
    report.spriteRequestsAfterCycles = resources.length;
    report.spriteTransport = { initialTransferred, finalTransferred: transfers.reduce((sum, bytes) => sum + bytes, 0), cacheHits: cacheHits.size };
    assert(new Set(resources).size <= 2, 'Repeated mounts must reuse the two sprite URLs');
    assert.equal(report.spriteTransport.finalTransferred, initialTransferred, 'Repeated mounts must not transfer the sprite again');
  }
  assert.equal(report.errors.length, 0);
  report.passed = true;
} finally {
  if (!report.passed) {
    report.failureState = await page.evaluate(() => ({ text: document.body.innerText.slice(-3000), calls: window.__qaIpcCalls?.slice(-20) })).catch(() => null);
    await page.screenshot({ path: `${out}/failure.png` }).catch(() => {});
  }
  await fs.writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n');
  await transport.detach();
  await browser.close();
  await server?.close();
}
console.log(JSON.stringify({ passed: report.passed, native, icons: report.initial?.length, out, spriteRequests: report.spriteRequests, memory: report.memory?.slice(-1) }, null, 2));
