/* global window, document, requestAnimationFrame */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build, preview } from 'vite';
import react from '@vitejs/plugin-react';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const outDir = '.tmp/table-pointer-dist';
await build({ configFile: false, plugins: [react()], worker: { format: 'es' }, build: { outDir, emptyOutDir: true, rollupOptions: { input: 'test/browser/tablePointerZones.html' } }, logLevel: 'error' });
const server = await preview({ configFile: false, build: { outDir }, preview: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/test/browser/tablePointerZones.html`);
  await page.waitForFunction(() => window.tablePointerQA);
  const rows = await page.locator('table > tbody > tr').evaluateAll(items => items.map(row => { const box = row.getBoundingClientRect(); return { top: box.top, bottom: box.bottom, left: box.left, right: box.right }; }));
  const middle = row => (row.top + row.bottom) / 2;
  await page.mouse.click(rows[1].left - 45, middle(rows[1]));
  assert.deepEqual(await page.evaluate(() => window.tablePointerQA.selection()), { cell: true, rows: true, count: 2 });
  await page.mouse.move(rows[1].right + 45, middle(rows[1])); await page.mouse.down();
  await page.mouse.move(rows[3].right + 45, middle(rows[3]), { steps: 6 }); await page.mouse.up();
  assert.deepEqual(await page.evaluate(() => window.tablePointerQA.selection()), { cell: true, rows: true, count: 6 });
  await page.mouse.move(rows[3].right - 20, rows[3].bottom - 3);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const column = await page.locator('.nb-table-select-column-bottom:not([hidden])').boundingBox();
  assert(column && column.y + column.height <= rows[3].bottom + .5, 'Column hit target must not cover the caption');
  const caption = page.getByRole('button', { name: '编辑表注' });
  const before = await caption.boundingBox();
  const lowerBefore = await page.locator('.ProseMirror > p').last().boundingBox();
  await caption.click();
  const input = page.getByRole('textbox', { name: '表注', exact: true });
  await input.waitFor();
  assert(await input.evaluate(element => document.activeElement === element), 'One click must focus the caption');
  assert(Math.abs((await input.boundingBox()).height - before.height) < 2, 'Entering the caption must keep its height');
  assert(Math.abs((await page.locator('.ProseMirror > p').last().boundingBox()).y - lowerBefore.y) < 2, 'Caption editing must not move the following paragraph');
  await page.screenshot({ path: '.tmp/ux6-table-caption.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('Passed: left/right margin row selection, drag range, caption hit separation and single-click stable caption focus.');
} finally { await browser.close(); await new Promise(resolve => server.httpServer.close(resolve)); }
