/* global window, document, requestAnimationFrame */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { preview } from 'vite';
import { installBrowserNativeShell } from './browser-native-shell.mjs';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const cdp = process.env.NOTEBOARD_TEST_CDP;
const out = `.tmp/interaction-followup/${cdp ? 'native' : 'browser'}`;
await fs.mkdir(out, { recursive: true });
const server = cdp ? null : await preview({ configFile: false, build: { outDir: 'dist' }, preview: { host: '127.0.0.1', port: 15170 }, logLevel: 'error' });
const browser = cdp ? await chromium.connectOverCDP(cdp) : await chromium.launch({ channel: 'msedge', headless: true });
const context = cdp ? browser.contexts()[0] : await browser.newContext({ viewport: { width: 1440, height: 950 } });
const page = cdp ? context.pages().find(page => !page.url().startsWith('devtools:')) : await context.newPage();
// The isolated native process starts hidden. Give protocol input the same
// focused document state as a user's click, without raising a desktop window.
const nativeInput = cdp ? await context.newCDPSession(page) : null;
if (nativeInput) await nativeInput.send('Emulation.setFocusEmulationEnabled', { enabled: true });
const report = { native: !!cdp, cases: [], errors: [] };
page.on('pageerror', error => report.errors.push(String(error)));
const prose = page.locator('.nb-prose.ProseMirror[contenteditable="true"]:visible').last();
const frames = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const editor = callback => prose.evaluate((element, source) => (new Function('editor', `return (${source})(editor)`))(element.editor), callback.toString());
const state = () => editor(editor => editor.getJSON());
const closeMenus = async () => { await page.keyboard.press('Escape'); await page.mouse.move(2, 2); await frames(); };
const load = async markdown => { await closeMenus(); await prose.evaluate((element, value) => element.editor.commands.setContent(value, { contentType: 'markdown' }), markdown); await frames(); };
async function approach(element) {
  await closeMenus(); await element.scrollIntoViewIfNeeded();
  const box = await element.boundingBox();
  await page.mouse.move(box.x + 35, box.y + Math.min(12, box.height / 2)); await frames();
  const handle = page.locator('.nb-block-drag-handle'); await handle.waitFor();
  const target = await element.elementHandle();
  try { const ready = await page.waitForFunction(target => {
    const handle = document.querySelector('.nb-block-drag-handle');
    if (!handle || !target?.isConnected) return false;
    const box = target.getBoundingClientRect(), control = handle.getBoundingClientRect();
    return Math.abs(control.y + control.height / 2 - (box.y + Math.min(15, box.height / 2))) < 22;
  }, target); await ready.dispose(); } finally { await target?.dispose(); }
  return handle;
}
async function select(text) {
  await prose.evaluate((element, text) => {
    const editor = element.editor;
    editor.state.doc.descendants((node, pos) => { if (node.isTextblock && node.textContent === text) editor.commands.setTextSelection(pos + 1); });
    editor.view.dom.focus({ preventScroll: true });
  }, text); await frames();
}
const blocks = async () => (await state()).content.filter(node => !['documentPresentation', 'annotationStore'].includes(node.type) && (node.type !== 'paragraph' || node.content?.length));
const textOf = node => (node.text || '') + (node.content || []).map(textOf).join('');
try {
  if (!cdp) {
    await installBrowserNativeShell(page);
    await page.addInitScript(() => {
      const invoke = window.__TAURI_INTERNALS__.invoke, root = 'C:/qa/workspace';
      const node = (path, isDir = false) => ({ name: path.split('/').pop(), path, kind: isDir ? 'unknown' : path.endsWith('.nb') ? 'noteboard' : 'markdown', isDir, size: 80, mtime: 1, isHidden: false, isSymlink: false });
      const tree = {
        [root]: [node(`${root}/nested`, true)],
        [`${root}/nested`]: [node(`${root}/nested/interaction.nb`)],
        'C:/qa/outside': [node('C:/qa/outside/outside.md'), node('C:/qa/outside/deep', true)],
        'C:/qa/outside/deep': [node('C:/qa/outside/deep/child.md')],
      };
      window.__qaNextPath = root; window.__qaDirectoryReads = [];
      window.__TAURI_INTERNALS__.invoke = async (command, args) => {
        if (command === 'plugin:dialog|open') return window.__qaNextPath;
        if (command === 'read_native_headers') return [];
        if (command === 'path_exists') return { exists: true, isDir: Object.hasOwn(tree, args.path.replaceAll('\\', '/')) };
        if (command === 'read_dir') { const path = args.path.replaceAll('\\', '/'); window.__qaDirectoryReads.push(path); return tree[path] || []; }
        if (command === 'register_document') return { type: 'ok' };
        if (command === 'prepare_document') {
          const path = args.path.replaceAll('\\', '/'), native = path.endsWith('.nb');
          const content = native ? '#!noteboard 1\n@block {"type":"paragraph","content":[{"type":"text","text":"ready"}]}\n' : `# ${path.split('/').pop()}\n\nOutside document`;
          return { type: 'text', payload: { key: args.path, displayName: path.split('/').pop(), dirPath: path.slice(0, path.lastIndexOf('/')), kind: native ? 'noteboard' : 'markdown', language: 'markdown', content, encoding: 'utf8', eol: 'lf', size: content.length, mtime: 1, readonly: false } };
        }
        return invoke(command, args);
      };
    });
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
    await page.getByRole('button', { name: '新建或打开', exact: true }).click();
    await page.getByRole('menuitem', { name: /打开文件夹/ }).click();
    await page.locator('[data-explorer-row]').filter({ hasText: 'nested' }).first().click();
    await page.locator('[data-explorer-row]').filter({ hasText: 'interaction.nb' }).first().click();
    await prose.waitFor();
    await page.evaluate(() => { window.__qaNextPath = 'C:/qa/outside/outside.md'; });
    await page.keyboard.press('Control+o');
    await page.getByRole('textbox', { name: '文件或文件夹路径', exact: true }).fill('C:/qa/outside/outside.md');
    await page.getByRole('button', { name: '打开', exact: true }).click();
    await page.getByRole('tab', { name: 'outside.md', exact: true }).waitFor(); await frames();
    assert(await page.locator('[data-explorer-row]').filter({ hasText: 'nested' }).count(), 'Outside automatic open retains workspace');
    assert.equal(await page.locator('[data-explorer-row]').filter({ hasText: 'outside.md' }).count(), 0);
    await page.getByRole('tree').locator('button').first().click();
    await page.locator('[data-explorer-row]').filter({ hasText: 'outside.md' }).waitFor();
    await page.locator('[data-explorer-row]').filter({ hasText: 'deep' }).click();
    await page.locator('[data-explorer-row]').filter({ hasText: 'child.md' }).click();
    await page.getByRole('tab', { name: 'child.md', exact: true }).waitFor();
    assert(await page.locator('[data-explorer-row]').filter({ hasText: 'outside.md' }).count(), 'Tree-open child inherits highest displayed root');
    await page.getByRole('tab', { name: 'interaction.nb', exact: true }).click();
    await page.locator('[data-explorer-row]').filter({ hasText: 'interaction.nb' }).waitFor();
    assert(await page.locator('[data-explorer-row]').filter({ hasText: 'nested' }).count(), 'Return restores original workspace');
    const session = await context.newCDPSession(page);
    const memory = async () => { await session.send('HeapProfiler.collectGarbage'); return { ...(await session.send('Runtime.getHeapUsage')), ...(await session.send('Memory.getDOMCounters')) }; };
    const before = await memory();
    for (let index = 0; index < 20; index++) {
      await page.getByRole('tab', { name: 'child.md', exact: true }).click();
      await page.locator('[data-explorer-row]').filter({ hasText: 'outside.md' }).waitFor();
      await page.getByRole('tab', { name: 'interaction.nb', exact: true }).click();
      await page.locator('[data-explorer-row]').filter({ hasText: 'interaction.nb' }).waitFor();
    }
    const after = await memory(); await session.detach();
    assert(after.usedSize - before.usedSize < 5 * 1024 * 1024, 'Repeated root changes have bounded retained heap');
    assert(after.nodes - before.nodes < 100, 'Detached tree rows do not accumulate');
    report.explorer = { cycles: 20, before, after, directoryReads: await page.evaluate(() => window.__qaDirectoryReads.length) };
    report.cases.push('workspace/outside locate/tree-origin isolation; 40 tab switches and retained memory');
    await page.screenshot({ path: `${out}/workspace-restored.png` });
    // End the navigation fixture before direct editor probes: parked inactive
    // views intentionally keep geometry and must not be picked by :visible.
    await page.getByRole('button', { name: '关闭 child.md', exact: true }).click();
    await page.getByRole('button', { name: '关闭 outside.md', exact: true }).click();
    await page.locator('.nb-prose.ProseMirror[contenteditable="true"]').waitFor();
  }
  await prose.waitFor();
  for (const [name, markdown, text] of [['heading', '## heading\n\nafter', 'heading'], ['todo', '- [x] one\n- [ ] two\n- [x] three\n\nafter', 'two']]) {
    await load(markdown); await select(text); await page.keyboard.press('Control+0'); await frames();
    const body = await blocks();
    assert(body.some(node => node.type === 'paragraph' && textOf(node) === text), `${name} Ctrl+0 restores current body`);
    if (name === 'todo') assert.deepEqual(body.slice(0, 3).map(node => node.type), ['taskList', 'paragraph', 'taskList']);
    report.cases.push(`${name}: actual Ctrl+0`);
  }
  await load('1. one\n2. two\n3. three\n4. four\n\ninsert\n\nafter');
  const handle = await approach(prose.locator('p').filter({ hasText: /^insert$/ }));
  const target = await prose.locator('ol > li').nth(2).boundingBox(), source = await handle.boundingBox();
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2); await page.mouse.down();
  await page.mouse.move(target.x + 40, target.y + 1, { steps: 10 }); await frames();
  assert(await prose.evaluate(element => element.classList.contains('nb-editor-dragging')));
  assert.equal(await page.getByRole('toolbar', { name: /文字工具栏|表格工具栏/ }).filter({ visible: true }).count(), 0);
  assert(await page.locator('.nb-block-drop-indicator').count());
  await page.screenshot({ path: `${out}/drag-without-auxiliary-toolbar.png` });
  await page.mouse.up(); await frames();
  const split = await blocks();
  assert.deepEqual(split.slice(0, 3).map(node => [node.type, textOf(node)]), [['orderedList', 'onetwo'], ['paragraph', 'insert'], ['orderedList', 'threefour']]);
  assert.deepEqual([split[0].attrs.start, split[2].attrs.start], [1, 1]);
  await page.keyboard.press('Control+z'); await frames();
  assert.equal((await blocks())[0].content.length, 4);
  await page.keyboard.press('Control+Shift+z'); await frames();
  assert.deepEqual((await blocks()).slice(0, 3), split.slice(0, 3));
  report.cases.push('paragraph between list rows: split/restart/one-step undo/redo');
  for (const [ordered, edge] of [[true, 0], [true, 1], [true, 3], [false, 0], [false, 1], [false, 3]]) {
    await load(`${ordered ? '1. one\n2. two\n3. three' : '- one\n- two\n- three'}\n\ngap\n\n- [x] todo\n\nafter`);
    const originalTaskState = await blocks();
    assert.equal(originalTaskState[0].content.length, 3);
    const taskHandle = await approach(prose.locator('[data-type="taskItem"] p').filter({ hasText: /^todo$/ }));
    const rows = prose.locator(ordered ? 'ol > li' : 'ul:not([data-type="taskList"]) > li');
    const drop = await rows.nth(edge === 3 ? 2 : edge).boundingBox(), grip = await taskHandle.boundingBox();
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2); await page.mouse.down();
    await page.mouse.move(drop.x + 40, edge === 3 ? drop.y + drop.height - 1 : drop.y + 1, { steps: 10 }); await frames();
    assert(await page.locator('.nb-block-drop-indicator').count());
    await page.mouse.up(); await frames();
    const moved = await blocks(), task = moved.find(node => node.type === 'taskList');
    assert.equal(task?.content?.[0]?.attrs?.checked, true, 'Moved todo retains checked state');
    assert.deepEqual(moved.filter(node => node.type !== 'paragraph').map(textOf), edge === 0 ? ['todo', 'onetwothree'] : edge === 1 ? ['one', 'todo', 'twothree'] : ['onetwothree', 'todo']);
    if (ordered) assert.deepEqual(moved.filter(node => node.type === 'orderedList').map(node => node.attrs.start), edge === 1 ? [1, 1] : [1]);
    if (ordered && edge === 1) await page.screenshot({ path: `${out}/todo-between-numbered-rows.png` });
    await page.keyboard.press('Control+z'); await frames();
    assert.deepEqual(await blocks(), originalTaskState);
    await page.keyboard.press('Control+Shift+z'); await frames();
    assert.deepEqual((await blocks()).filter(node => node.type !== 'paragraph'), moved.filter(node => node.type !== 'paragraph'));
  }
  report.cases.push('actual checked-todo drag before/middle/after OL and UL, kind retained, numbered restart, one undo/redo');
  await load('**selection**\n\nafter');
  await editor(editor => { editor.commands.setTextSelection({ from: 1, to: 10 }); editor.view.focus(); });
  const textToolbar = page.getByRole('toolbar', { name: '文字工具栏', exact: true }); await textToolbar.waitFor();
  await textToolbar.getByRole('button', { name: '清除与还原选项', exact: true }).hover();
  const resetMenu = page.getByRole('menu', { name: '清除与还原', exact: true }); await resetMenu.waitFor();
  assert(await resetMenu.getByRole('menuitem', { name: '清除文字样式', exact: true }).count());
  assert(await resetMenu.getByRole('menuitem', { name: /还原为正文/ }).count());
  await resetMenu.getByRole('menuitem', { name: '清除文字样式', exact: true }).click(); await frames();
  assert(!(await blocks())[0].content[0].marks?.length); report.cases.push('selection toolbar exposes both shared reset actions');
  await load('source\n\n| A | B |\n| - | - |\n| x | y |\n\nafter');
  const tableHandle = await approach(prose.locator('p').filter({ hasText: /^source$/ })), tableBox = await tableHandle.boundingBox();
  const cellBox = await prose.locator('td').first().boundingBox();
  await page.mouse.move(tableBox.x + 8, tableBox.y + 10); await page.mouse.down();
  await page.mouse.move(cellBox.x + 12, cellBox.y + 10, { steps: 6 }); await frames();
  assert.equal(await page.getByRole('toolbar', { name: /文字工具栏|表格工具栏/ }).filter({ visible: true }).count(), 0);
  await page.keyboard.press('Escape'); await page.mouse.up(); await frames();
  assert.equal(await prose.evaluate(element => element.classList.contains('nb-editor-dragging')), false);
  report.cases.push('block drag across table keeps both auxiliary toolbars hidden; Escape releases');
  await load('1. one\n2. two\n\ninsert\n\nafter');
  const cancelHandle = await approach(prose.locator('p').filter({ hasText: /^insert$/ })), cancelBox = await cancelHandle.boundingBox();
  await page.mouse.move(cancelBox.x + 8, cancelBox.y + 10); await page.mouse.down();
  await page.mouse.move(cancelBox.x + 60, cancelBox.y - 30, { steps: 5 }); await frames();
  await editor(editor => editor.commands.insertContentAt(1, 'changed ')); await frames();
  assert.equal(await prose.evaluate(element => element.classList.contains('nb-editor-dragging')), false);
  assert.equal(await page.locator('.nb-block-drop-indicator').count(), 0);
  assert.equal(await page.evaluate(() => document.body.style.cursor), '');
  const cancelled = await state(); await page.mouse.up(); await frames(); assert.deepEqual(await state(), cancelled);
  report.cases.push('concurrent document edit cancels drag and releases capture/cursor');
  await load('- [x] one\n- [ ] two\n- [x] three\n\nafter');
  const todoHandle = await approach(prose.locator('li[data-type="taskItem"]').nth(1));
  await todoHandle.hover(); const menu = page.getByRole('menu', { name: '内容块操作', exact: true }); await menu.waitFor();
  assert(await menu.getByRole('menuitem', { name: /清除文字样式/ }).count());
  assert(await menu.getByRole('menuitem', { name: /还原为正文/ }).count());
  await menu.getByRole('menuitem', { name: /添加说明/ }).click();
  const panel = page.getByRole('dialog', { name: '补充说明', exact: true }); await panel.waitFor();
  await panel.locator('.nb-annotation-richtext[contenteditable="true"]').fill('todo explanation');
  await panel.getByRole('button', { name: '保存', exact: true }).click();
  await panel.getByRole('button', { name: '关闭说明', exact: true }).click();
  await select('two'); await page.keyboard.press('Control+0'); await frames();
  const annotated = await state();
  assert(annotated.content.some(node => node.type === 'paragraph' && textOf(node) === 'two' && node.attrs.annotationId));
  assert(annotated.content.some(node => node.type === 'annotationStore' && textOf(node) === 'todo explanation'));
  report.cases.push('todo block-menu explanation survives paragraph restore');
  await load('link subject\n\nafter');
  const linkHandle = await approach(prose.locator('p').filter({ hasText: /^link subject$/ }));
  await linkHandle.hover(); await menu.waitFor();
  await menu.getByRole('button', { name: '超链接', exact: true }).click();
  await page.getByText('插入超链接', { exact: true }).waitFor();
  assert.equal(await page.getByPlaceholder('输入链接要显示的文本（留空则默认使用链接地址）').inputValue(), 'link subject');
  await page.keyboard.press('Escape'); report.cases.push('block link opens actual document dialog with selected text');
  await closeMenus();
  await editor(editor => {
    const paragraph = { type: 'heading', attrs: { level: 2, textAlign: 'center', blockBackground: '#ffeecc', blockTextColor: '#aa0000', indent: 2 }, content: [{ type: 'text', text: 'Styled body', marks: [{ type: 'bold' }, { type: 'link', attrs: { href: 'https://example.com' } }] }] };
    editor.commands.setContent({ type: 'doc', content: [{ type: 'githubAlert', attrs: { kind: 'tip', title: 'Retained title', textColor: '#123456', backgroundColor: '#ffeecc', borderColor: '#abcdef', icon: 'bookmark' }, content: [paragraph, { type: 'image', attrs: { src: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="240" height="80"%3E%3Crect width="240" height="80" fill="%23c4d7ed"/%3E%3C/svg%3E', width: '50%', align: 'right', caption: 'caption', captionContent: [{ type: 'text', text: 'caption', marks: [{ type: 'bold' }, { type: 'link', attrs: { href: 'https://example.com' } }] }] } }] }, { type: 'paragraph', content: [{ type: 'text', text: 'after' }] }] });
    editor.commands.setNodeSelection(0); editor.view.focus();
  }); await frames();
  const styled = await state();
  await page.keyboard.press('Control+Backslash'); await frames();
  const clearBody = (await blocks())[0];
  assert.equal(clearBody.type, 'githubAlert'); assert.equal(clearBody.attrs.kind, 'tip'); assert.equal(clearBody.attrs.title, 'Retained title');
  for (const field of ['textColor', 'backgroundColor', 'borderColor', 'icon']) assert.equal(clearBody.attrs[field], null);
  assert.equal(clearBody.content[0].attrs.textAlign, null); assert.equal(clearBody.content[0].attrs.blockBackground, null); assert.equal(clearBody.content[0].attrs.indent, 0);
  assert.deepEqual(clearBody.content[0].content[0].marks.map(mark => mark.type), ['link']);
  assert.deepEqual(clearBody.content[1].attrs.captionContent[0].marks.map(mark => mark.type), ['link']);
  assert.equal(clearBody.content[1].attrs.align, 'right'); assert.equal(clearBody.content[1].attrs.width, '50%');
  assert.equal(await editor(editor => editor.state.selection.toJSON().type), 'node');
  await page.keyboard.press('Control+z'); await frames(); assert.deepEqual(await state(), styled);
  await editor(editor => { editor.commands.setNodeSelection(0); editor.view.focus(); });
  await page.keyboard.press('Control+0'); await frames();
  const restored = await blocks();
  assert.equal(restored[0].type, 'paragraph'); assert.equal(textOf(restored[0]), 'Retained title');
  assert.equal(restored[1].attrs.textAlign, 'center'); assert.equal(restored[1].attrs.blockBackground, '#ffeecc');
  assert.equal(restored[2].attrs.align, 'right'); assert.equal(restored[2].attrs.width, '50%');
  report.cases.push('whole Note Ctrl+Backslash resets frame/body/caption styles, keeps layout/selection; undo and Ctrl+0 retain title/styles');
  await load('## menu heading\n\nafter');
  const resetHandle = await approach(prose.locator('h2').filter({ hasText: /^menu heading$/ }));
  await resetHandle.hover(); await menu.waitFor();
  assert.equal(await menu.getByRole('menuitem', { name: '还原为正文', exact: true }).count(), 1);
  assert.equal(await menu.getByRole('button', { name: '正文', exact: true }).count(), 0);
  for (let level = 1; level <= 6; level++) assert.equal(await menu.getByRole('button', { name: `标题 ${level}`, exact: true }).count(), 1);
  await page.screenshot({ path: `${out}/reset-menu.png` });
  report.cases.push('single restore entry; six heading levels and both shortcut labels');
  await load('**before after**\n\nend');
  await editor(editor => { editor.commands.setTextSelection({ from: 13, to: 8 }); editor.view.focus(); });
  const reverse = await editor(editor => editor.state.selection.toJSON());
  const wordHandle = await approach(prose.locator('p').filter({ hasText: /^before after$/ }));
  await wordHandle.hover(); await menu.waitFor();
  assert.deepEqual(await editor(editor => editor.state.selection.toJSON()), reverse, 'Hover does not replace a backwards word selection');
  await menu.getByRole('menuitem', { name: '清除文字样式', exact: true }).click(); await frames();
  const partial = (await blocks())[0];
  assert(partial.content[0].marks.some(mark => mark.type === 'bold')); assert(!partial.content.at(-1).marks?.length);
  assert.deepEqual(await editor(editor => editor.state.selection.toJSON()), reverse);
  report.cases.push('block hover preserves backwards word range; clear styles edits selected word only');

  await load('after\n\nend');
  const afterParagraph = prose.locator('p').filter({ hasText: /^after$/ }), wordBox = await afterParagraph.boundingBox();
  const selectingHandle = await approach(afterParagraph), selectingBox = await selectingHandle.boundingBox();
  await page.mouse.move(wordBox.x + 42, wordBox.y + wordBox.height / 2); await page.mouse.down();
  await page.mouse.move(selectingBox.x + selectingBox.width / 2, selectingBox.y + selectingBox.height / 2, { steps: 8 });
  await page.waitForTimeout(400);
  assert.equal(await menu.count(), 0, 'Pressed-pointer text selection cannot open a block menu');
  assert.equal(await editor(editor => editor.state.selection.toJSON().type), 'text');
  assert.equal(await editor(editor => editor.state.selection.empty), false);
  await page.mouse.up(); await frames();
  const dragSelected = await editor(editor => editor.state.selection.toJSON());
  await page.waitForTimeout(350);
  assert.deepEqual(await editor(editor => editor.state.selection.toJSON()), dragSelected, 'Releasing over gutter preserves text selection');
  await page.screenshot({ path: `${out}/word-selection-gutter.png` });
  report.cases.push('actual right-to-left text selection crosses gutter without opening menu or losing range');

  await load('before\n\nafter'); await page.waitForTimeout(550);
  await editor(editor => editor.commands.insertContentAt(editor.state.doc.firstChild.nodeSize, { type: 'paragraph', content: [{ type: 'text', text: 'temporary' }] }));
  const undoHandle = await approach(prose.locator('p').filter({ hasText: /^temporary$/ }));
  await undoHandle.hover(); await menu.waitFor();
  await page.keyboard.press('Control+z'); await frames();
  assert.equal(await prose.locator('p').filter({ hasText: /^temporary$/ }).count(), 0);
  const restoredHandle = await approach(prose.locator('p').filter({ hasText: /^after$/ }));
  await restoredHandle.hover(); await menu.waitFor();
  report.cases.push('undo removes an open-menu target and handle/menu recover on the next paragraph');

  await load('1. one\n2. two\n3. three\n4. four\n\nafter');
  await editor(editor => {
    let first = 0, last = 0;
    editor.state.doc.descendants((node, pos) => { if (node.isTextblock && node.textContent === 'two') first = pos + 1; if (node.isTextblock && node.textContent === 'three') last = pos + node.nodeSize - 1; });
    editor.commands.setTextSelection({ from: last, to: first }); editor.view.focus();
  });
  const batchHandle = await approach(prose.locator('ol > li').nth(1));
  await batchHandle.hover(); const batchMenu = page.getByRole('menu', { name: '2 个内容块操作', exact: true }); await batchMenu.waitFor();
  assert.equal(await menu.count(), 0, 'Multiple rows never expose a single-item menu');
  await page.screenshot({ path: `${out}/batch-selection-menu.png` });
  await page.keyboard.press('Escape');
  const batchBox = await batchHandle.boundingBox(), firstRow = await prose.locator('ol > li').first().boundingBox();
  await page.mouse.move(batchBox.x + batchBox.width / 2, batchBox.y + batchBox.height / 2); await page.mouse.down();
  await page.mouse.move(firstRow.x + 40, firstRow.y + 1, { steps: 8 }); await frames();
  assert(await prose.evaluate(element => element.classList.contains('nb-editor-dragging')));
  await page.mouse.up(); await frames();
  assert.deepEqual((await blocks())[0].content.map(textOf), ['two', 'three', 'one', 'four']);
  await page.keyboard.press('Control+z'); await frames();
  assert.deepEqual((await blocks())[0].content.map(textOf), ['one', 'two', 'three', 'four']);
  await page.keyboard.press('Control+Shift+z'); await frames();
  assert.deepEqual((await blocks())[0].content.map(textOf), ['two', 'three', 'one', 'four']);
  report.cases.push('backwards two-row selection uses batch menu, atomically drags both rows, one undo/redo');

  await load('**selection**\n\nafter');
  await editor(editor => { editor.commands.setTextSelection({ from: 1, to: 10 }); editor.view.focus(); });
  await textToolbar.waitFor();
  await textToolbar.getByRole('button', { name: '设置/修改超链接', exact: true }).hover(); await page.waitForTimeout(800);
  assert.equal(await page.locator('.nb-contextual-help-content').count(), 0);
  assert((await page.getByRole('tooltip').allTextContents()).some(text => text.includes('设置/修改超链接')));
  await textToolbar.getByRole('button', { name: '清除与还原选项', exact: true }).hover(); await resetMenu.waitFor();
  await resetMenu.getByRole('menuitem', { name: '清除文字样式', exact: true }).hover(); await page.waitForTimeout(800);
  assert.equal(await page.locator('.nb-contextual-help-content').count(), 0);
  report.cases.push('floating toolbar and portalled reset submenu keep compact labels/shortcuts without rich preview');
  await page.screenshot({ path: `${out}/final.png` });
  assert.equal(report.errors.length, 0); report.passed = true;
} finally {
  if (!report.passed) await page.screenshot({ path: `${out}/failure.png` }).catch(() => {});
  await fs.writeFile(`${out}/results.json`, JSON.stringify(report, null, 2));
  await nativeInput?.detach(); await browser.close(); await server?.httpServer.close();
}
console.log(JSON.stringify({ passed: report.passed, out }));
