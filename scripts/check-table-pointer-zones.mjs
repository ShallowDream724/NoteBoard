/* global window, document, requestAnimationFrame, getComputedStyle */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build, preview } from 'vite';
import react from '@vitejs/plugin-react';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const outDir = '.tmp/table-pointer-dist';
const baseUrl = process.argv.find(value => value.startsWith('--base-url='))?.slice('--base-url='.length);
let server;
if (!baseUrl) {
  await build({ configFile: false, plugins: [react()], worker: { format: 'es' }, build: { outDir, emptyOutDir: true, rollupOptions: { input: 'test/browser/tablePointerZones.html' } }, logLevel: 'error' });
  server = await preview({ configFile: false, build: { outDir }, preview: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
}
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--no-proxy-server'] });
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  if (baseUrl) await page.routeWebSocket('**', socket => socket.close());
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${baseUrl || `http://127.0.0.1:${server.httpServer.address().port}`}/test/browser/tablePointerZones.html`, { waitUntil: 'commit' });
  await page.waitForFunction(() => window.tablePointerQA, undefined, { timeout: 120_000 });
  await page.locator('.ProseMirror > p').first().click();
  await page.getByRole('button', { name: '编辑表注' }).click();
  await page.getByRole('textbox', { name: '表注', exact: true }).waitFor();
  await page.waitForTimeout(550);
  assert(await page.getByRole('textbox', { name: '表注', exact: true }).evaluate(element => document.activeElement === element), 'A first caption click from body text must remain focused');
  await page.reload({ waitUntil: 'commit' }); await page.waitForFunction(() => window.tablePointerQA);
  await page.locator('.ProseMirror > p').first().click();
  const captionGap = await page.evaluate(() => {
    const caption = document.querySelector('table caption'), box = caption.getBoundingClientRect();
    const x = (box.left + box.right) / 2, y = box.top + 1;
    const target = document.elementFromPoint(x, y);
    return { x, y, targetIsCaption: target === caption };
  });
  assert(captionGap.targetIsCaption, 'The caption top gap must target the caption DOM');
  await page.mouse.click(captionGap.x, captionGap.y);
  await page.getByRole('textbox', { name: '表注', exact: true }).waitFor();
  await page.waitForTimeout(550);
  assert(await page.getByRole('textbox', { name: '表注', exact: true }).evaluate(element => document.activeElement === element), 'A first click in the caption top gap must focus its editor');
  await page.reload({ waitUntil: 'commit' }); await page.waitForFunction(() => window.tablePointerQA);
  const rows = await page.locator('table > tbody > tr').evaluateAll(items => items.map(row => { const box = row.getBoundingClientRect(); return { top: box.top, bottom: box.bottom, left: box.left, right: box.right }; }));
  const middle = row => (row.top + row.bottom) / 2;
  await page.mouse.click(rows[1].left - 45, middle(rows[1]));
  assert.deepEqual(await page.evaluate(() => window.tablePointerQA.selection()), { cell: true, rows: true, columns: false, count: 2 });
  await page.mouse.move(rows[1].right + 45, middle(rows[1])); await page.mouse.down();
  await page.mouse.move(rows[3].right + 45, middle(rows[3]), { steps: 6 }); await page.mouse.up();
  assert.deepEqual(await page.evaluate(() => window.tablePointerQA.selection()), { cell: true, rows: true, columns: false, count: 6 });
  const zones = await page.evaluate(() => {
    const editor = document.querySelector('.ProseMirror'), wrapper = editor.querySelector('.tableWrapper');
    const table = wrapper.querySelector('table'), caption = table.querySelector('caption');
    const paragraphs = editor.querySelectorAll(':scope > p');
    const grid = table.rows[0].getBoundingClientRect(), wrap = wrapper.getBoundingClientRect();
    const note = caption.getBoundingClientRect(), before = paragraphs[0].getBoundingClientRect(), after = paragraphs[paragraphs.length - 1].getBoundingClientRect();
    const x0 = grid.left + (grid.right - grid.left) * .25, x1 = grid.left + (grid.right - grid.left) * .75;
    const top = (before.bottom + wrap.top) / 2, bottom = (Math.max(wrap.bottom, note.bottom) + after.top) / 2;
    return { x0, x1, top, bottom, targets: [document.elementFromPoint(x0, top) === editor, document.elementFromPoint(x1, bottom) === editor] };
  });
  assert.deepEqual(zones.targets, [true, true], 'Both margin clicks must target the editor itself');
  await page.mouse.click(zones.x0, zones.top);
  assert.deepEqual(await page.evaluate(() => window.tablePointerQA.selection()), { cell: true, rows: false, columns: true, count: 4 });
  await page.mouse.move(zones.x1, zones.bottom); await page.mouse.down();
  await page.mouse.move(zones.x0, zones.bottom, { steps: 6 }); await page.mouse.up();
  assert.deepEqual(await page.evaluate(() => window.tablePointerQA.selection()), { cell: true, rows: true, columns: true, count: 8 });
  await page.locator('.ProseMirror > p').last().click({ position: { x: 30, y: 12 } });
  await page.waitForFunction(() => !window.tablePointerQA.selection().cell);
  await page.mouse.move(rows[3].right - 20, rows[3].bottom - 3);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const column = await page.locator('.nb-table-select-column-bottom:not([hidden])').boundingBox();
  assert(column && column.y >= rows[3].bottom + 5, 'Column hit target must leave the bottom resize band free');
  const caption = page.getByRole('button', { name: '编辑表注' });
  const before = await caption.boundingBox();
  assert(column.y + column.height <= before.y + .5, 'Column hit target must not cover caption content');
  const lowerBefore = await page.locator('.ProseMirror > p').last().boundingBox();
  await caption.click();
  const input = page.getByRole('textbox', { name: '表注', exact: true });
  await input.waitFor();
  assert(await input.evaluate(element => document.activeElement === element), 'One click must focus the caption');
  assert(Math.abs((await input.boundingBox()).height - before.height) < 2, 'Entering the caption must keep its height');
  assert(Math.abs((await page.locator('.ProseMirror > p').last().boundingBox()).y - lowerBefore.y) < 2, 'Caption editing must not move the following paragraph');
  await page.screenshot({ path: '.tmp/ux6-table-caption.png', fullPage: true });
  const frame = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const reset = async () => { await page.reload({ waitUntil: 'commit' }); await page.waitForFunction(() => window.tablePointerQA); await frame(); };
  const grid = () => page.locator('table > tbody > tr').evaluateAll(items => items.map(row => {
    const box = row.getBoundingClientRect(); return { top: box.top, bottom: box.bottom, left: box.left, right: box.right, height: box.height };
  }));
  // The same two controls must work from all four sides without changing the
  // document, shifting its caption, or intercepting the 5px cell resize band.
  for (const side of ['left', 'right', 'top', 'bottom']) {
    await reset();
    const initial = await grid(), source = await page.evaluate(() => window.tablePointerQA.source());
    const captionBefore = await page.getByRole('button', { name: '编辑表注' }).boundingBox();
    const rowSide = side === 'left' || side === 'right';
    const x = side === 'right' ? initial[0].right - 20 : initial[0].left + 30;
    const y = side === 'bottom' ? initial.at(-1).bottom - 15 : initial[0].top + 15;
    await page.mouse.move(x, y); await frame();
    const rail = page.locator(rowSide ? '.nb-table-select-row:not([hidden])' : '.nb-table-select-column:not([hidden])');
    const railBox = await rail.boundingBox();
    assert(railBox, `${side}: rail must be visible`);
    const resizePoint = side === 'right' ? { x: initial[0].right - 1, y }
      : side === 'bottom' ? { x, y: initial.at(-1).bottom - 1 } : null;
    if (resizePoint) assert(await page.evaluate(({ x, y }) => !document.elementFromPoint(x, y)?.closest('.nb-table-select-handle'), resizePoint), `${side}: rail must not intercept resizing`);
    assert.deepEqual(await grid(), initial, `${side}: displaying rails must not move the grid`);
    assert.equal((await page.getByRole('button', { name: '编辑表注' }).boundingBox()).y, captionBefore.y, `${side}: displaying rails must not move the caption`);
    await rail.click();
    assert.deepEqual(await page.evaluate(() => window.tablePointerQA.selection()), { cell: true, rows: rowSide, columns: !rowSide, count: rowSide ? 2 : 4 });
    assert.equal(await page.evaluate(() => window.tablePointerQA.source()), source, `${side}: selection must preserve the document`);
    assert.equal(await page.evaluate(() => window.tablePointerQA.changes()), 0);
    // Reorder through the visible rail. Preview is purely geometric; release
    // writes a single structural transaction and retains every cell.
    await page.mouse.move(railBox.x + railBox.width / 2, railBox.y + railBox.height / 2); await page.mouse.down();
    await page.mouse.move(rowSide ? railBox.x + railBox.width / 2 : initial[0].right - 2,
      rowSide ? initial[2].bottom - 2 : railBox.y + railBox.height / 2, { steps: 8 });
    await frame();
    assert.equal(await page.evaluate(() => window.tablePointerQA.changes()), 0, `${side}: dragging must not mutate the document`);
    await page.mouse.up(); await frame();
    assert.equal(await page.evaluate(() => window.tablePointerQA.changes()), 1, `${side}: reorder commits once`);
    const values = await page.evaluate(() => window.tablePointerQA.values());
    assert.deepEqual(rowSide ? values.map(row => row[0]) : values[0], rowSide ? ['2 / 1', '3 / 1', '1 / 1', '4 / 1'] : ['1 / 2', '1 / 1']);
  }
  for (const axis of ['row', 'column']) {
    await reset();
    const initial = await grid(), last = initial.at(-1);
    const x = axis === 'row' ? last.left + 40 : last.right - 1;
    const y = axis === 'row' ? last.bottom - 1 : initial[0].top + 16;
    await page.mouse.move(x, y); await frame();
    assert(await page.locator(axis === 'row' ? '.nb-table-select-column-bottom:not([hidden])' : '.nb-table-select-row-right:not([hidden])').isVisible(), `${axis}: test starts with the adjacent rail visible`);
    await page.mouse.down(); await page.mouse.move(x + (axis === 'column' ? 45 : 0), y + (axis === 'row' ? 35 : 0), { steps: 8 }); await frame();
    assert.equal(await page.evaluate(() => window.tablePointerQA.changes()), 0, `${axis}: resizing previews without transactions`);
    await page.mouse.up(); await frame();
    const resized = await grid();
    assert.equal(await page.evaluate(() => window.tablePointerQA.changes()), 1, `${axis}: resizing commits once`);
    assert(axis === 'row' ? resized.at(-1).height > last.height + 30 : resized[0].right - resized[0].left > initial[0].right - initial[0].left + 40, `${axis}: edge remains draggable`);
  }
  await reset();
  const source = await page.evaluate(() => window.tablePointerQA.source());
  const spacing = () => page.evaluate(() => ({
    caption: getComputedStyle(document.querySelector('.nb-table-caption')).marginTop,
    table: getComputedStyle(document.querySelector('.tableWrapper')).marginTop,
  }));
  assert.deepEqual(await spacing(), { caption: '14px', table: '24px' });
  await page.emulateMedia({ media: 'print' });
  assert.deepEqual(await spacing(), { caption: '6px', table: '16px' }, 'Editing gutters must not increase print spacing');
  await page.emulateMedia({ media: 'screen' });
  assert.equal(await page.evaluate(() => window.tablePointerQA.source()), source, 'Presentation spacing must not change document data');
  assert.deepEqual(errors, []);
  console.log('Passed: all four rails select and reorder; right/bottom resizing stays accessible; gestures preview without transactions and commit once; caption focus and layout stay stable; surrounding margin selection works.');
} finally { await browser.close(); if (server) await new Promise(resolve => server.httpServer.close(resolve)); }
