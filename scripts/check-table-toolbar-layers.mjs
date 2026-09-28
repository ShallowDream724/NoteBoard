/* global window, document, requestAnimationFrame */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build, preview } from 'vite';
import react from '@vitejs/plugin-react';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const outDir = '.tmp/table-toolbar-layers-dist';
await build({ configFile: false, plugins: [react()], worker: { format: 'es' }, build: { outDir, emptyOutDir: true, rollupOptions: { input: 'test/browser/tableToolbarLayers.html' } }, logLevel: 'error' });
const server = await preview({ configFile: false, build: { outDir }, preview: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const frames = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/test/browser/tableToolbarLayers.html`);
  await page.waitForFunction(() => window.tableToolbarQA);
  for (const [type, name] of [['cell', '表格工具栏'], ['text', '文字工具栏']]) {
    await page.evaluate(type => window.tableToolbarQA.select(type), type);
    const toolbar = page.getByRole('toolbar', { name, exact: true });
    await toolbar.waitFor(); await frames();
    const hover = await toolbar.evaluate(element => {
      const box = element.getBoundingClientRect();
      const row = [...document.querySelector('table').rows].find(row => { const r = row.getBoundingClientRect(); return r.top < box.bottom && r.bottom > box.top; });
      if (!row) return null;
      const r = row.getBoundingClientRect();
      return { x: r.left + 3, y: box.top > r.top + 2 ? r.top + 2 : r.bottom - 2 };
    });
    assert(hover, `${name} must overlap an actual table row`);
    await page.mouse.move(hover.x, hover.y); await frames();
    const overlap = await toolbar.evaluate(element => {
      const rail = document.querySelector('.nb-table-select-row:not([hidden])');
      if (!rail || rail.parentElement.hidden) return null;
      const r = rail.getBoundingClientRect();
      for (const button of element.querySelectorAll('button:not(:disabled)')) {
        const b = button.getBoundingClientRect(), left = Math.max(r.left, b.left), right = Math.min(r.right, b.right), top = Math.max(r.top, b.top), bottom = Math.min(r.bottom, b.bottom);
        if (right - left > 2 && bottom - top > 2) {
          const x = (left + right) / 2, y = (top + bottom) / 2;
          return { x, y, label: button.getAttribute('aria-label'), toolbarWins: button.contains(document.elementFromPoint(x, y)) };
        }
      }
      return null;
    });
    assert(overlap, `${name} must overlap a rail and a real enabled button`);
    assert(overlap.toolbarWins, `${name} button must win hit testing over the rail`);
    await page.evaluate(() => {
      window.toolbarClick = null;
      document.addEventListener('click', event => { const target = event.target.closest?.('button'); if (target) window.toolbarClick = target.closest('[role="toolbar"]')?.getAttribute('aria-label') || 'rail'; }, { once: true, capture: true });
    });
    await page.mouse.click(overlap.x, overlap.y);
    assert.equal(await page.evaluate(() => window.toolbarClick), name, `${name} must receive the real pointer click`);
    await page.keyboard.press('Escape');
  }
  await page.reload(); await page.waitForFunction(() => window.tableToolbarQA);
  const rows = await page.locator('table > tbody > tr').evaluateAll(rows => rows.map(row => { const r = row.getBoundingClientRect(); return { x: r.left, y: r.top, height: r.height }; }));
  await page.mouse.move(rows[1].x + 3, rows[1].y + 8); await frames();
  await page.locator('.nb-table-select-row:not([hidden])').click();
  assert.equal((await page.evaluate(() => window.tableToolbarQA.selection())).row, true, 'Exposed row rail must keep selecting');
  await page.mouse.move(rows[4].x + 30, rows[4].y + rows[4].height - 3); await frames();
  await page.locator('.nb-table-select-column:not([hidden])').click();
  assert.equal((await page.evaluate(() => window.tableToolbarQA.selection())).column, true, 'Exposed column rail must keep selecting');
  assert.deepEqual(errors, []);
  console.log('Passed: real text/table toolbar buttons win overlapping rails inside an isolated editor; exposed row and column rails remain selectable.');
} finally { await browser.close(); await new Promise(resolve => server.httpServer.close(resolve)); }
