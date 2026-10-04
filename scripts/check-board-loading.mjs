/* global window, localStorage */
// Exercise built ES modules through the real application, not Vite's dev graph.
// Build first; usage: node scripts/check-board-loading.mjs [--dist dist]
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { preview } from 'vite';

const arg = process.argv.indexOf('--dist');
if (arg !== -1 && !process.argv[arg + 1]) throw new Error('--dist requires a build directory');
const dist = resolve(arg === -1 ? 'dist' : process.argv[arg + 1]);
const manifest = JSON.parse(await readFile(resolve(dist, '.vite/manifest.json'), 'utf8'));
const sources = JSON.parse(await readFile(resolve(dist, '.module-sources.json'), 'utf8'));
const boardFile = Object.keys(sources).find(file => sources[file].packages.includes('src/features/board/BoardEditor.tsx'));
const board = Object.values(manifest).find(entry => entry.file === boardFile);
assert(board?.isDynamicEntry, 'BoardEditor must remain a lazy entry');
const boardEngine = sources[boardFile]?.packages.includes('@excalidraw/excalidraw') ? boardFile
  : Object.keys(sources).find(file => sources[file].packages.includes('@excalidraw/excalidraw') && sources[file].packages.length > 1 && file.endsWith('.js'));
assert(boardEngine, 'build must contain the real Excalidraw engine');
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const server = await preview({ configFile: false, build: { outDir: dist }, preview: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
const report = [];
const diagnostics = [];

// The native shell is mocked; settings, drafts and notices use their real DTO
// shapes so unrelated mock errors cannot disguise a failed editor.
async function createPage({ failEngineOnce = false } = {}) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  const errors = [], requests = [], blockedExternal = [];
  diagnostics.push(errors);
  let failedRequests = 0;
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const url = message.location().url;
    if (url && !url.startsWith(origin)) return; // deliberately offline external assets
    if (failEngineOnce && url.endsWith(`/${boardEngine}`) && /Failed to load resource/.test(message.text())) return;
    errors.push(message.text());
  });
  await page.route('**/*', async route => {
    const url = route.request().url();
    if (!url.startsWith(origin)) { blockedExternal.push(url); return route.abort(); }
    requests.push(new URL(url).pathname.slice(1));
    if (failEngineOnce && url.endsWith(`/${boardEngine}`) && failedRequests++ === 0) return route.abort();
    return route.continue();
  });
  await page.addInitScript(() => {
    localStorage.setItem('noteboard.introduction-seen', '1');
    const callbacks = new Map(); let callbackId = 0;
    window.__qaIpcCalls = [];
    window.__qaStagedDocuments = [];
    const settings = {
      schemaVersion: 1, revision: 0, shortcuts: { overrides: {} },
      appearance: { themeMode: 'light', systemLightTheme: 'chen-guang', systemDarkTheme: 'mo-ye' },
      typography: { contentFontFamily: '', contentFontFamilyZh: '', monoFontFamily: 'monospace', monoFontFamilyZh: '', monoFontFamilySource: 'automatic', monoFontFamilyZhSource: 'automatic', contentFontSize: 16, monoFontSize: 14, contentLineHeight: 1.7, monoLineHeight: 1.5, contentWidth: 'wide', monoContentWidth: 'full', explorerFontFamily: '', explorerFontFamilyZh: '', explorerFontSize: 13, explorerLineHeight: 24, uiFontFamily: '', uiFontFamilyZh: '', uiFontSize: 13 },
      editor: { pureMarkdown: false, defaultViewMode: 'visual', softWrap: true, showLineNumbers: true, showIndentGuides: true, tabSize: 2, insertSpaces: true, enableMath: true, enableMermaid: true, enableAlerts: true, enableBlockHandle: true, showWhitespace: false, showLineEndings: false },
      file: { autoSaveMarkdown: false, autoSaveBoard: false, autoSaveOther: false, forceManualSave: false, showHiddenFiles: false, restoreSession: false, imageDirName: 'img', imageDeletionPolicy: 'ask', imageCaptionDeletionPolicy: 'ask', largeFileConfirmMb: 50, stagingDirectory: '' },
      layout: { statusBarVisible: true, uiScale: 100 },
    };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'qa' }, currentWebview: { label: 'qa' } },
      transformCallback(callback) { const id = ++callbackId; callbacks.set(id, callback); return id; },
      unregisterCallback(id) { callbacks.delete(id); },
      convertFileSrc: path => path,
      invoke: async (command, args) => {
        window.__qaIpcCalls.push(command);
        if (command === 'window_listeners_ready') return { startupMode: 'empty', consumerId: 'qa', consumerGeneration: 1 };
        if (command === 'load_settings') return settings;
        if (command === 'get_font_pack_status') return { state: 'ready', faces: [] };
        if (command === 'load_session') return null;
        if (command === 'load_favorites') return { schemaVersion: 1, roots: [] };
        if (['list_open_requests', 'list_recent', 'list_drafts', 'get_dismissed_update_notices', 'probe_shortcuts', 'recover_native_commits'].includes(command)) return [];
        if (command === 'stash_documents') {
          window.__qaStagedDocuments = args.documents;
          return args.documents.map(doc => ({ key: doc.key, targetPath: `C:/qa/${doc.displayName}` }));
        }
        if (command === 'plugin:app|version') return '1.0.2';
        if (command === 'plugin:event|listen') return ++callbackId;
        return null;
      },
    };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  });
  await page.goto(origin, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '新建或打开', exact: true }).waitFor();
  assert(!requests.some(file => sources[file]?.packages.includes('@excalidraw/excalidraw')), 'startup must not request the board engine');
  return { page, errors, requests, blockedExternal, get failedRequests() { return failedRequests; } };
}

async function createDocument(page, name) {
  await page.getByRole('button', { name: '新建或打开', exact: true }).click();
  await page.getByRole('menuitem', { name, exact: true }).click();
}

async function drawRectangle(page) {
  const canvas = page.locator('.excalidraw canvas.interactive');
  await canvas.waitFor({ timeout: 30000 });
  const box = await canvas.boundingBox();
  assert(box && box.width > 500 && box.height > 300, 'board canvas must have usable geometry');
  await page.locator('label.ToolIcon').filter({ has: page.locator('[data-testid="toolbar-rectangle"]') }).click();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 140, box.y + box.height / 2 + 90, { steps: 8 });
  await page.mouse.up();
  await page.locator('[data-testid="button-undo"]:not([disabled])').waitFor();
  await page.keyboard.press('Control+z');
  await page.locator('[data-testid="button-redo"]:not([disabled])').waitFor();
  await page.keyboard.press('Control+y');
  await page.locator('[data-testid="button-undo"]:not([disabled])').waitFor();
}

async function closeBoard(page) {
  await page.locator('.nb-tab-close').click();
  const discard = page.getByRole('button', { name: '不保存', exact: true });
  // Dirty boards use the application's real discard and close path.
  await Promise.race([discard.waitFor(), page.locator('.nb-tab').waitFor({ state: 'detached' })]);
  if (await discard.isVisible()) await discard.click();
  await page.locator('.excalidraw').waitFor({ state: 'detached' });
  await page.locator('.nb-tab').waitFor({ state: 'detached' });
  assert.equal(await page.locator('canvas').count(), 0, 'closing must release all board canvases');
}

async function memorySample(page, cdp, round) {
  await page.waitForTimeout(350); // allow queued disposers/timers to settle
  await cdp.send('HeapProfiler.collectGarbage');
  const { metrics } = await cdp.send('Performance.getMetrics');
  const counters = await cdp.send('Memory.getDOMCounters');
  return { round, heapBytes: metrics.find(metric => metric.name === 'JSHeapUsedSize').value,
    ...counters, canvases: await page.locator('canvas').count() };
}

try {
  const normal = await createPage();
  await createDocument(normal.page, '新建自由画板 (.excalidraw)');
  await drawRectangle(normal.page);
  assert.equal(await normal.page.locator('.excalidraw').count(), 1, 'one document must mount one engine instance');
  assert.deepEqual(normal.errors, [], 'real board startup and interaction must have no runtime errors');
  report.push({ scenario: 'board-create-draw-undo-redo', engine: boardEngine, errors: normal.errors, blockedExternal: normal.blockedExternal });
  await closeBoard(normal.page);
  const cdp = await normal.page.context().newCDPSession(normal.page);
  await cdp.send('Performance.enable');
  const samples = [await memorySample(normal.page, cdp, 0)];
  const engineRequestsAfterWarm = normal.requests.filter(file => file === boardEngine).length;
  for (let round = 1; round <= 5; round++) {
    await createDocument(normal.page, '新建自由画板 (.excalidraw)');
    await drawRectangle(normal.page);
    assert.equal(await normal.page.locator('.excalidraw').count(), 1);
    await closeBoard(normal.page);
    samples.push(await memorySample(normal.page, cdp, round));
  }
  assert.equal(normal.requests.filter(file => file === boardEngine).length, engineRequestsAfterWarm, 'warm engine modules must not reload on each board');
  // Small runtime/DOM bookkeeping can settle after warm-up; retained editor
  // roots/listeners or a heap increase comparable to another engine must fail.
  assert(samples.at(-1).nodes <= samples[0].nodes + 100, 'closed board DOM must not accumulate');
  assert(samples.at(-1).jsEventListeners <= samples[0].jsEventListeners + 20, 'closed board listeners must not accumulate');
  assert(samples.at(-1).heapBytes <= samples[0].heapBytes + 5 * 1024 * 1024, 'five closed boards must not retain another engine-sized heap');
  assert.deepEqual(normal.errors, []);
  report.push({ scenario: 'warm-create-draw-close-five-rounds', measurement: 'Edge renderer JS heap after CDP full GC; DOM and JS event listeners from CDP Memory.getDOMCounters', engineRequestsAfterWarm, samples });
  await normal.page.close();

  const recovery = await createPage({ failEngineOnce: true });
  await createDocument(recovery.page, '新建自由画板 (.excalidraw)');
  await recovery.page.getByRole('button', { name: '重试加载', exact: true }).waitFor({ timeout: 30000 });
  assert.equal(await recovery.page.locator('.excalidraw').count(), 0, 'failed load must not mount a partial engine');
  const attemptsBeforeRetry = recovery.failedRequests;
  await recovery.page.waitForTimeout(350);
  assert.equal(recovery.failedRequests, attemptsBeforeRetry, 'failed resources must not retry in the background');
  await recovery.page.getByRole('button', { name: '重试加载', exact: true }).click();
  await recovery.page.getByRole('button', { name: '重试加载', exact: true }).waitFor();
  assert.equal(await recovery.page.locator('.excalidraw').count(), 0, 'failed retry must not mount a partial or duplicate engine');
  await recovery.page.getByRole('tab', { name: '未命名.excalidraw', exact: true }).waitFor();
  await recovery.page.getByRole('button', { name: '关闭标签', exact: true }).click();
  await recovery.page.locator('.nb-tab').waitFor({ state: 'detached' });
  assert.deepEqual(recovery.errors, [], 'host must handle the transient module failure');
  report.push({ scenario: 'engine-fetch-failure-visible-error-retry-close', requests: recovery.failedRequests, errors: recovery.errors, limitation: 'Chromium caches the failed ESM URL; rebuilding the host resource preserves the document and error UI but cannot invalidate the browser module map.' });
  await recovery.page.close();

  for (const [name, selector] of [
    ['新建思维导图 (.mindmap)', '[data-testid="mindmap-editor"]'],
    ['新建多维表格 (.bitable)', null],
  ]) {
    const smoke = await createPage();
    await createDocument(smoke.page, name);
    if (selector) await smoke.page.getByText('中心主题', { exact: true }).waitFor({ timeout: 30000 });
    else await smoke.page.getByRole('button', { name: '新建记录', exact: true }).waitFor({ timeout: 30000 });
    assert.deepEqual(smoke.errors, [], `${name} smoke must have no runtime errors`);
    assert(!smoke.requests.some(file => sources[file]?.packages.includes('@excalidraw/excalidraw')), `${name} must not fetch the unrelated board engine`);
    report.push({ scenario: name, errors: smoke.errors });
    await smoke.page.close();
  }
  console.log(JSON.stringify(report, null, 2));
} finally {
  for (const context of browser.contexts()) for (const page of context.pages()) {
    await page.screenshot({ path: '.tmp/board-loading-last.png' });
    console.log('Last page:', (await page.locator('body').innerText()).slice(0, 3500));
  }
  if (report.length < 5) console.log('Runtime diagnostics:', JSON.stringify(diagnostics));
  await mkdir('test-results/board', { recursive: true });
  await writeFile('test-results/board/loading-production.json', JSON.stringify(report, null, 2));
  await browser.close();
  await server.close();
}
