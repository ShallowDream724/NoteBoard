/* global document, window, getComputedStyle */
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const runtime = process.env.NOTEBOARD_PLAYWRIGHT ?? resolve(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const { chromium } = await import(pathToFileURL(runtime).href);
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--no-proxy-server'] });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${process.env.NOTEBOARD_QA_URL ?? 'http://127.0.0.1:26357'}/test/browser/visualWorkflow.html`, { waitUntil: 'commit' });
  await page.waitForFunction(() => window.visualWorkflowQA?.ready());
  await page.evaluate(() => {
    const editor = window.visualWorkflowQA.editor();
    window.visualWorkflowQA.load([{ type: 'orderedList', attrs: { start: 99 }, content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '跨位数边界' }] }] }] }]);
    editor.commands.setTextSelection(3 + '跨位数边界'.length);
    editor.commands.splitListItem('listItem');
  });
  assert.equal(await page.locator('.ProseMirror > ol').getAttribute('data-numbering-layout'), 'columns');
  assert.equal(await page.locator('.ProseMirror > ol > li').count(), 2, 'Enter lost its new row at the digit boundary');
  for (const width of [680, 1400]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const numberStyle of ['decimal', 'circle', 'box', 'chinese', 'paren', 'upper-roman', 'lower-roman', 'upper-alpha', 'lower-alpha']) {
      await page.evaluate(numberStyle => {
        const p = text => ({ type: 'paragraph', ...(text ? { content: [{ type: 'text', text }] } : {}) });
        const nested = { type: 'orderedList', attrs: { start: 100, numberStyle: 'circle' }, content: [{ type: 'listItem', content: [p('嵌套列表')] }] };
        window.visualWorkflowQA.load([{ type: 'orderedList', attrs: { start: 999999999, numberStyle }, content: [
          { type: 'listItem', content: [p('长编号正文，仍能在窄窗口中正常换行。'.repeat(5)), nested] },
          { type: 'listItem', content: [p('')] }, { type: 'listItem', content: [p('最后一项')] },
        ] }]);
      }, numberStyle);
      const layout = await page.locator('.ProseMirror').evaluate(root => {
        const ol = root.querySelector('ol'), rect = ol.getBoundingClientRect(), rows = [...ol.children];
        return { start: ol.start, grid: getComputedStyle(ol).display, x: rect.x, right: rect.right,
          textX: rows.map(row => row.firstElementChild.getBoundingClientRect().x),
          rowY: rows.map(row => row.getBoundingClientRect().y),
          textY: rows.map(row => row.firstElementChild.getBoundingClientRect().y),
          markerHeight: rows.map(row => parseFloat(getComputedStyle(row, '::before').height)),
          lineHeight: parseFloat(getComputedStyle(rows[0].firstElementChild).lineHeight),
          scrollWidth: root.scrollWidth, width: root.clientWidth };
      });
      assert.equal(layout.start, 999999999); assert.equal(layout.grid, 'grid');
      assert(Math.max(...layout.textX) - Math.min(...layout.textX) < .1, `text column drifted: ${numberStyle}`);
      assert(layout.textY.every((y, i) => Math.abs(y - layout.rowY[i]) < .1), `marker displaced text: ${numberStyle}`);
      assert(layout.scrollWidth <= layout.width + 1, `long marker overflowed: ${numberStyle}/${width}`);
      if (numberStyle === 'circle' || numberStyle === 'box') assert(layout.markerHeight.every(height => height <= layout.lineHeight), 'outline grew into an adjacent row');
      await page.locator('.ProseMirror > ol > li > p').nth(1).hover();
      const handle = page.locator('.nb-block-drag-handle'); await handle.waitFor();
      const bounds = await handle.boundingBox();
      assert(bounds.width >= 49 && bounds.x >= 0 && bounds.x + bounds.width <= layout.x, `drag controls crowded out: ${numberStyle}/${width}`);
    }
  }
  await page.locator('.nb-block-drag-handle').click();
  await page.locator('.nb-block-menu-popover button[aria-label="有序列表选项"]').click();
  const input = page.getByRole('spinbutton', { name: '重新编号起始值' });
  await input.fill('7'); await input.fill('10000000000');
  assert.equal(await input.getAttribute('aria-invalid'), 'true');
  assert(await page.getByRole('status').filter({ hasText: '999,999,999' }).isVisible());
  assert(await input.evaluate(element => document.activeElement === element), 'invalid input lost menu focus');
  assert.equal(await page.locator('.ProseMirror > ol').getAttribute('start'), '999999999', 'invalid value committed the previous valid preview');
  await input.fill('999999999'); await input.press('Enter');
  assert.equal(await page.locator('.ProseMirror > ol').last().getAttribute('start'), '999999999');
  const exported = await page.evaluate(() => window.visualWorkflowQA.exportHtml());
  const exportPage = await browser.newPage({ viewport: { width: 680, height: 900 } });
  await exportPage.setContent(exported, { waitUntil: 'domcontentloaded' });
  assert.equal(await exportPage.locator('article > ol').first().evaluate(element => getComputedStyle(element).display), 'grid');
  assert(await exportPage.locator('ol > li').evaluateAll(elements => elements.every(li => Math.abs(li.getBoundingClientRect().y - li.firstElementChild.getBoundingClientRect().y) < .1)), 'export marker missed its first paragraph baseline');
  if (process.env.NOTEBOARD_QA_SCREENSHOT) await page.screenshot({ path: process.env.NOTEBOARD_QA_SCREENSHOT });
  await exportPage.close(); assert.deepEqual(errors, []);
  console.log('Long numbering: nine styles, nested/empty/wrapped rows, narrow/wide layouts, full drag controls, invalid input rollback and export passed.');
} finally { await browser.close(); }
