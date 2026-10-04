/* global window, document, requestAnimationFrame, DataTransfer, ClipboardEvent */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { build, preview } from 'vite';
import react from '@vitejs/plugin-react';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const directory = '.tmp/visual-workflow', outDir = `${directory}/dist`;
await fs.mkdir(directory, { recursive: true });
if (!process.argv.includes('--reuse')) await build({ configFile: false, plugins: [react()], worker: { format: 'es' }, build: { outDir, emptyOutDir: true, rollupOptions: { input: 'test/browser/visualWorkflow.html' } }, logLevel: 'error' });
const server = await preview({ configFile: false, build: { outDir }, preview: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const result = { checks: [], errors: [] };
page.on('pageerror', error => result.errors.push(error.stack || error.message));
await page.route('**/*', route => /^https?:\/\/127\.0\.0\.1(:|\/)/.test(route.request().url()) ? route.continue() : route.abort());
const base = `http://127.0.0.1:${server.httpServer.address().port}/test/browser/visualWorkflow.html`;
const frames = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const state = () => page.evaluate(() => window.visualWorkflowQA.state());
const load = async content => { await page.evaluate(content => window.visualWorkflowQA.load(content), content); await frames(); };
const open = async query => { await page.goto(base + query); await page.waitForFunction(() => window.visualWorkflowQA?.ready()); await frames(); };
const text = value => ({ type: 'paragraph', content: [{ type: 'text', text: value }] });
const image = { type: 'image', attrs: { src: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80"><rect width="200" height="80" fill="%23e2e8f0"/></svg>', caption: '图注需要加粗' } };
try {
  if (!process.argv.includes('--clipboard-only')) {
  await open('?source');
  assert.equal(await page.evaluate(() => window.visualWorkflowQA.mode()), 'visual', 'Native documents ignore a restored source preference');
  assert.equal(await page.getByRole('button', { name: /切换.*源码/ }).count(), 0);
  await page.keyboard.press('Control+/');
  await page.evaluate(() => window.visualWorkflowQA.requestSource());
  assert.equal(await page.locator('.cm-editor').count(), 0, 'Ordinary NB actions must not allocate a raw source editor');
  const broken = '#!noteboard 1\n@block {broken record}\n@block {"type":"paragraph","content":[{"type":"text","text":"后文保留"}]}';
  await page.evaluate(content => window.visualWorkflowQA.loadRaw(content), broken);
  await page.getByRole('button', { name: '修复原始记录', exact: true }).click();
  await page.locator('.cm-editor:visible').waitFor();
  assert(await page.locator('.cm-content').innerText().then(value => value.includes('{broken record}')));
  await page.getByRole('button', { name: '返回文档', exact: true }).click();
  await page.getByText('后文保留', { exact: true }).waitFor();
  assert((await page.evaluate(() => window.visualWorkflowQA.serialized())).includes('{broken record}'));
  result.checks.push('NB visual entry, explicit record repair, intact malformed record and later content');

  for (const theme of ['chen-guang', 'hu-po', 'mo-ye']) {
    await open(`?theme=${theme}`);
    await load([text('正文不要被改'), image, text('后面的正文')]);
    await page.getByText('正文不要被改', { exact: true }).click();
    await page.keyboard.press('Home'); await page.keyboard.press('Shift+End');
    await page.getByRole('button', { name: '编辑图注', exact: true }).click();
    const caption = page.locator('.nb-caption-editor'); await caption.waitFor();
    await caption.click(); await page.keyboard.press('Home'); await page.keyboard.press('Shift+End');
    await page.getByRole('button', { name: '加粗', exact: true }).first().click();
    let json = await state();
    assert(!json.content[0].content[0].marks?.length, 'The parent stale selection must stay unchanged');
    assert(json.content[1].attrs.captionContent.some(node => node.marks?.some(mark => mark.type === 'bold')), 'Top bold formats the caption');
    await page.getByRole('button', { name: '撤销', exact: true }).first().click();
    json = await state();
    assert(!json.content[1].attrs.captionContent?.some(node => node.marks?.some(mark => mark.type === 'bold')));
    await page.getByRole('button', { name: '重做', exact: true }).first().click();
    assert((await state()).content[1].attrs.captionContent.some(node => node.marks?.some(mark => mark.type === 'bold')));
    await page.screenshot({ path: `${directory}/caption-${theme}.png` });
    await page.getByText('后面的正文', { exact: true }).click();
    const beforeReopen = await state();
    const saved = await page.evaluate(() => window.visualWorkflowQA.serialized());
    await page.evaluate(content => window.visualWorkflowQA.loadRaw(content), saved);
    assert.deepEqual(await state(), beforeReopen, 'Caption formatting survives native serialize/reopen');
    result.checks.push(`${theme}: real caption toolbar, undo/redo, native reopen`);

    await load([text('这段正文可以添加说明'), text('正文保持原样')]);
    await page.getByText('这段正文可以添加说明', { exact: true }).click();
    await page.keyboard.press('Home'); await page.keyboard.press('Shift+End');
    await page.getByRole('button', { name: '添加说明', exact: true }).click();
    const panel = page.getByRole('dialog', { name: '补充说明', exact: true }); await panel.waitFor();
    const draft = panel.locator('.nb-annotation-richtext[contenteditable="true"]');
    await draft.click(); await page.keyboard.insertText('中文说明保留选区');
    await page.keyboard.press('Home'); await page.keyboard.press('Shift+End');
    await panel.getByRole('button', { name: '下划线', exact: true }).click();
    assert.equal(await draft.locator('u').innerText(), '中文说明保留选区');
    await panel.getByRole('button', { name: '链接', exact: true }).click();
    await panel.getByRole('textbox', { name: '说明链接地址' }).fill('https://example.com/note');
    await panel.getByRole('button', { name: '应用', exact: true }).click();
    assert.equal(await draft.locator('a').getAttribute('href'), 'https://example.com/note');
    await panel.getByRole('button', { name: '文字颜色与高亮', exact: true }).click();
    const colorPanel = panel.getByRole('dialog', { name: '说明文字颜色与高亮' }); await colorPanel.waitFor();
    assert(await panel.evaluate(element => element.scrollWidth <= element.clientWidth + 1), 'Narrow annotation controls stay within the panel');
    await page.screenshot({ path: `${directory}/annotation-${theme}.png` });
    await panel.getByRole('button', { name: '保存', exact: true }).click();
    json = await state();
    const body = json.content.find(node => node.type === 'annotationStore')?.content[0];
    assert(body.content[0].content.some(node => node.text === '中文说明保留选区' && node.marks?.some(mark => mark.type === 'underline') && node.marks?.some(mark => mark.type === 'link')));
    assert(json.content.some(node => node.type === 'paragraph' && node.content?.[0]?.text === '正文保持原样' && !node.content[0].marks?.length));
    const snapshot = await page.evaluate(() => window.visualWorkflowQA.serialized());
    await panel.getByRole('button', { name: '关闭说明', exact: true }).click();
    await page.evaluate(content => window.visualWorkflowQA.loadRaw(content), snapshot);
    assert.deepEqual(await state(), json, 'Annotation body and anchor survive reopen');
    result.checks.push(`${theme}: real annotation creation, formatting, link, narrow controls, save/reopen`);
  }
  await open('?kind=markdown');
  await page.getByRole('button', { name: '切换为源码模式', exact: true }).click();
  await page.locator('.cm-editor:visible').waitFor();
  await page.getByRole('button', { name: '切换为可视化模式', exact: true }).click();
  assert.equal(await page.evaluate(() => window.visualWorkflowQA.mode()), 'visual');
  result.checks.push('Markdown retains source/visual switching');
  }
  await open('');
  await load([text('输入法不能改动正文'), image]);
  await page.getByRole('button', { name: '编辑图注', exact: true }).click();
  const imeCaption = page.locator('.nb-caption-editor'); await imeCaption.click(); await frames();
  await page.keyboard.press('Home'); await page.keyboard.press('Shift+End'); await frames();
  const ime = await page.context().newCDPSession(page);
  await ime.send('Input.imeSetComposition', { text: '中文输入', selectionStart: 4, selectionEnd: 4 });
  await ime.send('Input.imeSetComposition', { text: '中文输入完成', selectionStart: 6, selectionEnd: 6 });
  await ime.send('Input.insertText', { text: '中文输入完成' }); await frames();
  assert.equal((await state()).content[1].attrs.caption, '中文输入完成');
  assert.equal((await state()).content[0].content[0].text, '输入法不能改动正文');
  await page.getByRole('button', { name: '撤销', exact: true }).first().click(); await frames();
  assert.equal((await state()).content[1].attrs.caption, '图注需要加粗', 'Caption IME commits as one undoable edit');
  await ime.detach();
  result.checks.push('Chromium IME composition in caption commits once and leaves parent text intact');
  await open('');
  const cell = value => ({ type: 'tableCell', content: [text(value)] });
  await load([
    { type: 'paragraph', content: [{ type: 'text', text: '中文混合选区', marks: [{ type: 'bold' }, { type: 'annotationReference', attrs: { id: 'mixed-note' } }] }, { type: 'mathInline', attrs: { latex: 'a^2+b^2=c^2' } }] },
    { type: 'githubAlert', attrs: { kind: 'tip' }, content: [text('提示块保留正文')] },
    { type: 'table', content: [{ type: 'tableRow', content: [cell('项目'), cell('记录')] }, { type: 'tableRow', content: [cell('温度'), cell('23')] }] },
    { ...image, attrs: { ...image.attrs, caption: '样本图注', captionContent: [{ type: 'text', text: '样本图注', marks: [{ type: 'underline' }] }] } },
    { type: 'disclosure', attrs: { title: '附录标题', open: false }, content: [text('折叠正文也要保留')] },
    { type: 'codeBlock', attrs: { language: 'python' }, content: [{ type: 'text', text: 'print("中文")' }] },
    text('选区末尾'),
    { type: 'annotationStore', content: [{ type: 'annotationBody', attrs: { id: 'mixed-note' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '说明也有格式', marks: [{ type: 'underline' }, { type: 'link', attrs: { href: 'https://example.com/note' } }] }] }] }] },
  ]);
  await page.getByText('选区末尾', { exact: true }).click();
  await frames(); await page.keyboard.press('Control+Home'); await frames();
  const homeSelection = await page.evaluate(() => window.visualWorkflowQA.editor().state.selection.toJSON());
  await page.keyboard.press('Control+Shift+End'); await frames();
  const copied = await page.locator('.ProseMirror[contenteditable="true"]').first().evaluate(element => {
    const data = new DataTransfer();
    element.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: data }));
    return Object.fromEntries([...data.types].map(type => [type, data.getData(type)]));
  });
  result.clipboard = { types: Object.keys(copied), homeSelection, ...await page.evaluate(() => ({ selection: window.visualWorkflowQA.editor().state.selection.toJSON(), documentSize: window.visualWorkflowQA.editor().state.doc.content.size, active: document.activeElement?.className })) };
  assert(Object.keys(copied).some(type => type.includes('noteboard')), 'The actual copy handler must include a structured native fragment');
  await load([{ type: 'paragraph' }]);
  await page.locator('.ProseMirror[contenteditable="true"]').first().focus();
  await page.locator('.ProseMirror[contenteditable="true"]').first().evaluate((element, copied) => {
    const data = new DataTransfer(); for (const [type, value] of Object.entries(copied)) data.setData(type, value);
    element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
  }, copied);
  await page.waitForFunction(() => window.visualWorkflowQA.state().content.some(node => node.type === 'table'));
  const mixed = await state(), mixedText = JSON.stringify(mixed);
  for (const value of ['中文混合选区', '提示块保留正文', '项目', '样本图注', '附录标题', '折叠正文也要保留', '说明也有格式', 'python', 'a^2+b^2=c^2']) assert(mixedText.includes(value), `${value} survives the cross-block clipboard pipeline`);
  const mixedSource = await page.evaluate(() => window.visualWorkflowQA.serialized());
  await fs.writeFile(`${directory}/mixed.nb`, mixedSource);
  await page.evaluate(content => window.visualWorkflowQA.loadRaw(content), mixedSource);
  assert.deepEqual(await state(), mixed, 'The pasted rich selection survives native reopen');
  const html = await page.evaluate(() => window.visualWorkflowQA.exportHtml());
  await fs.writeFile(`${directory}/mixed.html`, html);
  const pdfPayload = await page.evaluate(() => window.visualWorkflowQA.exportPdfPayload());
  await fs.writeFile(`${directory}/mixed-pdf-payload.json`, JSON.stringify(pdfPayload));
  const exported = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  try {
    await exported.setContent(html);
    assert.equal(await exported.locator('table').count(), 1);
    assert(await exported.locator('figcaption u').innerText().then(value => value.includes('样本图注')));
    assert(await exported.locator('[data-annotation-body] u').innerText().then(value => value.includes('说明也有格式')));
    assert.equal(await exported.locator('details summary').innerText(), '附录标题');
    assert(await exported.locator('.export-code-language').innerText().then(value => /python/i.test(value)), 'Exported code retains a visible language header');
    await exported.screenshot({ path: `${directory}/mixed-export.png`, fullPage: true });
  } finally { await exported.close(); }
  result.checks.push('Keyboard cross-block selection; DOM copy/paste; native reopen; standalone HTML with caption, notes, table, math and code language');
  assert.deepEqual(result.errors, []);
  console.log(JSON.stringify(result));
} catch (error) {
  await page.screenshot({ path: `${directory}/failure.png` });
  console.error('Runtime errors:', result.errors);
  throw error;
} finally {
  await fs.writeFile(`${directory}/results.json`, JSON.stringify(result, null, 2));
  await browser.close(); await server.close();
}
