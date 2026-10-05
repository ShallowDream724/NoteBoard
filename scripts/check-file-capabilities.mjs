/* global window, document, Worker, performance */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { preview } from 'vite';
import { installBrowserNativeShell } from './browser-native-shell.mjs';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = '.tmp/file-capabilities/browser';
await fs.mkdir(out, { recursive: true });
const server = await preview({ configFile: false, build: { outDir: 'dist' }, preview: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
const page = await context.newPage();
const report = { productionBundle: true, boundary: 'Native filesystem IPC is mocked; real production editors, workers, styles and menus are exercised.', errors: [], cycles: [] };
page.on('pageerror', error => report.errors.push(String(error)));
await installBrowserNativeShell(page);
await page.addInitScript(() => {
  const original = window.__TAURI_INTERNALS__.invoke;
  const prefix = 'C:/qa/File-Capabilities';
  const line = Array(30).fill('x').join(',');
  const csv = `${line}\n`.repeat(99999) + Array(29).fill('x').join(',') + ',END';
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="280"><rect width="480" height="280" rx="20" fill="#d9e7f6"/><circle cx="240" cy="140" r="72" fill="#3878de"/></svg>';
  const files = [
    { name: 'stress.csv', language: 'plaintext', kind: 'code', content: csv },
    { name: 'settings.json', language: 'json', kind: 'code', content: '{"id":9007199254740993,"id":-0,"scientific":1.2300e+4,"label":"中文"}' },
    { name: 'large.json', language: 'json', kind: 'code', content: JSON.stringify({ values: Array.from({ length: 10000 }, (_, i) => i) }) },
    { name: 'settings.yaml', language: 'yaml', kind: 'code', content: 'title: "value\twith tab"\nitems:\n  - one\n  - two\n' },
    { name: '.env.production', language: 'ini', kind: 'code', content: 'API_URL=https://example.test\nPORT=8080\n' },
    { name: 'main.go', language: 'go', kind: 'code', content: 'package main\n\nfunc main() { println("hello") }\n' },
    { name: 'vector.svg', language: 'xml', kind: 'image', content: svg },
    { name: 'design.psd', language: 'plaintext', kind: 'unsupported', content: null },
  ];
  window.__qaWorkerStats = { created: 0, live: 0, terminated: 0 };
  window.__qaAnalysisResults = [];
  const NativeWorker = Worker;
  window.Worker = class extends NativeWorker {
    constructor(...args) { super(...args); window.__qaWorkerStats.created++; window.__qaWorkerStats.live++; this.__qaLive = true;
      this.addEventListener('message', event => { const result = event.data?.result;
        if (result) window.__qaAnalysisResults.push({ validation: result.validation, issues: result.issues, error: result.error, outputLength: result.output?.length }); });
      this.addEventListener('error', event => window.__qaAnalysisResults.push({ workerError: event.message }));
    }
    terminate() { if (this.__qaLive) { this.__qaLive = false; window.__qaWorkerStats.terminated++; window.__qaWorkerStats.live--; } super.terminate(); }
  };
  window.__TAURI_INTERNALS__.convertFileSrc = path => path.endsWith('vector.svg') ? `data:image/svg+xml,${encodeURIComponent(svg)}` : path;
  window.__TAURI_INTERNALS__.invoke = async (command, args) => {
    if (command === 'plugin:dialog|open') return args?.options?.directory ? prefix : null;
    if (command === 'read_native_headers') return [];
    if (command === 'read_dir') return files.map(file => ({ name: file.name, path: `${prefix}/${file.name}`, kind: file.kind, isDir: false, size: file.content?.length ?? 1024, mtime: 0, isHidden: false, isSymlink: false }));
    if (command === 'register_document') return { type: 'ok' };
    if (command === 'read_document' || command === 'prepare_document') {
      const file = files.find(item => args.path.endsWith(`/${item.name}`));
      if (!file) throw new Error(`Unknown fixture ${args.path}`);
      const payload = { key: args.path, displayName: file.name, dirPath: prefix, kind: file.kind, language: file.language, content: file.content, encoding: 'utf8', eol: 'lf', size: file.content?.length ?? 1024, mtime: 0, readonly: file.kind !== 'code' };
      if (command === 'read_document') return payload;
      if (file.kind === 'image') return { type: 'image', ...payload };
      if (file.kind === 'unsupported') return { type: 'unsupported', ...payload };
      return { type: 'text', payload };
    }
    return original(command, args);
  };
});

const open = async name => {
  await page.locator('[data-explorer-row]').filter({ hasText: name }).first().dblclick();
  await page.getByRole('button', { name: `关闭 ${name}`, exact: true }).waitFor();
};
const close = name => page.getByRole('button', { name: `关闭 ${name}`, exact: true }).click();
const cdp = await context.newCDPSession(page);
const memory = async () => {
  await cdp.send('HeapProfiler.collectGarbage');
  return { ...(await cdp.send('Runtime.getHeapUsage')), ...(await cdp.send('Memory.getDOMCounters')), workers: await page.evaluate(() => ({ ...window.__qaWorkerStats })) };
};

try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
  await page.getByRole('button', { name: '新建或打开', exact: true }).click();
  await page.getByRole('menuitem', { name: /打开文件夹/ }).click();
  await page.locator('[data-explorer-row]').first().waitFor();
  const started = performance.now();
  await open('stress.csv');
  await page.getByRole('grid', { name: 'stress.csv 数据', exact: true }).waitFor();
  report.csvOpenMs = performance.now() - started;
  assert.equal(await page.locator('.nb-delimited-count').textContent(), '100,000 行 · 30 列');
  await page.getByRole('textbox', { name: '单元格位置', exact: true }).fill('AD100000');
  await page.getByRole('button', { name: '定位', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.nb-delimited-detail pre')?.textContent === 'END');
  report.csvRenderedCells = await page.getByRole('gridcell').count();
  assert(report.csvRenderedCells < 500);
  report.csvMemory = await memory();
  await page.screenshot({ path: `${out}/csv-last-cell.png` });
  await close('stress.csv');
  await page.waitForFunction(() => window.__qaWorkerStats.live === 0);
  for (let cycle = 0; cycle < 10; cycle++) {
    await open('stress.csv');
    await page.getByRole('grid', { name: 'stress.csv 数据', exact: true }).waitFor();
    await close('stress.csv');
    await page.waitForFunction(() => window.__qaWorkerStats.live === 0);
    report.cycles.push(await memory());
  }
  const steady = report.cycles.slice(-5);
  assert(Math.max(...steady.map(sample => sample.usedSize)) - Math.min(...steady.map(sample => sample.usedSize)) < 2 * 1024 * 1024);
  assert(Math.max(...steady.map(sample => sample.nodes)) - Math.min(...steady.map(sample => sample.nodes)) < 120);
  await open('settings.json');
  await page.locator('.cm-content:visible').click();
  await page.keyboard.press('Shift+Alt+f');
  await page.waitForFunction(() => document.querySelector('.cm-content')?.textContent?.includes('9007199254740993') && document.querySelector('.cm-content')?.querySelectorAll('.cm-line').length > 1);
  const formatted = await page.locator('.cm-content:visible').innerText();
  assert(formatted.includes('9007199254740993') && formatted.includes('1.2300e+4') && formatted.includes('-0'));
  report.jsonLossless = true;
  await page.screenshot({ path: `${out}/json-tools.png` });
  await close('settings.json');
  // This fixture is changed by formatting; close's normal dialog chooses discard.
  await page.getByRole('button', { name: '不保存', exact: true }).click();
  const workersBeforeJson = await page.evaluate(() => window.__qaWorkerStats.created);
  await open('large.json');
  await page.locator('.cm-content:visible').click();
  await page.keyboard.press('Shift+Alt+f');
  await page.waitForFunction(() => document.querySelector('.cm-content')?.querySelectorAll('.cm-line').length > 2);
  assert(await page.evaluate(() => window.__qaWorkerStats.created) > workersBeforeJson);
  await close('large.json'); await page.getByRole('button', { name: '不保存', exact: true }).click();
  await page.waitForFunction(() => window.__qaWorkerStats.live === 0);
  const workersBeforeYaml = await page.evaluate(() => window.__qaWorkerStats.created);
  await open('settings.yaml');
  await page.locator('.cm-content:visible').click(); await page.keyboard.press('Shift+Alt+v');
  await page.waitForFunction(() => document.body.innerText.includes('YAML 格式校验通过'));
  assert(await page.evaluate(() => window.__qaWorkerStats.created) > workersBeforeYaml);
  await close('settings.yaml');
  await open('.env.production');
  await page.locator('.cm-content:visible').waitFor();
  await page.screenshot({ path: `${out}/config.png` });
  await close('.env.production');
  await open('main.go');
  await page.getByRole('button', { name: 'Go · 代码查看', exact: true }).click();
  await page.getByText('语法高亮', { exact: true }).hover();
  await page.getByText('Python', { exact: true }).click();
  await page.getByRole('button', { name: 'Python · 代码查看', exact: true }).waitFor();
  assert((await page.locator('.cm-content:visible').innerText()).includes('package main'));
  report.liveLanguageSwitch = true;
  await close('main.go');
  await open('vector.svg');
  await page.getByRole('button', { name: /查看源码|SVG 源码|源码/ }).click();
  await page.locator('.svg-source-viewer').waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('.cm-content')].some(element => element.textContent.includes('<svg')));
  await page.screenshot({ path: `${out}/svg-source.png` });
  await close('vector.svg');
  await open('design.psd');
  await page.getByRole('button', { name: '用系统默认程序打开', exact: true }).waitFor();
  await page.screenshot({ path: `${out}/external-handoff.png` });
  report.finalMemory = await memory();
  assert.equal(report.errors.length, 0);
  report.passed = true;
} finally {
  if (!report.passed) {
    report.failureState = await page.evaluate(() => document.body.innerText.slice(-5000)).catch(() => null);
    await page.screenshot({ path: `${out}/failure.png` }).catch(() => {});
  }
  report.analysisResults = await page.evaluate(() => window.__qaAnalysisResults).catch(() => []);
  await fs.writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  await browser.close(); await server.httpServer.close();
}
console.log(JSON.stringify({ passed: report.passed, out, csvOpenMs: report.csvOpenMs, cells: report.csvRenderedCells, errors: report.errors }));
