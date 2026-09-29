/* global window, document, getComputedStyle, requestAnimationFrame, performance, NodeFilter */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import { build, preview } from 'vite';
import react from '@vitejs/plugin-react';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const outDir = '.tmp/reading-constraints-dist';
await fs.mkdir('.tmp', { recursive: true });
if (!process.argv.includes('--reuse')) await build({ configFile: false, plugins: [react()], worker: { format: 'es' }, build: { outDir, emptyOutDir: true, rollupOptions: { input: 'test/browser/longContentViewport.html' } }, logLevel: 'error' });
const server = await preview({ configFile: false, build: { outDir }, preview: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--js-flags=--expose-gc'] });
const browserCdp = await browser.newBrowserCDPSession();
const runFile = promisify(execFile);
const processMemory = async () => {
  const { processInfo } = await browserCdp.send('SystemInfo.getProcessInfo');
  const pids = [...new Set(processInfo.map(process => process.id))];
  const { stdout } = await runFile(process.env.PYTHON || 'D:/anaconda/envs/aider/python.exe', ['-c',
    'import json,psutil,sys\nrows=[]\nfor pid in json.loads(sys.argv[1]):\n try:\n  p=psutil.Process(pid); rows.append({"pid":pid,"privateBytes":p.memory_full_info().uss})\n except psutil.NoSuchProcess: pass\nprint(json.dumps({"privateWorkingSetMiB":sum(r["privateBytes"] for r in rows)/1048576,"processes":rows}))', JSON.stringify(pids)], { encoding: 'utf8', windowsHide: true });
  return JSON.parse(stdout);
};
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(20000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const result = { matrix: [], numericTables: [], tables: [], handles: [], formulas: [], cycles: [], errors };
let phase = 'startup';
const screenshot = name => page.screenshot({ path: `.tmp/reading-constraints-${name}.png` });
const settle = async () => { await page.waitForTimeout(250); };
const reading = async (formula, table = 'expand') => { await page.evaluate(([f, t]) => window.longContentQA.reading(f, t), [formula, table]); await settle(); };
const load = async source => {
  await page.evaluate(text => window.longContentQA.load(text), source);
  await settle();
  return page.evaluate(() => window.longContentQA.source());
};
const unchanged = async source => {
  assert.equal(await page.evaluate(() => window.longContentQA.source()), source, 'Reading view must retain serialized source');
  assert.equal(await page.evaluate(() => window.longContentQA.contentTransactions()), 0, 'Reading view must not dispatch content transactions');
};
const visibleRows = async index => page.evaluate(index => {
  const table = document.querySelectorAll('.ProseMirror table')[index];
  const parent = table.parentElement, outer = document.querySelector('[data-editor-scroll]');
  const local = getComputedStyle(parent).overflowY === 'auto' ? parent.getBoundingClientRect() : outer.getBoundingClientRect();
  const viewport = outer.getBoundingClientRect(), top = Math.max(local.top, viewport.top), bottom = Math.min(local.bottom, viewport.bottom);
  const visible = [...table.rows].map((row, index) => ({ index, top: row.getBoundingClientRect().top, bottom: row.getBoundingClientRect().bottom, placeholder: row.classList.contains('nb-row-placeholder'), cells: [...row.cells].map(cell => cell.textContent) })).filter(row => row.bottom > top + 1 && row.top < bottom - 1);
  return { visible, mounted: table.querySelectorAll('tr:not(.nb-row-placeholder)').length, rows: table.rows.length, scrollTop: parent.scrollTop, scrollLeft: parent.scrollLeft, clientHeight: parent.clientHeight, scrollHeight: parent.scrollHeight, overflowX: getComputedStyle(parent).overflowX, overflowY: getComputedStyle(parent).overflowY };
}, index);
const scrollRow = async (tableIndex, rowIndex) => {
  await page.evaluate(([tableIndex, rowIndex]) => {
    const table = document.querySelectorAll('.ProseMirror table')[tableIndex], parent = table.parentElement;
    parent.scrollIntoView({ block: 'center' });
    const row = table.rows[rowIndex], current = row.getBoundingClientRect(), box = parent.getBoundingClientRect();
    parent.scrollTop += current.top - box.top - parent.clientTop;
  }, [tableIndex, rowIndex]);
  await page.waitForFunction(index => {
    const table = document.querySelectorAll('.ProseMirror table')[index], parent = table.parentElement;
    const local = parent.getBoundingClientRect(), outer = document.querySelector('[data-editor-scroll]').getBoundingClientRect();
    const top = Math.max(local.top, outer.top), bottom = Math.min(local.bottom, outer.bottom);
    return [...table.rows].every(row => { const rect = row.getBoundingClientRect(); return rect.bottom <= top + 1 || rect.top >= bottom - 1 || !row.classList.contains('nb-row-placeholder'); });
  }, tableIndex);
  await settle();
  return visibleRows(tableIndex);
};
const formulaGeometry = async index => page.locator('.math-node').nth(index).evaluate(node => {
  const preview = node.querySelector('.math-preview'), inner = node.querySelector('.katex-html'), scroller = node.querySelector('.math-node-preview');
  const block = node.classList.contains('math-node-display') ? node : node.closest('p,h1,h2,h3,h4,h5,h6,td,th,li,blockquote');
  const box = block.getBoundingClientRect(), style = getComputedStyle(block), available = box.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const rect = preview.getBoundingClientRect(), ranges = [];
  // Stretchy radicals use oversized SVG paths and invisible vertical struts;
  // direct TeX groups describe the painted layout without those internals.
  for (const element of inner?.children ?? []) { if (!element.matches('.base,.tag')) continue; const r = element.getBoundingClientRect(); if (r.width && r.height) ranges.push(r); }
  const left = Math.min(rect.left, ...ranges.map(r => r.left)), right = Math.max(rect.left, ...ranges.map(r => r.right));
  return { display: node.classList.contains('math-node-display'), width: rect.width, height: rect.height, available, contentWidth: right - left, right, blockRight: box.right, zoom: preview.style.zoom, html: inner?.innerHTML, overflowX: scroller ? getComputedStyle(scroller).overflowX : null, scrollWidth: scroller?.scrollWidth, clientWidth: scroller?.clientWidth, error: !!node.querySelector('.katex-error') };
});
const showFormula = async index => {
  const locator = page.locator('.math-node').nth(index);
  await locator.evaluate(node => node.scrollIntoView({ block: 'center', inline: 'nearest' }));
  await locator.locator('.katex').first().waitFor();
  await page.waitForTimeout(600);
  return locator;
};
const waitFormulaFit = index => page.waitForFunction(index => {
  const node = document.querySelectorAll('.math-node')[index];
  const block = node.classList.contains('math-node-display') ? node : node.closest('p,h1,h2,h3,h4,h5,h6,td,th,li,blockquote');
  const style = getComputedStyle(block), available = block.getBoundingClientRect().width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const groups = [...node.querySelectorAll('.katex-html > .base,.katex-html > .tag')].map(el => el.getBoundingClientRect());
  return groups.length && Math.max(...groups.map(r => r.right)) - Math.min(...groups.map(r => r.left)) <= available + 3;
}, index, { timeout: 8000 });
const scrollMatrix = async row => {
  const matrix = page.locator('.nb-matrix-view').first();
  await matrix.locator('..').evaluate(host => host.scrollIntoView({ block: 'center' }));
  await matrix.evaluate((view, row) => { const host = view.closest('.math-node-preview'), grid = view.querySelector('.nb-matrix-grid'); host.scrollTop = row * grid.getBoundingClientRect().height / 1000; }, row);
  await page.waitForFunction(row => !!document.querySelector(`[data-matrix-cell="${row}:0"]`), row);
  await matrix.evaluate((view, row) => { const host = view.closest('.math-node-preview'), cell = view.querySelector(`[data-matrix-cell="${row}:0"]`); host.scrollTop += cell.getBoundingClientRect().top - host.getBoundingClientRect().top; }, row);
  await settle();
  return matrix.evaluate(view => { const host = view.closest('.math-node-preview'), b = host.getBoundingClientRect(); const cells = [...view.querySelectorAll('[data-matrix-cell]')].map(cell => ({ key: cell.dataset.matrixCell, text: cell.textContent, top: cell.getBoundingClientRect().top, bottom: cell.getBoundingClientRect().bottom })); return { mounted: cells.length, visible: cells.filter(c => c.bottom > b.top + 1 && c.top < b.bottom - 1), scrollTop: host.scrollTop, clientHeight: host.clientHeight, scrollHeight: host.scrollHeight, overflowY: getComputedStyle(host).overflowY }; });
};
try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/test/browser/longContentViewport.html`);
  await page.waitForFunction(() => window.longContentQA?.ready());
  phase = 'numeric-matrix';
  const matrixSource = '$$\n\\begin{bmatrix}\n' + Array.from({ length: 1000 }, (_, row) => Array.from({ length: 4 }, (_, column) => row * 4 + column).join(' & ')).join(' \\\\\n') + '\n\\end{bmatrix}\n$$';
  let source = await load('# Numeric matrix\n\n' + matrixSource); await reading('scroll');
  await page.locator('.nb-matrix-view').waitFor();
  for (const row of [200, 500, 990, 0]) {
    const check = await scrollMatrix(row); result.matrix.push({ target: row, ...check });
    assert(check.visible.some(cell => cell.key === `${row}:0`), `Matrix row ${row} must be visible`);
    assert(check.visible.length > 0 && check.visible.every(cell => cell.text === String(Number(cell.key.split(':')[0]) * 4 + Number(cell.key.split(':')[1]))), 'Every visible matrix cell must contain its numeric value');
    const rows = new Map(); check.visible.forEach(cell => { const row = cell.key.split(':')[0]; rows.set(row, (rows.get(row) ?? 0) + 1); });
    assert([...rows.values()].every(count => count === 4), 'Every visible matrix row must contain all four cells');
    assert(check.mounted < 400, 'Thousand-row matrix must retain fewer than one tenth of its cells');
    assert.equal(check.overflowY, 'auto', 'Matrix must use the local formula scrollbar');
    if (row === 500) await screenshot('numeric-matrix-row500');
  }
  await screenshot('numeric-matrix'); await unchanged(source);
  phase = 'numeric-table';
  const numeric = ['| 0 | 1 | 2 | 3 |', '| --- | --- | --- | --- |', ...Array.from({ length: 1000 }, (_, row) => `| ${row * 4 + 4} | ${row * 4 + 5} | ${row * 4 + 6} | ${row * 4 + 7} |`)].join('\n');
  source = await load('# Numeric table\n\n' + numeric);
  await reading('expand', 'scroll');
  for (const row of [200, 500, 990, 0]) {
    const check = await scrollRow(0, row);
    result.numericTables.push({ target: row, ...check });
    assert(check.visible.length > 0, 'Numeric matrix must have visible rows');
    assert(check.visible.every(row => !row.placeholder && row.cells.length === 4 && row.cells.every(text => /^\d+$/.test(text))), 'Every visible numeric cell must be mounted and populated');
    assert(check.mounted < 160, 'Thousand-row numeric matrix must retain bounded mounted rows');
    assert(check.visible.some(item => item.index === row), `Numeric matrix target ${row} must be visible`);
  }
  await screenshot('numeric-table'); await unchanged(source);

  phase = 'global-table-scroll';
  const wide = ['| ' + Array.from({ length: 30 }, (_, i) => `Column ${i}`).join(' | ') + ' |', '| ' + Array(30).fill('---').join(' | ') + ' |', ...Array.from({ length: 80 }, (_, row) => '| ' + Array.from({ length: 30 }, (_, column) => `R${row}C${column}`).join(' | ') + ' |')].join('\n');
  source = await load('# Numeric data\n\n' + numeric + '\n\n# Wide data\n\n' + wide);
  await reading('expand', 'scroll');
  for (const [index, target] of [[0, 500], [1, 40]]) {
    const check = await scrollRow(index, target);
    assert.equal(check.overflowX, 'auto'); assert.equal(check.overflowY, 'auto');
    assert(check.visible.every(row => !row.placeholder && row.cells.every(Boolean)), 'Global scroll mode must render every visible table cell');
    assert(check.mounted < 160, 'Global scroll mode must bound mounted rows');
    result.tables.push({ index, target, ...check });
    if (index === 1) await page.locator('.ProseMirror table').nth(index).evaluate(table => { table.parentElement.scrollLeft = 650; });
    await settle();
    const hover = await page.locator('.ProseMirror table').nth(index).evaluate(table => {
      const b = table.parentElement.getBoundingClientRect(), row = [...table.rows].find(row => { const r = row.getBoundingClientRect(); return r.top > b.top + 40 && r.bottom < b.bottom - 40 && !row.classList.contains('nb-row-placeholder'); });
      const cell = [...row.cells].find(cell => { const r = cell.getBoundingClientRect(); return r.left > b.left + 20 && r.right < b.right - 20; });
      const rect = cell.getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });
    await page.mouse.move(hover.x, hover.y); await settle();
    const handles = await page.evaluate(() => {
      const handles = [...document.querySelectorAll('.nb-table-select-handle:not([hidden])')].map(el => { const r = el.getBoundingClientRect(); return { className: el.className, left: r.left, right: r.right, top: r.top, bottom: r.bottom }; });
      const text = []; for (const cell of document.querySelectorAll('.ProseMirror td,.ProseMirror th')) { const clip = cell.closest('table').parentElement.getBoundingClientRect(); const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT); for (let n; (n = walker.nextNode());) { if (!n.textContent.trim()) continue; const range = document.createRange(); range.selectNodeContents(n); for (const r of range.getClientRects()) { const rect = { left: Math.max(r.left, clip.left, 0), right: Math.min(r.right, clip.right, 1440), top: Math.max(r.top, clip.top, 0), bottom: Math.min(r.bottom, clip.bottom, 1000) }; if (rect.left < rect.right && rect.top < rect.bottom) text.push(rect); } } }
      return { handles, overlaps: handles.map(h => text.filter(t => h.left < t.right - .5 && h.right > t.left + .5 && h.top < t.bottom - .5 && h.bottom > t.top + .5).length) };
    });
    result.handles.push({ index, ...handles });
    assert.equal(handles.handles.length, 2, 'Hover must expose row and column selection handles');
    assert(handles.overlaps.every(count => count === 0), 'Selection handles must not overlap visible cell text');
  }
  await screenshot('global-table-scroll'); await unchanged(source);

  phase = 'structured-formulas';
  const sum = Array.from({ length: 24 }, (_, i) => `a_{${i}}+b_{${i}}`).join('+');
  const formulas = [
    { name: 'fraction', tex: `\\frac{${sum}}{${sum}}` },
    { name: 'sqrt', tex: `\\sqrt{${sum}}` },
    { name: 'left-right', tex: `\\left(${sum}\\right)` },
    { name: 'font', tex: `\\mathbf{${sum}}` },
    { name: 'overset', tex: `\\overset{${sum}}{${sum}}` },
    { name: 'atomic-phantom', tex: `\\overbrace{${sum}}^{\\text{sum}}` },
  ];
  const documentSource = formulas.flatMap(({ name, tex }) => [`## Display ${name}`, `$$\n${tex}\n$$`, `## Inline ${name}`, `Before $${tex}$ after.`]).join('\n\n');
  source = await load(documentSource); await reading('expand');
  assert.equal(await page.locator('.math-node').count(), formulas.length * 2);
  for (let index = 0; index < formulas.length * 2; index++) {
    await reading('expand'); await showFormula(index);
    const natural = await formulaGeometry(index);
    assert.equal(natural.error, false, 'Structured TeX fixture must render');
    await reading('wrap'); await showFormula(index); await waitFormulaFit(index);
    const wrapped = await formulaGeometry(index);
    const formulaResult = { name: formulas[Math.floor(index / 2)].name, index, natural: { ...natural, html: undefined }, wrapped: { ...wrapped, html: undefined } };
    result.formulas.push(formulaResult);
    assert(wrapped.contentWidth <= wrapped.available + 3, `${formulas[Math.floor(index / 2)].name} ${index % 2 ? 'inline' : 'display'} wrap content ${wrapped.contentWidth} exceeds ${wrapped.available}`);
    await reading('scroll'); await showFormula(index);
    if (index % 2) await waitFormulaFit(index);
    const scrolled = await formulaGeometry(index);
    if (scrolled.display) assert.equal(scrolled.overflowX, 'auto', 'Display scroll mode must own horizontal scrolling');
    else { assert.notEqual(scrolled.overflowX, 'auto', 'Inline formulas must not introduce scrolling'); assert(scrolled.contentWidth <= scrolled.available + 3, 'Inline scroll policy must wrap to available width'); }
    await reading('expand'); await showFormula(index);
    const restored = await formulaGeometry(index);
    assert.equal(restored.html, natural.html, 'Expand must restore original KaTeX markup');
    assert(Math.abs(restored.width - natural.width) <= 1 && Math.abs(restored.height - natural.height) <= 1, 'Expand must restore original geometry');
    Object.assign(formulaResult, { scrolled: { ...scrolled, html: undefined }, restored: { width: restored.width, height: restored.height } });
  }
  await reading('wrap'); await showFormula(0); await screenshot('formula-wrap'); await unchanged(source);

  phase = 'residency-and-performance';
  source = await load(documentSource + '\n\n' + numeric + '\n\n' + wide + '\n\n' + matrixSource); await reading('wrap', 'scroll');
  const cdp = await page.context().newCDPSession(page); await cdp.send('Performance.enable');
  for (let cycle = 0; cycle < 8; cycle++) {
    await reading('scroll', 'scroll'); await scrollMatrix(cycle % 2 ? 0 : 990);
    await reading(['expand', 'wrap', 'scroll'][cycle % 3], cycle % 2 ? 'expand' : 'scroll');
    await showFormula(cycle % (formulas.length * 2));
    await reading('wrap', 'scroll'); await scrollRow(0, cycle % 2 ? 0 : 990); await scrollRow(1, 40);
    await cdp.send('HeapProfiler.collectGarbage');
    const heap = await cdp.send('Runtime.getHeapUsage'), dom = await cdp.send('Memory.getDOMCounters');
    const mounted = await page.evaluate(() => ({ rows: [...document.querySelectorAll('.ProseMirror table')].map(t => t.querySelectorAll('tr:not(.nb-row-placeholder)').length), matrixCells: document.querySelectorAll('[data-matrix-cell]').length, math: document.querySelectorAll('.math-node .katex').length, elements: document.querySelectorAll('*').length }));
    assert(mounted.rows.every(count => count < 160), 'Repeated switches must retain bounded mounted table rows');
    result.cycles.push({ cycle, jsHeapMiB: heap.usedSize / 1048576, dom, mounted, browserProcesses: await processMemory() });
  }
  const first = result.cycles[2], last = result.cycles.at(-1);
  assert(last.jsHeapMiB < first.jsHeapMiB * 1.5, 'Post-warmup heap must not grow by half across repeated switches');
  assert(last.dom.nodes < first.dom.nodes * 1.5, 'Post-warmup DOM must not grow by half across repeated switches');
  assert(last.browserProcesses.privateWorkingSetMiB < first.browserProcesses.privateWorkingSetMiB * 1.5, 'Post-warmup browser private working set must not grow by half across repeated switches');
  await scrollRow(0, 300);
  const frames = await page.evaluate(async () => {
    const scroll = document.querySelector('.ProseMirror table').parentElement, samples = []; let last = performance.now();
    for (let i = 0; i < 100; i++) { await new Promise(requestAnimationFrame); const now = performance.now(); samples.push(now - last); last = now; scroll.scrollTop += i < 50 ? 90 : -90; }
    return samples.slice(3).sort((a, b) => a - b);
  });
  result.frames = { samples: frames.length, median: frames[Math.floor(frames.length * .5)], p95: frames[Math.floor(frames.length * .95)], max: frames.at(-1) };
  await screenshot('residency'); await unchanged(source);
  assert.deepEqual(errors, []); result.contentTransactions = 0; result.success = true;
  await fs.writeFile('.tmp/reading-constraints-results.json', JSON.stringify(result, null, 2));
  const summary = { success: true, matrix: result.matrix.map(({ target, mounted, visible }) => ({ target, mounted, visibleCells: visible.length })), tables: result.tables.map(({ index, target, mounted, visible }) => ({ index, target, mounted, visibleRows: visible.length })), handles: result.handles.map(({ index, overlaps }) => ({ index, overlaps })), formulas: result.formulas.map(({ name, index, natural, wrapped }) => ({ name, display: index % 2 === 0, naturalWidth: natural.contentWidth, wrapWidth: wrapped.contentWidth, available: wrapped.available, zoom: wrapped.zoom })), cycles: result.cycles.map(({ cycle, jsHeapMiB, dom, mounted, browserProcesses }) => ({ cycle, jsHeapMiB, privateWorkingSetMiB: browserProcesses.privateWorkingSetMiB, domNodes: dom.nodes, mounted })), frames: result.frames, contentTransactions: 0, errors };
  await fs.writeFile('.tmp/reading-constraints-summary.json', JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary));
} catch (error) {
  result.success = false; result.failure = { phase, message: error.message, stack: error.stack };
  await screenshot('failure').catch(() => {});
  result.debug = await page.evaluate(() => ({ source: window.longContentQA?.source(), formulaNodes: [...document.querySelectorAll('.math-node')].map(el => { const ancestors = []; for (let parent = el.parentElement; parent && ancestors.length < 5; parent = parent.parentElement) ancestors.push({ tag: parent.tagName, className: parent.className, clientWidth: parent.clientWidth, offsetWidth: parent.offsetWidth, rectWidth: parent.getBoundingClientRect().width, display: getComputedStyle(parent).display }); return { className: el.className, zoom: el.querySelector('.math-preview')?.style.zoom, baseWidths: [...el.querySelectorAll('.katex-html > .base,.katex-html > .tag')].map(el => el.getBoundingClientRect().width), annotation: el.querySelector('annotation')?.textContent, ancestors, html: el.innerHTML.substring(0, 1000) }; }), reading: document.querySelector('.ProseMirror')?.dataset })).catch(() => null);
  await fs.writeFile('.tmp/reading-constraints-results.json', JSON.stringify(result, null, 2));
  console.error(JSON.stringify({ phase, failure: result.failure, errors })); throw error;
} finally { await browser.close(); await new Promise(resolve => server.httpServer.close(resolve)); }
