/* global document, window */
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const runtime = process.env.NOTEBOARD_PLAYWRIGHT ?? resolve(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const { chromium } = await import(pathToFileURL(runtime).href);

// Run against `npm run dev -- --host 127.0.0.1 --port 4173 --strictPort`.
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  await page.goto('http://127.0.0.1:4173/test/browser/dragEdgeScroll.html');
  await page.waitForFunction(() => !!window.dragEdgeQA && document.querySelectorAll('table tr').length === 40);
  const geometry = await page.evaluate(() => {
    const scroller = document.querySelector('#scroller');
    const table = document.querySelector('table');
    const wrapper = table.parentElement;
    const row = table.rows[1];
    const s = scroller.getBoundingClientRect(), t = table.getBoundingClientRect(), w = wrapper.getBoundingClientRect(), r = row.getBoundingClientRect();
    return { x: (w.left + t.left) / 2, y: (r.top + r.bottom) / 2, edgeY: s.bottom - 8,
      firstCell: table.rows[0].cells[0].getBoundingClientRect().toJSON() };
  });

  await page.mouse.move(geometry.x, geometry.y);
  await page.mouse.down();
  await page.mouse.move(geometry.x, geometry.edgeY);
  await page.waitForTimeout(160);
  const first = await page.evaluate(() => ({ scroll: document.querySelector('#scroller').scrollTop, rows: window.dragEdgeQA.selectionRows() }));
  await page.waitForTimeout(500);
  const second = await page.evaluate(() => ({ scroll: document.querySelector('#scroller').scrollTop, rows: window.dragEdgeQA.selectionRows() }));
  assert(second.scroll > first.scroll + 20, `stationary margin drag did not scroll: ${JSON.stringify({ first, second })}`);
  assert(first.rows && second.rows && second.rows[1] > first.rows[1], `selection did not follow scrolled rows: ${JSON.stringify({ first, second })}`);
  await page.mouse.up();
  await page.waitForTimeout(120);
  const afterUp = await page.evaluate(() => document.querySelector('#scroller').scrollTop);
  assert(Math.abs(afterUp - second.scroll) < 2, `scroll continued after mouseup: ${second.scroll} -> ${afterUp}`);

  await page.evaluate(() => { document.querySelector('#scroller').scrollTop = 0; });
  await page.mouse.move(geometry.firstCell.left + 30, geometry.firstCell.top + 14);
  const handle = page.locator('.nb-table-select-handle.nb-table-select-row:not([hidden])');
  await handle.waitFor();
  const box = await handle.boundingBox();
  assert(box, 'row reorder handle has no visible bounds');
  const hx = box.x + box.width / 2, hy = box.y + box.height / 2;
  const original = await page.evaluate(() => window.dragEdgeQA.rowLabels());
  await page.mouse.move(hx, hy);
  await page.mouse.down();
  await page.mouse.move(hx, hy + 12);
  await page.mouse.move(hx, geometry.edgeY);
  await page.waitForTimeout(160);
  const reorderFirst = await page.evaluate(() => ({ scroll: document.querySelector('#scroller').scrollTop, guide: document.querySelector('.nb-table-move-guide').getBoundingClientRect().top, hidden: document.querySelector('.nb-table-move-guide').hidden }));
  await page.waitForTimeout(500);
  const reorderSecond = await page.evaluate(() => ({ scroll: document.querySelector('#scroller').scrollTop, guide: document.querySelector('.nb-table-move-guide').getBoundingClientRect().top, hidden: document.querySelector('.nb-table-move-guide').hidden }));
  assert(reorderSecond.scroll > reorderFirst.scroll + 20, `stationary reorder did not scroll: ${JSON.stringify({ reorderFirst, reorderSecond })}`);
  assert(!reorderSecond.hidden && reorderSecond.guide + reorderSecond.scroll > reorderFirst.guide + reorderFirst.scroll + 20,
    `drop guide did not follow content: ${JSON.stringify({ reorderFirst, reorderSecond })}`);
  await page.keyboard.press('Escape');
  const atCancel = await page.evaluate(() => document.querySelector('#scroller').scrollTop);
  await page.waitForTimeout(120);
  const afterCancel = await page.evaluate(() => ({ scroll: document.querySelector('#scroller').scrollTop, rows: window.dragEdgeQA.rowLabels() }));
  assert(Math.abs(afterCancel.scroll - atCancel) < 2, `scroll continued after Escape: ${atCancel} -> ${afterCancel.scroll}`);
  assert.deepEqual(afterCancel.rows, original, 'Escape committed the row reorder');
  await page.mouse.up();
  console.log(JSON.stringify({ margin: { first, second, afterUp }, reorder: { reorderFirst, reorderSecond, atCancel, afterCancelScroll: afterCancel.scroll } }, null, 2));
} finally {
  await browser.close();
}
