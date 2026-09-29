/* global window, document, getComputedStyle, requestAnimationFrame, performance */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import { build, preview } from 'vite';
import react from '@vitejs/plugin-react';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const outDir = '.tmp/long-content-dist';
if (!process.argv.includes('--reuse')) await build({ configFile: false, plugins: [react()], worker: { format: 'es' }, build: { outDir, emptyOutDir: true, rollupOptions: { input: 'test/browser/longContentViewport.html' } }, logLevel: 'error' });
const server = await preview({ configFile: false, build: { outDir }, preview: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const source = process.env.NOTEBOARD_STRESS_DOCUMENT ? await fs.readFile(process.env.NOTEBOARD_STRESS_DOCUMENT, 'utf8') : [
  '# 长内容阅读', '$$\nF(x)=' + Array.from({ length: 24 }, (_, i) => `\\frac{a_{${i}}x^{${i}}}{1+b_{${i}}}`).join('+') + '\n$$',
  '$$\nG(x)=' + Array.from({ length: 24 }, (_, i) => `\\frac{c_{${i}}x^{${i}}}{1+d_{${i}}}`).join('+') + '\n$$',
  '## 千行观测表', '| 编号 | 数值 | 说明 |', '| --- | --- | --- |',
  ...Array.from({ length: 1000 }, (_, i) => `| R${String(i + 1).padStart(6, '0')} | ${((i + 1) / 8).toFixed(3)} | 第 ${i + 1} 次观测，边界记录 CONT |`),
  '\n## 30 列宽表', '| 样本 |' + Array.from({ length: 29 }, (_, i) => ` 变量 ${i + 1} |`).join(''),
  '| ' + Array(30).fill('---').join(' | ') + ' |', ...Array.from({ length: 100 }, (_, row) => '| W' + String(row + 1).padStart(4, '0') + ' |' + Array.from({ length: 29 }, (_, i) => ` V${row + 1}C${i + 1} |`).join('')), '\nEND-OF-DOCUMENT',
].join('\n\n').replace(/\|\n\n\|/g, '|\n|');
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  page.setDefaultTimeout(15000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/test/browser/longContentViewport.html`);
  await page.waitForFunction(() => window.longContentQA?.ready());
  await page.waitForTimeout(250);
  await page.evaluate(text => window.longContentQA.load(text), source);
  await page.waitForFunction(() => document.querySelector('table tr'));
  const snapshot = await page.evaluate(() => window.longContentQA.source());
  const tables = page.locator('.ProseMirror table');
  assert.equal(await tables.first().locator('tr').count(), 1001);
  const checkpoints = [];
  for (const index of [0, 32, 36, 500, 999, 35, 730, 0]) {
    // Toolbars and mode changes register/unregister plugins without replacing rows.
    await page.evaluate(() => window.longContentQA.reconfigure());
    await tables.first().locator('tr').nth(index).evaluate(row => row.scrollIntoView({ block: 'start' }));
    await page.waitForFunction(() => {
      const viewport = document.querySelector('[data-editor-scroll]').getBoundingClientRect();
      return [...document.querySelector('table').rows].every(row => { const box = row.getBoundingClientRect(); return box.bottom <= viewport.top || box.top >= viewport.bottom || !row.classList.contains('nb-row-placeholder'); });
    }).catch(async error => { console.log(JSON.stringify(await page.evaluate(() => { const viewport = document.querySelector('[data-editor-scroll]').getBoundingClientRect(); return { visible: window.longContentQA.visibleState(), rows: [...document.querySelector('table').rows].map((row, index) => ({ index, top: row.getBoundingClientRect().top, bottom: row.getBoundingClientRect().bottom, cls: row.className, text: row.textContent })).filter(row => row.bottom > viewport.top && row.top < viewport.bottom) }; }))); console.log(errors); throw error; });
    const check = await tables.first().evaluate(table => ({ mounted: table.querySelectorAll('tr:not(.nb-row-placeholder)').length, text: [...table.rows].filter(row => !row.classList.contains('nb-row-placeholder')).map(row => row.textContent).join('\n') }));
    assert(check.mounted < 160, 'Scrolling must retain bounded cell DOM');
    assert(check.text.includes('R' + String(Math.max(1, index)).padStart(6, '0')), 'Target row must be readable');
    checkpoints.push({ index, mounted: check.mounted });
  }
  await tables.first().locator('tr').nth(35).evaluate(row => row.scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(150);
  await page.screenshot({ path: '.tmp/long-content-table.png' });
  const wide = tables.nth(1);
  await wide.evaluate(table => table.scrollIntoView({ block: 'start' }));
  await page.waitForFunction(() => document.querySelectorAll('table')[1].rows[0].cells.length === 30);
  const readWide = () => wide.evaluate(table => { const wrap = table.parentElement; return { width: table.getBoundingClientRect().width, column: table.rows[0].cells[0].getBoundingClientRect().width, row: table.rows[0].getBoundingClientRect().height, overflow: getComputedStyle(wrap).overflowX, height: table.rows.length, editorWidth: document.querySelector('.nb-document-content').getBoundingClientRect().width }; });
  const open = await readWide();
  assert(open.width > 2000 && open.column >= 100 && open.row < 150, 'Wide automatic columns must stay legible');
  assert.equal(open.overflow, 'visible', 'Natural view must not create a nested scroller');
  await page.evaluate(() => window.longContentQA.outline(false));
  const closed = await readWide();
  assert.deepEqual(closed, open, 'Outline visibility must not resize document or table');
  await page.evaluate(() => window.longContentQA.outline(true));
  await page.screenshot({ path: '.tmp/long-content-wide-table.png' });
  for (const theme of ['hu-po', 'mo-ye']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    await page.screenshot({ path: `.tmp/long-content-wide-${theme}.png` });
  }
  await page.evaluate(() => { document.documentElement.dataset.theme = 'chen-guang'; });
  const positions = await page.evaluate(() => window.longContentQA.tablePositions());
  await page.evaluate(pos => window.longContentQA.showMenu(pos), positions[1]);
  await page.getByRole('menuitemradio', { name: '滚动块' }).click();
  assert.equal((await readWide()).overflow, 'auto');
  const scroll = wide.locator('..');
  await scroll.evaluate(el => { el.scrollLeft = el.scrollWidth; el.scrollTop = el.scrollHeight / 2; });
  await page.waitForTimeout(250);
  assert(await scroll.evaluate(el => el.scrollLeft > 0 && el.scrollTop > 0), 'Explicit block scroll supports both axes');
  await page.waitForFunction(() => {
    const table = document.querySelectorAll('table')[1], box = table.parentElement.getBoundingClientRect();
    return [...table.rows].every(row => { const rect = row.getBoundingClientRect(); return rect.bottom <= box.top || rect.top >= box.bottom || !row.classList.contains('nb-row-placeholder'); });
  });
  await page.evaluate(pos => window.longContentQA.showMenu(pos), positions[1]);
  await page.getByRole('menuitemradio', { name: '自然展开' }).click();
  assert.equal((await readWide()).overflow, 'visible');
  assert(await scroll.evaluate(el => el.scrollLeft === 0 && el.scrollTop === 0), 'Leaving local scroll must reveal the entire block');
  const formula = page.locator('.math-node-display').first();
  const formulaPos = await page.evaluate(() => { let result; window.longContentQA.editor().state.doc.descendants((node, pos) => { if (result === undefined && node.type.name === 'mathBlock') result = pos; }); return result; });
  await formula.evaluate(node => node.scrollIntoView({ block: 'center' }));
  await formula.locator('.katex').first().waitFor();
  const renderedIdentity = await formula.locator('.katex').first().evaluateHandle(node => node);
  const natural = await formula.locator('.math-preview').evaluate(node => ({ width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height }));
  await page.evaluate(pos => window.longContentQA.showMenu(pos), formulaPos);
  await page.getByRole('menuitemradio', { name: '自动换行' }).click();
  const wrapped = await formula.locator('.math-preview').evaluate(node => ({ width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height, whiteSpace: getComputedStyle(node.querySelector('.katex-html')).whiteSpace }));
  assert.equal(wrapped.whiteSpace, 'normal');
  assert(await formula.locator('.katex').first().evaluate((node, before) => node === before, renderedIdentity), 'Global presentation must retain rendered KaTeX DOM');
  assert(wrapped.width <= 1500 && wrapped.height > natural.height, 'Wrap view should wrap at KaTeX boundaries');
  await page.screenshot({ path: '.tmp/long-content-formula-wrap.png' });
  const secondFormula = page.locator('.math-node-display').nth(1);
  await secondFormula.evaluate(node => node.scrollIntoView({ block: 'center' }));
  await secondFormula.locator('.katex').first().waitFor();
  assert.equal(await secondFormula.locator('.katex-html').first().evaluate(node => getComputedStyle(node).whiteSpace), 'normal', 'Other formulas must inherit the document policy when mounted');
  const secondFormulaPos = await page.evaluate(() => { const positions = []; window.longContentQA.editor().state.doc.descendants((node, pos) => { if (node.type.name === 'mathBlock') positions.push(pos); }); return positions[1]; });
  await page.evaluate(pos => window.longContentQA.showMenu(pos), secondFormulaPos);
  assert.equal(await page.getByRole('menuitemradio', { name: '自动换行' }).getAttribute('aria-checked'), 'true');
  await page.getByRole('menuitemradio', { name: '滚动块' }).click();
  assert.equal(await formula.locator('.math-node-preview').evaluate(node => getComputedStyle(node).overflowX), 'auto', 'Changing another formula menu must also affect the first formula');
  await page.evaluate(pos => window.longContentQA.showMenu(pos), formulaPos);
  await page.getByRole('menuitemradio', { name: '自然展开' }).click();
  const restored = await formula.locator('.math-preview').evaluate(node => ({ width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height }));
  assert.deepEqual(restored, natural);
  assert.equal(await page.evaluate(() => window.longContentQA.source()), snapshot);
  assert.equal(await page.evaluate(() => window.longContentQA.contentTransactions()), 0, 'View changes must not edit the document');
  await tables.first().locator('tr').nth(100).evaluate(row => row.scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(500);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const beforeMetrics = await cdp.send('Performance.getMetrics');
  if (process.env.PROFILE_SCROLL) {
    await cdp.send('Profiler.enable'); await cdp.send('Profiler.start');
    await cdp.send('Tracing.start', { categories: '-*,devtools.timeline,disabled-by-default-devtools.timeline.invalidationTracking', transferMode: 'ReturnAsStream' });
  }
  const frames = await page.evaluate(async () => {
    const scroll = document.querySelector('[data-editor-scroll]'); const samples = []; let last = performance.now();
    for (let i = 0; i < 100; i++) { await new Promise(requestAnimationFrame); const now = performance.now(); samples.push(now - last); last = now; scroll.scrollTop += i < 50 ? 180 : -180; }
    return samples.slice(3).sort((a, b) => a - b);
  });
  if (process.env.PROFILE_SCROLL) {
    await fs.writeFile('.tmp/long-content-scroll-profile.json', JSON.stringify(await cdp.send('Profiler.stop')));
    const done = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve)); await cdp.send('Tracing.end');
    const { stream } = await done; let data = '';
    for (;;) { const part = await cdp.send('IO.read', { handle: stream }); data += part.data; if (part.eof) break; }
    await cdp.send('IO.close', { handle: stream }); await fs.writeFile('.tmp/long-content-scroll-trace.json', data);
  }
  const afterMetrics = await cdp.send('Performance.getMetrics');
  await cdp.send('HeapProfiler.collectGarbage');
  const heap = await cdp.send('Runtime.getHeapUsage'), dom = await cdp.send('Memory.getDOMCounters');
  await page.waitForTimeout(200);
  assert.deepEqual(errors, []);
  const metrics = Object.fromEntries(afterMetrics.metrics.filter(item => /Duration|Count/.test(item.name)).map(item => [item.name, item.value - (beforeMetrics.metrics.find(previous => previous.name === item.name)?.value ?? 0)]));
  const result = { checkpoints, wide: open, formula: { natural, wrapped }, frames: { p95: frames[Math.floor(frames.length * .95)], max: frames.at(-1) }, metrics, memory: { jsHeapMiB: heap.usedSize / 1048576, dom }, contentTransactions: 0 };
  await fs.writeFile('.tmp/long-content-results.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await browser.close(); await new Promise(resolve => server.httpServer.close(resolve)); }
