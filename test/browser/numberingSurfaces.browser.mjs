/* global document, window, getComputedStyle */
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const runtime = process.env.NOTEBOARD_PLAYWRIGHT ?? resolve(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const { chromium } = await import(pathToFileURL(runtime).href);
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--no-proxy-server'] });
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${process.env.NOTEBOARD_QA_URL ?? 'http://127.0.0.1:14357'}/test/browser/visualWorkflow.html`, { waitUntil: 'commit' });
  await page.waitForFunction(() => window.visualWorkflowQA?.ready());
  await page.evaluate(() => {
    const p = text => ({ type: 'paragraph', ...(text ? { content: [{ type: 'text', text }] } : {}) });
    const item = text => ({ type: 'listItem', content: [p(text)] });
    window.visualWorkflowQA.load([
      { type: 'bulletList', content: ['一', '二', '三'].map(item) },
      { type: 'orderedList', attrs: { start: 1, numberStyle: 'circle' }, content: ['四', '五', ''].map(item) },
    ]);
  });
  for (const [fontSize, lineHeight] of [[16, 1.7], [24, 2.1]]) {
    const geometry = await page.evaluate(({ fontSize, lineHeight }) => {
      const root = document.querySelector('.ProseMirror');
      root.style.fontSize = `${fontSize}px`; root.style.setProperty('--content-line-height', lineHeight);
      const paragraphs = [...root.querySelectorAll('li > p')], ys = paragraphs.map(p => p.getBoundingClientRect().y);
      const offsets = [...root.querySelectorAll('ol > li')].map(li => {
        const row = li.getBoundingClientRect(), text = li.firstElementChild.getBoundingClientRect(), marker = getComputedStyle(li, '::before');
        const center = marker.position === 'static' ? parseFloat(marker.marginTop) + parseFloat(marker.height) / 2 : parseFloat(marker.top);
        return row.y + center - text.y - text.height / 2;
      });
      return { gaps: ys.slice(1).map((y, i) => y - ys[i]), offsets };
    }, { fontSize, lineHeight });
    assert(geometry.offsets.every(offset => Math.abs(offset) < .5), `outlined marker missed its line: ${JSON.stringify(geometry)}`);
    assert(Math.max(...geometry.gaps) - Math.min(...geometry.gaps) < .5, `list boundary changed row rhythm: ${JSON.stringify(geometry)}`);
  }
  await page.locator('.ProseMirror ol li p').nth(1).hover();
  const handle = page.locator('.nb-block-drag-handle'); await handle.waitFor(); await handle.click();
  await page.locator('.nb-block-menu-popover button[aria-label="有序列表选项"]').click();
  const input = page.getByRole('spinbutton', { name: '重新编号起始值' });
  await input.fill('7'); await input.fill('12');
  await page.mouse.move(1300, 900); await page.waitForTimeout(450);
  assert(await page.locator('.nb-block-menu-popover').isVisible(), 'input unmounted the outer block menu');
  assert(await input.isVisible(), 'input unmounted the numbering menu');
  assert(await input.evaluate(element => document.activeElement === element), 'live preview lost input focus');
  assert(await handle.isVisible(), 'live preview hid the handle');
  await input.press('Escape');
  assert.deepEqual(await page.locator('.ProseMirror ol').evaluateAll(lists => lists.map(list => list.start)), [1], 'Escape did not restore the list');

  await page.locator('.ProseMirror ol li p').nth(1).hover(); await handle.click();
  await page.locator('.nb-block-menu-popover button[aria-label="有序列表选项"]').click();
  await input.fill('7'); await input.fill('12'); await input.press('Enter');
  assert.deepEqual(await page.locator('.ProseMirror ol').evaluateAll(lists => lists.map(list => list.start)), [1, 12]);
  await page.keyboard.press('Control+z');
  assert.deepEqual(await page.locator('.ProseMirror ol').evaluateAll(lists => lists.map(list => list.start)), [1], 'one undo did not restore the whole input');

  await page.locator('.ProseMirror ol li p').first().hover(); await handle.click();
  const active = page.locator('.nb-block-menu-popover .nb-numbering-control');
  assert.equal(await active.locator('.nb-numbering-main').evaluate(element => getComputedStyle(element).backgroundColor), 'rgba(0, 0, 0, 0)', 'active split button painted a second inner selection');
  await active.getByRole('button', { name: '有序列表选项', exact: true }).click();
  await page.getByRole('button', { name: '编号样式', exact: true }).click();
  const samples = await page.locator('.nb-numbering-style-sample').evaluateAll(elements => elements.map(element => [...element.children].map(row => {
    const marker = row.querySelector('b').getBoundingClientRect(), line = row.querySelector('i').getBoundingClientRect();
    return { markerRight: marker.right, lineX: line.x, center: line.y + line.height / 2, rowCenter: row.getBoundingClientRect().y + row.getBoundingClientRect().height / 2 };
  })));
  assert.equal(samples.length, 9);
  for (const rows of samples) {
    assert(Math.max(...rows.map(row => row.markerRight)) - Math.min(...rows.map(row => row.markerRight)) < .1, 'sample numbering column is not right aligned');
    assert(rows.every(row => Math.abs(row.center - row.rowCenter) < .1), 'sample stroke missed its row center');
  }
  for (let index = 0; index < 9; index += 3) {
    for (let row = 0; row < 3; row++) assert(Math.max(...samples.slice(index, index + 3).map(sample => sample[row].center)) - Math.min(...samples.slice(index, index + 3).map(sample => sample[row].center)) < .1, 'styles do not share row baselines');
  }
  if (process.env.NOTEBOARD_QA_SCREENSHOT) await page.screenshot({ path: process.env.NOTEBOARD_QA_SCREENSHOT });
  const textBefore = await page.locator('.ProseMirror li > p').allTextContents();
  await page.locator('.ProseMirror ul li p').nth(2).click();
  await page.locator('.ProseMirror ul li p').nth(2).hover(); await handle.click();
  await page.locator('.nb-block-menu-popover').getByRole('button', { name: '有序列表', exact: true }).click();
  assert.deepEqual(await page.locator('.ProseMirror li > p').allTextContents(), textBefore, 'list conversion created/deleted/reordered rows');
  const convertedGaps = await page.locator('.ProseMirror li > p').evaluateAll(elements => {
    const ys = elements.map(element => element.getBoundingClientRect().y); return ys.slice(1).map((y, index) => y - ys[index]);
  });
  assert(Math.max(...convertedGaps) - Math.min(...convertedGaps) < .5, 'actual list conversion changed row rhythm');

  await page.evaluate(() => {
    window.visualWorkflowQA.load([{ type: 'orderedList', attrs: { start: 999, numberStyle: 'circle' }, content: ['长编号一', '长编号二', '长编号三'].map(text => ({ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })) }]);
  });
  assert(await page.locator('.ProseMirror ol > li').evaluateAll(elements => elements.every(li => parseFloat(getComputedStyle(li, '::before').height) <= li.firstElementChild.getBoundingClientRect().height)), 'long counters grew taller than their text rows');

  const exported = await page.evaluate(() => window.visualWorkflowQA.exportHtml());
  const exportPage = await browser.newPage();
  await exportPage.setContent(exported, { waitUntil: 'domcontentloaded' });
  const exportOffsets = await exportPage.locator('ol[data-number-style="circle"] > li').evaluateAll(elements => elements.map(li => {
    const row = li.getBoundingClientRect(), text = li.firstElementChild.getBoundingClientRect(), marker = getComputedStyle(li, '::before');
    const center = marker.position === 'static' ? parseFloat(marker.marginTop) + parseFloat(marker.height) / 2 : parseFloat(marker.top);
    return row.y + center - text.y - parseFloat(getComputedStyle(li.firstElementChild).lineHeight) / 2;
  }));
  assert(exportOffsets.length > 0 && exportOffsets.every(offset => Math.abs(offset) < .5), `export outlined marker missed its line: ${exportOffsets}`);
  await exportPage.close();
  assert.deepEqual(errors, []);
  console.log('Numbering surfaces: editor/export row geometry, actual list conversion, menu input/cancel/commit/undo, selected state and nine style samples passed.');
} finally {
  await browser.close();
}
