/* global window, document, requestAnimationFrame, getComputedStyle */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import { preview } from 'vite';
import { installBrowserNativeShell } from './browser-native-shell.mjs';

// Open the real showcase from the production bundle in an isolated, ephemeral
// Edge context. The native shim only supplies offline settings/filesystem IPC.
// All outline actions use real mouse/keyboard input; no editor/store mutation.
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const cdpUrl = process.env.NOTEBOARD_TEST_CDP;
const minimum = process.argv.includes('--minimum');
const compact = minimum || process.argv.includes('--compact');
const baseline = process.argv.includes('--baseline');
const selectedTheme = process.argv.find(argument => argument.startsWith('--theme='))?.slice('--theme='.length);
assert(!selectedTheme || ['chen-guang', 'hu-po', 'mo-ye'].includes(selectedTheme));
const directory = `.tmp/outline-surface${cdpUrl ? minimum ? '/native-minimum' : compact ? '/native-compact' : '/native' : baseline ? '/before' : selectedTheme ? `/${selectedTheme}` : ''}`;
await fs.mkdir(directory, { recursive: true });
const server = await preview({ configFile: false, build: { outDir: 'dist' }, preview: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = cdpUrl ? await chromium.connectOverCDP(cdpUrl) : await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
const report = {
  productionBundle: true, baseline, native: Boolean(cdpUrl), browser: await browser.version(),
  bundleModifiedAt: (await fs.stat('dist/index.html')).mtime.toISOString(),
  layouts: [], errors: [],
  limitations: [cdpUrl ? 'Native check covers the connected, isolated QA window, without replacing its native bridge.' : 'Offline native boundary does not cover filesystem IPC or an installed Tauri window.',
    'Frame intervals measure this headless Edge renderer on this machine; they are not GPU paint timings or a performance guarantee.',
    'The blur-off comparison injects temporary QA CSS only; production files and the user profile are untouched.'],
};
let page;
const editorSelector = '.nb-prose.ProseMirror[contenteditable="true"]';
const outlineSelector = '.nb-document-outline';
const frames = current => current.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const editor = current => current.locator(editorSelector).last();

async function editorCounts(current) {
  return current.evaluate(() => ({
    prosemirrorViews: [...document.querySelectorAll('.ProseMirror')].filter(element => Boolean(element.pmViewDesc)).length,
    editableProse: document.querySelectorAll('.ProseMirror[contenteditable="true"]').length,
    codemirrorViews: document.querySelectorAll('.cm-editor').length,
  }));
}

async function geometry(current) {
  return current.evaluate(() => {
    const rect = element => {
      if (!element) return null;
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    };
    const prose = [...document.querySelectorAll('.nb-prose.ProseMirror[contenteditable="true"]')].at(-1);
    const stage = prose?.closest('.nb-document-stage');
    const content = prose?.closest('.nb-document-content');
    const panel = document.querySelector('.nb-document-outline');
    const header = panel?.querySelector('.nb-outline-header');
    const toggle = panel?.querySelector('[aria-label="收起大纲"]');
    const title = header && [...header.querySelectorAll('span')].find(element => element.textContent.trim() === '大纲');
    const list = panel?.querySelector('.nb-outline-list');
    const first = panel?.querySelector('.nb-outline-item');
    const style = panel && getComputedStyle(panel);
    const blur = element => {
      const read = pseudo => {
        const computed = getComputedStyle(element, pseudo);
        return { backdropFilter: computed.backdropFilter, filter: computed.filter, position: computed.position, content: computed.content };
      };
      return { element: read(), before: read('::before'), after: read('::after') };
    };
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
      theme: document.documentElement.dataset.theme, editor: rect(prose), stage: rect(stage), content: rect(content),
      panel: rect(panel), header: rect(header), toggle: rect(toggle), title: rect(title), list: rect(list), first: rect(first),
      top: style?.top, position: style?.position, borderWidths: style && ['Top', 'Right', 'Bottom', 'Left'].map(side => style[`border${side}Width`]),
      boxShadow: style?.boxShadow, background: style?.backgroundColor, blur: panel && blur(panel),
      listScroll: list && { top: list.scrollTop, height: list.scrollHeight, client: list.clientHeight },
      stageOutlineSpace: stage && getComputedStyle(stage).getPropertyValue('--document-outline-space').trim(),
      headerText: header?.textContent.trim(), headerGap: header && list ? list.getBoundingClientRect().top - header.getBoundingClientRect().bottom : null,
      toggleMarginBottom: toggle && getComputedStyle(toggle).marginBottom,
    };
  });
}

function assertSameWidth(before, after, message) {
  for (const key of ['editor', 'content', 'stage']) {
    assert(before[key] && after[key]);
    assert(Math.abs(before[key].width - after[key].width) <= 0.5, `${message}: ${key} width stays unchanged`);
  }
}

async function screenshots(current, theme) {
  await current.mouse.move(2, 2);
  await current.waitForTimeout(200);
  const full = `${directory}/${theme}-full.png`, local = `${directory}/${theme}-outline.png`;
  await current.screenshot({ path: full, fullPage: true });
  const bounds = await current.locator(outlineSelector).boundingBox();
  const viewport = current.viewportSize() || await current.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const x = Math.max(0, Math.floor(bounds.x - 12)), y = Math.max(0, Math.floor(bounds.y - 12));
  await current.screenshot({ path: local, clip: { x, y,
    width: Math.min(viewport.width - x, Math.ceil(bounds.width + 24)),
    height: Math.min(viewport.height - y, Math.ceil(bounds.height + 24)) } });
  return { full, local };
}

async function closeOutline(current) {
  await current.getByRole('button', { name: '收起大纲', exact: true }).click();
  await current.locator(outlineSelector).waitFor({ state: 'detached' });
  await current.mouse.move(2, 2);
  await current.waitForTimeout(250);
  await frames(current);
}

async function openOutline(current) {
  await current.getByRole('button', { name: '展开大纲', exact: true }).click();
  await current.locator(outlineSelector).waitFor({ state: 'visible' });
  await current.locator('.nb-outline-item').first().waitFor();
  await frames(current);
}

async function checkInteraction(current, entry) {
  const before = await geometry(current), counts = await editorCounts(current);
  assert(counts.prosemirrorViews > 0 && counts.editableProse > 0, 'Real editable EditorView is mounted');
  await closeOutline(current);
  const closed = await geometry(current);
  assertSameWidth(before, closed, 'Collapse');
  assert.deepEqual(await editorCounts(current), counts);
  const openButton = await current.getByRole('button', { name: '展开大纲', exact: true }).evaluate(button => ({ top: getComputedStyle(button).top, border: getComputedStyle(button).borderWidth }));
  assert.equal(openButton.top, '56px');
  assert.equal(openButton.border, '0px');
  await openOutline(current);
  const reopened = await geometry(current);
  assertSameWidth(before, reopened, 'Expand');
  assert.deepEqual(await editorCounts(current), counts);
  entry.toggle = { before, closed, reopened, counts, openButton };

  const items = current.locator('.nb-outline-item');
  const target = items.last();
  const targetLabel = (await target.locator('.nb-outline-label').innerText()).trim();
  await target.scrollIntoViewIfNeeded();
  await target.click({ position: { x: 36, y: 12 } });
  await frames(current);
  await current.waitForTimeout(160);
  const jump = await current.evaluate(() => {
    const prose = [...document.querySelectorAll('.nb-prose.ProseMirror[contenteditable="true"]')].at(-1);
    const selection = window.getSelection();
    const selectedElement = selection?.anchorNode?.nodeType === 1 ? selection.anchorNode : selection?.anchorNode?.parentElement;
    const scroller = prose.closest('[data-editor-scroll]');
    const heading = selectedElement?.closest('h1,h2,h3,h4,h5,h6');
    const active = document.querySelector('.nb-outline-item[aria-current="location"]');
    return { selectedHeading: heading?.textContent.trim(), currentLabel: active?.querySelector('.nb-outline-label')?.textContent.trim(),
      scrollTop: scroller?.scrollTop, activeElement: document.activeElement?.className,
      headingY: heading?.getBoundingClientRect().top, scrollerY: scroller?.getBoundingClientRect().top, scrollerHeight: scroller?.clientHeight };
  });
  assert.equal(jump.selectedHeading, targetLabel, 'Heading click moves the real editor selection');
  assert.equal(jump.currentLabel, targetLabel, 'Clicked heading is current');
  assert(jump.scrollTop > 0, 'Heading click scrolls the document');
  assert(jump.headingY >= jump.scrollerY - 1 && jump.headingY < jump.scrollerY + jump.scrollerHeight, 'Jumped heading is visible');
  assert.deepEqual(await editorCounts(current), counts);
  entry.jump = { targetLabel, ...jump };

  const beforeList = await geometry(current);
  if (beforeList.listScroll.height > beforeList.listScroll.client) {
    const list = current.locator('.nb-outline-list');
    await list.hover({ position: { x: 80, y: 12 } });
    await current.mouse.wheel(0, -10000);
    await current.waitForTimeout(180);
    const atStart = await geometry(current);
    await current.mouse.wheel(0, 10000);
    await current.waitForTimeout(180);
    const atEnd = await geometry(current);
    assert(atEnd.listScroll.top > atStart.listScroll.top, 'Real wheel input scrolls the outline list');
    assert.deepEqual(atEnd.header, atStart.header, 'List scroll leaves the header fixed in the panel');
    assert.deepEqual(atEnd.toggle, atStart.toggle, 'List scroll leaves the collapse button fixed');
    entry.listScroll = { exercised: true, before: atStart.listScroll, after: atEnd.listScroll, header: atEnd.header };
  } else {
    entry.listScroll = { exercised: false, reason: 'All showcase headings fit in this viewport; compact layouts cover real list overflow.', geometry: beforeList.listScroll };
  }

  await editor(current).focus();
  await current.keyboard.press('Control+Alt+b');
  await current.locator(outlineSelector).waitFor({ state: 'detached' });
  assertSameWidth(before, await geometry(current), 'Keyboard collapse');
  await current.keyboard.press('Control+Alt+b');
  await current.locator(outlineSelector).waitFor({ state: 'visible' });
  await frames(current);
  assertSameWidth(before, await geometry(current), 'Keyboard expand');
  assert.deepEqual(await editorCounts(current), counts);
  entry.shortcut = { key: 'Ctrl+Alt+B', collapsedAndReopened: true, countsUnchanged: true };
}

function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = quantile => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)];
  return { count: samples.length, mean: samples.reduce((sum, value) => sum + value, 0) / samples.length,
    p50: at(0.5), p90: at(0.9), p95: at(0.95), p99: at(0.99), max: sorted.at(-1),
    above33_4ms: samples.filter(value => value > 33.4).length, intervalsMs: samples };
}

async function measureScroll(current, entry) {
  const session = await current.context().newCDPSession(current);
  await session.send('Performance.enable');
  const passes = [];
  try {
    // ABBA order lowers the influence of warmup/order, without promising that a
    // short renderer sample predicts all desktop GPUs or document workloads.
    for (const blurOff of [false, true, true, false]) {
      const override = blurOff ? await current.addStyleTag({ content: '.nb-document-outline,.nb-document-outline::before,.nb-document-outline::after,.nb-document-outline * { backdrop-filter:none!important; -webkit-backdrop-filter:none!important; }' }) : null;
      await frames(current);
      const before = await session.send('Performance.getMetrics');
      const result = await current.evaluate(async () => {
        const prose = [...document.querySelectorAll('.nb-prose.ProseMirror[contenteditable="true"]')].at(-1);
        const scroller = prose.closest('[data-editor-scroll]');
        const maximum = scroller.scrollHeight - scroller.clientHeight;
        const intervals = [];
        let previous;
        await new Promise(resolve => {
          let frame = 0;
          const step = timestamp => {
            if (previous !== undefined) intervals.push(timestamp - previous);
            previous = timestamp;
            scroller.scrollTop = Math.round(maximum * (1 - Math.cos((frame % 120) / 119 * Math.PI * 2)) / 2);
            if (++frame > 120) resolve(); else requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
        });
        return { intervals, maximum, endScrollTop: scroller.scrollTop, scrollHeight: scroller.scrollHeight, clientHeight: scroller.clientHeight };
      });
      const after = await session.send('Performance.getMetrics');
      const metricMap = metrics => Object.fromEntries(metrics.metrics.map(metric => [metric.name, metric.value]));
      const left = metricMap(before), right = metricMap(after);
      const metrics = Object.fromEntries(['LayoutCount', 'RecalcStyleCount', 'LayoutDuration', 'RecalcStyleDuration', 'TaskDuration'].map(name => [name, right[name] - left[name]]));
      passes.push({ blurOff, frameIntervals: summarize(result.intervals), maximum: result.maximum, scrollHeight: result.scrollHeight, clientHeight: result.clientHeight, metrics });
      if (override) await override.evaluate(element => element.remove());
    }
    assert(passes.every(pass => pass.frameIntervals.count === 120 && pass.maximum > 0));
    entry.performance = { measurement: '120 rAF intervals while scrolling the real showcase editor per pass, ABBA static blur / QA blur disabled',
      passes, staticBlur: summarize(passes.filter(pass => !pass.blurOff).flatMap(pass => pass.frameIntervals.intervalsMs)),
      blurDisabled: summarize(passes.filter(pass => pass.blurOff).flatMap(pass => pass.frameIntervals.intervalsMs)) };
  } finally { await session.detach(); }
}

async function memorySample(current, session) {
  await frames(current);
  await session.send('HeapProfiler.collectGarbage');
  const heap = await session.send('Runtime.getHeapUsage'), dom = await session.send('Memory.getDOMCounters');
  return { heapBytes: heap.usedSize, ...dom, editors: await editorCounts(current), outlineNodes: await current.locator(outlineSelector).count() };
}

async function checkCycles(current, entry) {
  const session = await current.context().newCDPSession(current);
  try {
    await closeOutline(current);
    await openOutline(current); await closeOutline(current);
    const before = await memorySample(current, session), cycles = [];
    for (let cycle = 1; cycle <= 12; cycle++) {
      await openOutline(current);
      assert.deepEqual(await editorCounts(current), before.editors);
      await closeOutline(current);
      if (cycle % 4 === 0) cycles.push({ cycle, ...await memorySample(current, session) });
    }
    const after = cycles.at(-1);
    entry.memory = { measurement: 'Production Edge renderer full GC; closed outline baseline and 12 actual mouse open/close cycles after warmup',
      before, after, cycles, heapDelta: after.heapBytes - before.heapBytes,
      nodeDelta: after.nodes - before.nodes, listenerDelta: after.jsEventListeners - before.jsEventListeners };
    assert.equal(after.outlineNodes, 0, 'Closed outline releases mounted panel DOM');
    assert.deepEqual(after.editors, before.editors);
    assert(after.heapBytes - before.heapBytes < 4 * 1024 * 1024, 'Outline cycles do not retain a document-sized heap');
    assert(after.nodes - before.nodes < 100, 'Outline cycles release their list DOM');
    assert(after.jsEventListeners - before.jsEventListeners < 20, 'Outline cycles release their listeners');
    await openOutline(current);
  } finally { await session.detach(); }
}

try {
  const layouts = cdpUrl ? [{ theme: selectedTheme || 'native-current' }] : [
    { theme: 'chen-guang', width: 1440, height: 1000, dpr: 1 },
    { theme: 'hu-po', width: 960, height: 540, dpr: 2 },
    { theme: 'mo-ye', width: 680, height: 540, dpr: 2 },
  ];
  for (const layout of layouts.filter(layout => !selectedTheme || layout.theme === selectedTheme)) {
    page = cdpUrl ? browser.contexts()[0].pages()[0] : await browser.newPage({ viewport: { width: layout.width, height: layout.height }, deviceScaleFactor: layout.dpr });
    assert(page, 'NOTEBOARD_TEST_CDP must expose the isolated NoteBoard QA webview');
    page.on('pageerror', error => report.errors.push(error.message));
    if (cdpUrl) {
      assert.equal(await page.evaluate(() => Boolean(window.__qaIpcCalls)), false, 'Native check retains the real Tauri bridge');
      await page.getByRole('button', { name: '新建或打开', exact: true }).waitFor();
      if (compact) {
        const size = { width: minimum ? 680 : 960, height: 540 };
        await page.evaluate(async size => {
          const { invoke, metadata } = window.__TAURI_INTERNALS__, label = metadata.currentWindow.label;
          if (await invoke('plugin:window|is_maximized', { label })) await invoke('plugin:window|toggle_maximize', { label });
          await invoke('plugin:window|set_size', { label, value: { Logical: size } });
        }, size);
        await page.waitForFunction(size => Math.abs(window.innerWidth - size.width) <= 2 && Math.abs(window.innerHeight - size.height) <= 2, size);
        report.requestedNativeSize = size;
      }
      if (!await page.locator('.nb-onboarding-layer').count()) {
        const home = page.getByRole('button', { name: '回到主界面', exact: true });
        if (await home.isVisible()) await home.click();
        await page.getByRole('button', { name: '浏览功能示例', exact: true }).click();
      }
    } else {
      await page.route('**/*', route => route.request().url().startsWith(origin) || /^(data:|blob:)/.test(route.request().url()) ? route.continue() : route.abort());
      await installBrowserNativeShell(page, { theme: layout.theme, introductionSeen: false });
      await page.goto(origin);
    }
    const guide = page.getByRole('region', { name: '上手引导', exact: true });
    await guide.waitFor();
    await guide.getByRole('button', { name: '退出引导', exact: true }).click();
    await page.locator('.nb-onboarding-layer').waitFor({ state: 'hidden' });
    await editor(page).waitFor();
    await page.locator('.nb-outline-item').first().waitFor();
    await frames(page);
    assert.equal(await page.getByRole('button', { name: '使用系统字体', exact: true }).count(), 0, 'Offline settings automatically configure system fonts');
    const initial = await geometry(page);
    const entry = { requested: layout, initial, screenshots: await screenshots(page, layout.theme) };
    report.layouts.push(entry);
    if (!cdpUrl) assert.deepEqual(initial.viewport, { width: layout.width, height: layout.height, dpr: layout.dpr });
    if (!cdpUrl || selectedTheme) assert.equal(initial.theme, layout.theme);
    assert.equal(initial.top, '56px');
    assert.equal(initial.position, 'absolute');
    assert(Math.abs(initial.panel.y - initial.stage.y - 56) <= 0.5, 'Outline preserves its original stage-relative top');
    assert(initial.panel.x >= 0 && initial.panel.y >= 0 && initial.panel.x + initial.panel.width <= initial.viewport.width + 0.5 && initial.panel.y + initial.panel.height <= initial.viewport.height + 0.5, 'Outline stays inside the viewport');
    if (!baseline) {
      assert.deepEqual(initial.borderWidths, ['0px', '0px', '0px', '0px'], 'No theme/container rule restores the panel border');
      assert(initial.header && initial.title, 'Header has a static outline label');
      assert.equal(initial.headerText, '大纲');
      assert(initial.toggle.x - initial.header.x <= 1, 'Collapse button leads the header on the left');
      assert(initial.title.x >= initial.toggle.x + initial.toggle.width, 'Title follows the button');
      assert(initial.header.height <= 32, 'Header remains compact');
      assert(initial.headerGap >= 0 && initial.headerGap <= 8, 'Header/list gap is compact');
      assert.equal(initial.toggleMarginBottom, '0px', 'Old 12px button spacer is removed');
      assert.equal(initial.stageOutlineSpace, '0px', 'Outline reserves no document width');
      await checkInteraction(page, entry);
      if (!cdpUrl) await measureScroll(page, entry);
      await checkCycles(page, entry);
    }
    console.log(JSON.stringify({ theme: layout.theme, passed: true, panel: initial.panel, performance: entry.performance && {
      staticBlur: { p50: entry.performance.staticBlur.p50, p95: entry.performance.staticBlur.p95, p99: entry.performance.staticBlur.p99 },
      blurDisabled: { p50: entry.performance.blurDisabled.p50, p95: entry.performance.blurDisabled.p95, p99: entry.performance.blurDisabled.p99 } }, memory: entry.memory && {
      heapDelta: entry.memory.heapDelta, nodeDelta: entry.memory.nodeDelta, listenerDelta: entry.memory.listenerDelta } }));
    if (!cdpUrl) await page.close(); page = undefined;
  }
  if (!baseline && !selectedTheme && !cdpUrl) assert(report.layouts.some(entry => entry.listScroll.exercised), 'Compact layouts exercise overflow scrolling with a fixed header');
  assert.deepEqual(report.errors, []);
  report.passed = true;
  await fs.rm(`${directory}/failure.png`, { force: true });
} catch (error) {
  report.passed = false; report.failure = error.stack || error.message;
  if (page) await page.screenshot({ path: `${directory}/failure.png`, fullPage: true }).catch(() => {});
  throw error;
} finally {
  await fs.writeFile(`${directory}/results.json`, JSON.stringify(report, null, 2));
  // In Playwright's connectOverCDP path close() disconnects the CDP transport;
  // it does not send Browser.close or close the user-owned native window.
  await browser.close(); await server.close();
}
