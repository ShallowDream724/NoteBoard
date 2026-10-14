/* global window, document, requestAnimationFrame */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
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
  const layouts = [];
  for (const width of [1400, 1000, 760, 520]) {
    await page.setViewportSize({ width, height: 800 });
    for (const type of ['cell', 'row', 'column', 'all']) {
      const heights = [];
      for (const column of [0, 1]) {
        await page.evaluate(({ type, column }) => window.tableToolbarQA.select(type, column), { type, column });
        const toolbar = page.getByRole('toolbar', { name: '表格工具栏', exact: true });
        await toolbar.waitFor(); await frames(); await frames();
        const layout = await toolbar.evaluate(element => {
          const box = element.getBoundingClientRect();
          const rowCenter = button => { const rect = button.getBoundingClientRect(); return Math.round(rect.top + rect.height / 2); };
          const buttons = [...element.querySelectorAll('button')].map(button => ({ label: button.getAttribute('aria-label'), row: rowCenter(button) }));
          const group = element.querySelector('[aria-label="表格操作"]');
          const groupRows = new Set([...group.querySelectorAll('button')].map(rowCenter));
          const deletion = [...group.querySelectorAll('button')].find(button => /^(删除|清空)/.test(button.getAttribute('aria-label') || ''));
          const d = deletion.getBoundingClientRect();
          return { width: box.width, left: box.left, right: box.right, height: box.height, rows: new Set(buttons.map(button => button.row)).size,
            actionRows: groupRows.size, deleteReachable: deletion.contains(document.elementFromPoint(d.left + d.width / 2, d.top + d.height / 2)) };
        });
        assert(layout.left >= 7 && layout.right <= width - 7, JSON.stringify({ width, type, column, layout }));
        if (width >= 1000) assert.equal(layout.rows, 1, `Wide pane must stay on one row: ${JSON.stringify({ width, type, column, layout })}`);
        assert.equal(layout.actionRows, 1, 'Delete stays with the table action group');
        assert(layout.deleteReachable, 'Delete remains directly reachable');
        heights.push(layout.height); layouts.push({ viewport: width, type, column, ...layout });
      }
      assert.equal(heights[0], heights[1], 'Changing only the anchor must not wrap the toolbar');
    }
  }
  // A sidebar resize changes the editor pane without resizing the window.
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.evaluate(() => { document.getElementById('editor-shell').style.width = '390px'; window.tableToolbarQA.select('row'); });
  await frames(); await frames();
  const paneLayout = await page.getByRole('toolbar', { name: '表格工具栏', exact: true }).boundingBox();
  assert(paneLayout.x >= 7 && paneLayout.x + paneLayout.width <= 383, 'Toolbar follows the resized pane');
  await fs.mkdir('.tmp/table-toolbar-layout', { recursive: true });
  await page.screenshot({ path: '.tmp/table-toolbar-layout/narrow-pane.png' });
  await page.evaluate(() => { document.getElementById('editor-shell').style.width = ''; window.tableToolbarQA.select('row'); });
  await frames(); await frames();
  await page.screenshot({ path: '.tmp/table-toolbar-layout/wide-pane.png' });
  await fs.writeFile('.tmp/table-toolbar-layout/results.json', JSON.stringify(layouts, null, 2));
  assert.deepEqual(errors, []);
  console.log('Passed: toolbar hit testing, exposed rails, 32 selection/anchor/viewport layouts and sidebar resize.');
} finally { await browser.close(); await new Promise(resolve => server.httpServer.close(resolve)); }
