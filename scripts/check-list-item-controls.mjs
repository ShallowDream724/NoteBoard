/* global window, document, requestAnimationFrame */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { preview } from 'vite';
import { installBrowserNativeShell } from './browser-native-shell.mjs';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const baseline = process.argv.includes('--baseline');
const cdpUrl = process.env.NOTEBOARD_TEST_CDP;
const out = `.tmp/list-item-controls/${cdpUrl ? 'native' : baseline ? 'before' : 'after'}`;
await fs.mkdir(out, { recursive: true });
const server = cdpUrl ? null : await preview({ configFile: false, build: { outDir: 'dist' }, preview: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
const browser = cdpUrl ? await chromium.connectOverCDP(cdpUrl) : await chromium.launch({ channel: 'msedge', headless: true });
const context = cdpUrl ? browser.contexts()[0] : await browser.newContext({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 1 });
const page = cdpUrl ? context.pages().find(page => !page.url().startsWith('devtools:')) : await context.newPage();
const report = { native: Boolean(cdpUrl), baseline, errors: [], cases: [] };
page.on('pageerror', error => report.errors.push(String(error)));
const selector = '.nb-prose.ProseMirror[contenteditable="true"]';
const prose = page.locator(selector).last();
const frames = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const editor = callback => prose.evaluate((element, source) => (new Function('editor', `return (${source})(editor)`))(element.editor), callback.toString());
const snapshot = () => editor(editor => ({ doc: editor.getJSON(), selection: editor.state.selection.toJSON(), node: editor.state.selection.node?.type.name }));
const closeMenus = async () => { await page.keyboard.press('Escape'); await page.mouse.move(2, 2); await frames(); };
const load = async markdown => {
  await closeMenus();
  await prose.evaluate((element, markdown) => element.editor.commands.setContent(markdown, { contentType: 'markdown' }), markdown);
  await frames();
};

try {
if (!cdpUrl) {
  await installBrowserNativeShell(page);
  await page.addInitScript(() => {
    const original = window.__TAURI_INTERNALS__.invoke;
    window.__TAURI_INTERNALS__.invoke = async (command, args) => {
      if (command === 'plugin:dialog|open') return 'C:/qa/lists';
      if (command === 'read_native_headers') return [];
      if (command === 'read_dir') return [{ name: 'lists.md', path: 'C:/qa/lists/lists.md', kind: 'markdown', isDir: false, size: 80, mtime: 1, isHidden: false, isSymlink: false }];
      if (command === 'register_document') return { type: 'ok' };
      if (command === 'prepare_document') return { type: 'text', payload: { key: args.path, displayName: 'lists.md', dirPath: 'C:/qa/lists', kind: 'markdown', language: 'markdown', content: '# 列表操作\n\n1. 我是1\n2. 2\n3. 我是3\n', encoding: 'utf8', eol: 'lf', size: 80, mtime: 1, readonly: false } };
      return original(command, args);
    };
  });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
  await page.getByRole('button', { name: '新建或打开', exact: true }).click();
  await page.getByRole('menuitem', { name: /打开文件夹/ }).click();
  await page.locator('[data-explorer-row]').filter({ hasText: 'lists.md' }).first().click();
}
await prose.waitFor();
await frames();
if (cdpUrl) await load('# 列表操作\n\n1. 我是1\n2. 2\n3. 我是3\n');

// Walk across text → generated marker/list padding → control. A direct jump
// from text to the button misses the regression in a real mouse trajectory.
async function approach(item) {
  await closeMenus(); await item.scrollIntoViewIfNeeded();
  const geometry = await item.evaluate(element => {
    const p = element.querySelector('p'), rect = p.getBoundingClientRect();
    const list = element.parentElement.getBoundingClientRect();
    return { textX: rect.left + 30, y: rect.top + Math.min(12, rect.height / 2), markerX: list.left + 1,
      pos: element.closest('.ProseMirror').editor.view.posAtDOM(element, 0) - 1, itemHeight: element.getBoundingClientRect().height };
  });
  await page.mouse.move(geometry.textX, geometry.y); await frames();
  await page.mouse.move(geometry.markerX, geometry.y, { steps: 5 }); await frames();
  const handle = page.locator('.nb-block-drag-handle').last();
  await handle.waitFor();
  return { handle, geometry, label: await handle.getAttribute('aria-label') };
}

  const before = await approach(prose.locator('ol > li').first());
  await before.handle.hover(); await page.getByRole('menu', { name: '内容块操作', exact: true }).waitFor(); await frames();
  const selected = await snapshot();
  report.reproduction = { ...before.geometry, label: before.label, selectedNode: selected.node,
    feedbackHeight: await page.locator('.nb-block-range-feedback').evaluate(element => element.getBoundingClientRect().height) };
  await page.screenshot({ path: `${out}/ordered-selection.png` });
  if (baseline) { report.passed = true; } else {
    assert.equal(selected.node, 'listItem');
    assert(report.reproduction.feedbackHeight <= before.geometry.itemHeight + 5, 'Feedback encloses one item');
    assert((await page.locator('.nb-block-range-feedback').boundingBox()).x <= before.geometry.markerX, 'Feedback includes the ordered marker gutter');
    for (const [name, markdown, node] of [
      ['ordered', '# List\n\n7. one\n8. two\n9. three\n\nafter', 'listItem'],
      ['bullet', '# List\n\n- one\n- two\n- three\n\nafter', 'listItem'],
      ['task', '# List\n\n- [x] one\n- [ ] two\n- [x] three\n\nafter', 'taskItem'],
      ['nested', '# List\n\n- parent\n  - one\n  - two\n  - three\n- sibling\n\nafter', 'listItem'],
    ]) {
      await load(markdown);
      const list = name === 'nested' ? prose.locator('ul ul').first() : prose.locator('ol,ul').first();
      const items = list.locator(':scope > li');
      const from = await approach(items.first());
      assert.equal(from.label, node === 'taskItem' ? '拖动待办项' : '拖动列表项');
      await from.handle.hover(); await page.getByRole('menu', { name: '内容块操作', exact: true }).waitFor(); await frames();
      const rowBox = await items.first().boundingBox(), listBox = await list.boundingBox(), feedback = await page.locator('.nb-block-range-feedback').boundingBox();
      assert(feedback.x <= listBox.x + 1 && feedback.x + feedback.width >= rowBox.x + rowBox.width - 1, 'Feedback covers the complete row and its own marker gutter');
      assert(feedback.height <= rowBox.height + 5, 'Feedback does not include sibling rows');
      const box = await from.handle.boundingBox(), last = await items.last().boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
      await page.mouse.move(last.x + 40, last.y + last.height - 1, { steps: 12 }); await frames();
      assert(await page.locator('.nb-block-drop-indicator').count(), 'A valid item boundary is shown');
      await page.mouse.up(); await frames();
      const order = await items.locator(':scope > p, :scope > div > p').allTextContents();
      assert.deepEqual(order, ['two', 'three', 'one']);
      assert.equal(await editor(editor => {
        const selection = editor.state.selection;
        if (selection.node) return selection.node.textContent;
        for (let depth = selection.$from.depth; depth > 0; depth--) {
          if (['listItem', 'taskItem'].includes(selection.$from.node(depth).type.name)) return selection.$from.node(depth).textContent;
        }
      }), 'one');
      if (name === 'ordered') assert.equal(await list.getAttribute('start'), '7');
      if (name === 'task') assert.deepEqual(await items.evaluateAll(elements => elements.map(element => element.dataset.checked)), ['false', 'true', 'true']);
      const moved = (await snapshot()).doc;
      assert.equal(await editor(editor => editor.commands.undo()), true); await frames();
      assert.deepEqual(await items.locator(':scope > p, :scope > div > p').allTextContents(), ['one', 'two', 'three']);
      assert.equal(await editor(editor => editor.commands.redo()), true); await frames();
      assert.deepEqual((await snapshot()).doc, moved);
      report.cases.push({ name, order, undoRedo: true });
      await page.screenshot({ path: `${out}/${name}-reordered.png` });
    }
    for (const [name, markdown, selector, marker, style] of [
      ['wide-number', '# List\n\n123456. one\n123457. two', 'ol > li', '123456. ', 'decimal'],
      ['widest-number', '# List\n\n123456789. one\n123456790. two', 'ol > li', '123456789. ', 'decimal'],
      ['wide-roman', '# List\n\n1. parent\n  1. middle\n    1888. one\n    1889. two', 'ol ol ol > li', 'mdccclxxxviii. ', 'lower-roman'],
    ]) {
      await load(markdown);
      const item = prose.locator(selector).first(), from = await approach(item);
      await from.handle.hover(); await page.getByRole('menu', { name: '内容块操作', exact: true }).waitFor(); await frames();
      const glyphs = await item.evaluate((item, marker) => {
        const style = item.ownerDocument.defaultView.getComputedStyle(item), probe = document.createElement('span');
        Object.assign(probe.style, { position: 'fixed', visibility: 'hidden', whiteSpace: 'pre', font: style.font, letterSpacing: style.letterSpacing, wordSpacing: style.wordSpacing });
        probe.textContent = marker; document.body.append(probe);
        const width = probe.getBoundingClientRect().width; probe.remove();
        const rect = item.getBoundingClientRect(); return { left: rect.left - width, right: rect.right, type: style.listStyleType, height: rect.height };
      }, marker);
      const feedback = await page.locator('.nb-block-range-feedback').boundingBox(), handle = await from.handle.boundingBox();
      assert.equal(glyphs.type, style); assert(feedback.x <= glyphs.left + 1 && feedback.x + feedback.width >= glyphs.right - 1, 'Feedback contains the complete wide marker');
      assert(feedback.height <= glyphs.height + 5);
      assert(handle.x + handle.width <= feedback.x - 3 || handle.x >= feedback.x + feedback.width + 3, 'Handle remains clear of the marker and range');
      report.cases.push({ name, completeMarkerCovered: true, handleClearOfMarker: true });
      await page.screenshot({ path: `${out}/${name}.png` });
    }
    await load('- one\n- two\n- three\n- \n\nafter');
    await editor(editor => {
      let pos = 0;
      editor.state.doc.descendants((node, at) => { if (node.type.name === 'listItem') pos = at + 2; });
      editor.commands.setTextSelection(pos);
    });
    await page.getByRole('button', { name: '有序列表', exact: true }).first().click(); await frames();
    assert.deepEqual(await editor(editor => editor.state.doc.content.content.slice(0, 2).map(node => [node.type.name, node.textContent])), [['bulletList', 'onetwothree'], ['orderedList', '']]);
    report.cases.push({ name: 'toolbar-list-switch', previousItemsRetained: true });
    await load('- one\n- [**two**](https://example.com/two)\n- three\n\nafter');
    await editor(editor => {
      editor.state.doc.descendants((node, at) => { if (node.type.name === 'paragraph' && node.textContent === 'two') editor.commands.setTextSelection({ from: at + 1, to: at + 4 }); });
    });
    const selection = (await snapshot()).selection;
    const expand = page.locator('[data-toolbar-id="text-reset"]:not([data-hidden="true"])').getByRole('button', { name: '清除与还原选项', exact: true });
    await expand.hover();
    const reset = page.getByRole('menu', { name: '清除与还原', exact: true });
    await reset.waitFor(); assert.deepEqual((await snapshot()).selection, selection);
    await page.screenshot({ path: `${out}/text-reset-menu.png` });
    await reset.getByRole('menuitem', { name: '清除文字样式', exact: true }).click(); await frames();
    assert.deepEqual(await editor(editor => editor.state.doc.firstChild.child(1).firstChild.firstChild.marks.map(mark => mark.type.name)), ['link']);
    assert.equal(await prose.locator('ul > li').count(), 3);
    await expand.hover(); await reset.waitFor(); await reset.getByRole('menuitem', { name: /还原为正文/ }).click(); await frames();
    assert.deepEqual(await editor(editor => editor.state.doc.content.content.slice(0, 3).map(node => [node.type.name, node.textContent])), [['bulletList', 'one'], ['paragraph', 'two'], ['bulletList', 'three']]);
    assert.deepEqual(await editor(editor => editor.state.doc.child(1).firstChild.marks.map(mark => mark.type.name)), ['link']);
    await page.screenshot({ path: `${out}/restored-current-item.png` });
    await expand.focus(); await expand.press('ArrowDown'); await reset.waitFor();
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('role')), 'menuitem');
    await page.keyboard.press('Escape'); await reset.waitFor({ state: 'hidden' });
    report.cases.push({ name: 'clear-and-restore', hoverPreservesSelection: true, linkRetained: true, keyboard: true });
    if (!cdpUrl) {
      await load('- one\n- two\n- three');
      await editor(editor => editor.state.doc.descendants((node, at) => { if (node.type.name === 'paragraph' && node.textContent === 'two') editor.commands.setTextSelection(at + 1); }));
      await page.setViewportSize({ width: 600, height: 950 });
      await page.locator('[data-toolbar-id="text-reset"][data-hidden="true"]').waitFor({ state: 'attached' });
      await page.getByRole('button', { name: /^插入超链接/ }).first().click();
      await page.getByRole('menuitem', { name: '清除文字样式', exact: true }).waitFor();
      await page.getByRole('menuitem', { name: '还原为正文', exact: true }).click(); await frames();
      assert.deepEqual(await editor(editor => editor.state.doc.content.content.slice(0, 3).map(node => [node.type.name, node.textContent])), [['bulletList', 'one'], ['paragraph', 'two'], ['bulletList', 'three']]);
      report.cases.push({ name: 'narrow-toolbar', resetActionsAccessible: true, currentItemRestored: true });
    }
    assert.equal(report.errors.length, 0);
    report.passed = true;
  }
} finally {
  if (!report.passed) await page.screenshot({ path: `${out}/failure.png` }).catch(() => {});
  await fs.writeFile(`${out}/results.json`, JSON.stringify(report, null, 2));
  await browser.close(); await server?.httpServer.close();
}
console.log(JSON.stringify({ passed: report.passed, out }));
