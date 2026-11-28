/* global window, document, Worker, DataTransfer, ClipboardEvent, KeyboardEvent, requestAnimationFrame, performance */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { preview } from 'vite';
import { installBrowserNativeShell } from './browser-native-shell.mjs';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const cdp = process.env.NOTEBOARD_TEST_CDP;
const out = `.tmp/web-paste-controls/${cdp ? 'native' : 'browser'}`;
await fs.mkdir(out, { recursive: true });
const server = cdp ? null : await preview({ configFile: false, build: { outDir: process.env.NOTEBOARD_TEST_DIST || 'dist' }, preview: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
const browser = cdp ? await chromium.connectOverCDP(cdp) : await chromium.launch({ channel: 'msedge', headless: true });
const context = cdp ? browser.contexts()[0] : await browser.newContext({ viewport: { width: 1440, height: 950 } });
const page = cdp ? context.pages().find(page => !page.url().startsWith('devtools:')) : await context.newPage();
const report = { native: Boolean(cdp), errors: [], cases: [] };
page.on('pageerror', error => report.errors.push(String(error)));
const prose = page.locator('.nb-prose.ProseMirror[contenteditable="true"]').last();
const frame = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const snapshot = () => prose.evaluate(element => ({ json: element.editor.getJSON(), text: element.editor.state.doc.textContent,
  marks: (() => { const marks = []; element.editor.state.doc.descendants(node => { if (node.isText) marks.push(...node.marks.map(mark => ({ type: mark.type.name, attrs: mark.attrs }))); }); return marks; })() }));
const load = async (text = '') => { await prose.evaluate((element, text) => { element.editor.commands.setContent(text, { contentType: 'markdown' }); element.editor.commands.setTextSelection(element.editor.state.doc.content.size - 1); element.editor.view.focus(); }, text); await frame(); };
const paste = async (data, plain = false) => {
  const responseMs = await prose.evaluate((element, { data, plain }) => {
    element.editor.view.focus();
    if (plain) element.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', code: 'KeyV', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
    const clipboardData = new DataTransfer();
    for (const [type, text] of Object.entries(data)) clipboardData.setData(type, text);
    const start = performance.now(); element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true })); return performance.now() - start;
  }, { data, plain });
  await frame(); return responseMs;
};
const conversion = () => page.getByRole('dialog').filter({ hasText: '转换为 NoteBoard 文档' });
const translatedHtml = '<p style="color:white;background:#252321;text-align:justify"><span class="immersive-translate-target-wrapper" style="color:white">近年的研究仍有挑战。<a href="https://arxiv.org/html/2410.05160#bib.bib33" style="color:#36a4dc"><strong>Muenninghoff 等人（2023）</strong></a>提出了评估方法；<em>文本与图像</em>都需要保留。</span></p>';
const plainText = '近年的研究仍有挑战。Muenninghoff 等人（2023）提出了评估方法；文本与图像都需要保留。';
async function structuredRound(format, repeats) {
  const section = index => `<section><h2>章节 ${index}</h2><p>前文 <span><strong>重点</strong><em>术语</em></span> 后文</p><ul><li>第一项</li><li>第二项</li></ul><ol start="7"><li>第七项</li></ol><div><div><table><tr><th>名称</th><th>说明</th></tr><tr><td>结构 ${index}</td><td>内容与次序完整保留</td></tr></table></div></div><p>公式 \\(a+b\\)</p><span>\\[x=y\\]</span><blockquote><p>引用文字</p></blockquote><p>章节结束 ${index}</p></section>`;
  const content = Array.from({ length: repeats }, (_, index) => section(index)).join('');
  const html = `Version:0.9\r\nStartHTML:0000000100\r\nStartFragment:0000000200\r\n<html><body><!--StartFragment--><html><head></head><body><custom-wrapper><span>${content}</span></custom-wrapper></body></html><!--EndFragment--></body></html>`;
  if (repeats > 1) assert(html.length > 24000, 'Must exercise the real Worker');
  await load(); await paste({ 'text/html': html });
  await page.waitForFunction(last => Array.from(document.querySelectorAll('.nb-prose.ProseMirror[contenteditable="true"]')).at(-1)?.editor.state.doc.textContent.includes(last), `章节结束 ${repeats - 1}`, { timeout: 20000 });
  const result = await snapshot(), counts = {}, pending = [...result.json.content];
  while (pending.length) { const node = pending.pop(); counts[node.type] = (counts[node.type] || 0) + 1; pending.push(...node.content || []); }
  for (const type of ['heading', 'bulletList', 'orderedList', 'table', 'mathInline', 'mathBlock', 'blockquote']) assert.equal(counts[type], repeats, `${format}: ${type}`);
  assert.deepEqual(result.json.content.slice(0, 9).map(node => node.type), ['heading', 'paragraph', 'bulletList', 'orderedList', 'table', 'paragraph', 'mathBlock', 'blockquote', 'paragraph']);
  assert.equal(result.marks.filter(mark => mark.type === 'bold').length, repeats);
  assert.equal(await page.evaluate(() => window.__qaClipboardWorkers.active), 0);
  await prose.evaluate(element => element.editor.commands.undo()); await frame(); assert.equal((await snapshot()).text, '');
  await prose.evaluate(element => element.editor.commands.redo()); await frame(); assert.deepEqual((await snapshot()).json, result.json);
  report.cases.push({ name: 'nested-document-structure', format, characters: html.length, repeats, counts, undoRedo: true });
}
async function wholePageRound(format) {
  const turns = 150;
  const turn = index => [
    `<article><h2>历史回合 ${index}</h2>`,
    ...Array.from({ length: 12 }, (_, line) => `<p>第 ${index}-${line} 段 <strong>研究结果</strong>与<a href="https://example.com/${index}/${line}">来源</a>。</p>`),
    '<table>', '<tr><th>条件</th><th>结果</th></tr>', '<tr><td>对照</td><td>0.0857</td></tr>', '</table>',
    '<ul><li>结论一</li><li>结论二</li></ul>',
    `<pre><code>result = ${index}</code></pre>`,
    `<p>回合结束 ${index}${index % 10 === 0 ? ' \\(r^4\\)' : ''}</p></article>`,
  ].join('\n');
  const source = Array.from({ length: turns }, (_, index) => turn(index)).join('\n');
  assert.equal(source.split('\n').length, 3000);
  const hidden = '<section hidden><p>不能带入的隐藏正文</p></section>';
  const html = `Version:0.9\r\nStartHTML:0000000100\r\nStartFragment:0000000200\r\n<html><body>${'<div>'.repeat(80)}<p>选区外</p><!--StartFragment-->${hidden}${source}<!--EndFragment--><p>选区外</p>${'</div>'.repeat(80)}</body></html>`;
  await load(); const started = Date.now(), responseMs = await paste({ 'text/html': html });
  await page.waitForFunction(last => Array.from(document.querySelectorAll('.nb-prose.ProseMirror[contenteditable="true"]')).at(-1)?.editor.state.doc.textContent.includes(last), `回合结束 ${turns - 1}`, { timeout: 30000 });
  const completionMs = Date.now() - started, result = await snapshot();
  const counts = {}, pending = [...result.json.content];
  while (pending.length) { const node = pending.pop(); counts[node.type] = (counts[node.type] || 0) + 1; pending.push(...node.content || []); }
  for (const type of ['heading', 'table', 'bulletList', 'codeBlock']) assert.equal(counts[type], turns, `${format}: full page ${type}`);
  assert.equal(counts.mathInline, 15); assert.equal(result.marks.filter(mark => mark.type === 'bold').length, turns * 12);
  assert(!result.text.includes('选区外')); assert(!result.text.includes('不能带入'));
  const atStart = await prose.evaluate(element => {
    const owner = element.closest('[data-editor-scroll]').getBoundingClientRect();
    const title = element.querySelector('h2').getBoundingClientRect();
    return title.top >= owner.top && title.bottom <= owner.bottom;
  });
  assert(atStart, 'The first turn is visible immediately after paste');
  assert.equal(await conversion().count(), 0); assert.equal(await page.evaluate(() => window.__qaClipboardWorkers.active), 0);
  await prose.evaluate(element => { element.editor.state.doc.check(); element.editor.commands.undo(); }); await frame(); assert.equal((await snapshot()).text, '');
  await prose.evaluate(element => element.editor.commands.redo()); await frame(); assert.deepEqual((await snapshot()).json, result.json);
  report.cases.push({ name: 'whole-web-page-3000-lines', format, characters: html.length, counts, responseMs, completionMs, atStart, undoRedo: true, workersReleased: true });
}
async function longMarkdownRound() {
  const raw = Array.from({ length: 300 }, (_, index) => [
    `## Markdown section ${index}`, '', `Paragraph ${index} with **emphasis**.`, '',
    '- First item', '- Second item', '', '```text', `code ${index}`, '```', '',
  ].join('\n')).join('\n');
  assert(raw.length > 24_000);
  await load(); await paste({ 'text/markdown': raw });
  await page.waitForFunction(() => Array.from(document.querySelectorAll('.nb-prose.ProseMirror[contenteditable="true"]')).at(-1)?.editor.state.doc.textContent.includes('code 299'));
  const first = await prose.evaluate(element => {
    const owner = element.closest('[data-editor-scroll]').getBoundingClientRect();
    const heading = element.querySelector('h2').getBoundingClientRect();
    return { visible: heading.top >= owner.top && heading.bottom <= owner.bottom, caret: element.editor.state.selection.from };
  });
  assert.deepEqual(first, { visible: true, caret: 1 });
  const content = (await snapshot()).json;
  assert.equal(content.content.filter(node => node.type === 'heading').length, 300);
  assert.equal(content.content.filter(node => node.type === 'codeBlock').length, 300);
  await prose.evaluate(element => element.editor.commands.undo()); assert.equal((await snapshot()).text, '');
  await prose.evaluate(element => element.editor.commands.redo()); assert.deepEqual((await snapshot()).json, content);

  await load(Array.from({ length: 120 }, (_, index) => `Original paragraph ${index}\n`).join('\n'));
  const before = await prose.evaluate((element, raw) => {
    const { editor } = element;
    const owner = element.closest('[data-editor-scroll]');
    editor.commands.setTextSelection(1);
    const height = owner.scrollHeight;
    const clipboardData = new DataTransfer(); clipboardData.setData('text/markdown', raw);
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
    const pending = element.querySelector('[role="status"]')?.textContent.includes('正在粘贴');
    const pendingHeight = owner.scrollHeight;
    owner.scrollTop = 450;
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    const ownerTop = owner.getBoundingClientRect().top;
    const anchor = [...element.querySelectorAll('p')].find(paragraph => paragraph.getBoundingClientRect().top >= ownerTop + 30);
    return { height, pendingHeight, pending, scroll: owner.scrollTop, anchor: anchor.textContent, top: anchor.getBoundingClientRect().top };
  }, raw);
  assert(before.pending); assert.equal(before.pendingHeight, before.height);
  await page.waitForFunction(() => Array.from(document.querySelectorAll('.nb-prose.ProseMirror[contenteditable="true"]')).at(-1)?.editor.state.doc.textContent.includes('code 299'));
  await frame();
  const after = await prose.evaluate((element, anchor) => ({
    caret: element.editor.state.selection.$from.parent.textContent,
    scroll: element.closest('[data-editor-scroll]').scrollTop,
    top: [...element.querySelectorAll('p')].find(paragraph => paragraph.textContent === anchor).getBoundingClientRect().top,
  }), before.anchor);
  assert.equal(after.caret, 'Original paragraph 119');
  assert(Math.abs(after.top - before.top) <= 1, JSON.stringify({ before, after }));
  report.cases.push({ name: 'long-markdown-reading', characters: raw.length, headings: 300, firstScreen: first, before, after });
}
try {
  if (!cdp) {
    await installBrowserNativeShell(page);
    await page.addInitScript(() => {
      const invoke = window.__TAURI_INTERNALS__.invoke;
      const initial = '# 网页粘贴测试\n\n正文\n';
      const files = new Map([['C:/qa/paste/paste.md', initial]]);
      const payload = path => ({ key: path, displayName: path.split('/').pop(), dirPath: 'C:/qa/paste', kind: path.endsWith('.nb') ? 'noteboard' : 'markdown', language: 'markdown', content: files.get(path), encoding: 'utf8', eol: 'lf', size: files.get(path)?.length ?? 0, mtime: 1, readonly: false });
      window.__TAURI_INTERNALS__.invoke = async (command, args) => {
        if (command === 'plugin:dialog|open') return 'C:/qa/paste';
        if (command === 'read_native_headers') return [];
        if (command === 'read_dir') return [...files.keys()].map(path => ({ name: path.split('/').pop(), path, kind: path.endsWith('.nb') ? 'noteboard' : 'markdown', isDir: false, size: files.get(path).length, mtime: 1, isHidden: false, isSymlink: false }));
        if (command === 'register_document') return { type: 'ok' };
        if (command === 'prepare_document') return { type: 'text', payload: payload(args.path) };
        if (command === 'read_document') return payload(args.path);
        if (command === 'save_native_bundle') { const request = args.request; files.set(request.path, request.content); if (request.markdown) files.set(request.markdown.path, request.markdown.content); return { ok: true, native: { mtime: 2, size: request.content.length } }; }
        return invoke(command, args);
      };
    });
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
    await page.getByRole('button', { name: '新建或打开', exact: true }).click();
    await page.getByRole('menuitem', { name: /打开文件夹/ }).click();
    await page.locator('[data-explorer-row]').filter({ hasText: 'paste.md' }).first().click();
  }
  await prose.waitFor();
  await page.evaluate(() => {
    const Base = Worker; window.__qaClipboardWorkers = { created: 0, active: 0 };
    window.Worker = class extends Base {
      constructor(url, options) {
        super(url, options);
        if (!String(url).includes('clipboard.worker')) return;
        const stats = window.__qaClipboardWorkers; stats.created++; stats.active++;
        const terminate = this.terminate.bind(this); let done = false;
        this.terminate = () => { if (!done) { done = true; stats.active--; } terminate(); };
      }
    };
  });
  await load(); await paste({ 'text/html': translatedHtml, 'text/plain': plainText });
  let result = await snapshot();
  assert.equal(result.text, plainText); assert(result.marks.some(mark => mark.type === 'link')); assert(result.marks.some(mark => mark.type === 'bold'));
  assert(!result.marks.some(mark => ['textColor', 'highlight'].includes(mark.type))); assert.equal(await conversion().count(), 0);
  await page.screenshot({ path: `${out}/markdown-web-links.png` });
  report.cases.push({ name: 'translated-web-html', linksAndBasicMarks: true, conversionPrompt: false });
  await load(); await paste({ 'text/html': translatedHtml, 'text/plain': plainText }, true);
  result = await snapshot(); assert.equal(result.text, plainText); assert.equal(result.marks.length, 0); assert.equal(await conversion().count(), 0);
  report.cases.push({ name: 'plain-paste', plainTextOnly: true, conversionPrompt: false });
  const large = Array.from({ length: 600 }, (_, i) => `<p style="color:white;background:#252321">第 ${i} 行，<a href="https://example.com/${i}"><strong>链接 ${i}</strong></a>，正文完整保留。</p>`).join('');
  const session = await context.newCDPSession(page);
  const memory = async () => { await session.send('HeapProfiler.collectGarbage'); const { metrics } = await session.send('Performance.getMetrics'); return { heap: metrics.find(metric => metric.name === 'JSHeapUsedSize')?.value, ...await session.send('Memory.getDOMCounters') }; };
  await session.send('Performance.enable');
  async function largeRound() {
    await load(); const responseMs = await paste({ 'text/html': large });
    await page.waitForFunction(() => Array.from(document.querySelectorAll('.nb-prose.ProseMirror[contenteditable="true"]')).at(-1)?.editor.state.doc.textContent.includes('第 599 行'), null, { timeout: 20000 });
    const value = await snapshot(); assert.equal(value.marks.filter(mark => mark.type === 'link').length, 600); assert.equal(await conversion().count(), 0);
    assert.equal(await page.evaluate(() => window.__qaClipboardWorkers.active), 0);
    await load(); return responseMs;
  }
  await largeRound(); const before = await memory(); const responses = [];
  for (let round = 0; round < 3; round++) responses.push(await largeRound());
  const after = await memory();
  assert(after.heap - before.heap < 12_000_000, 'Repeated paste/clear heap remains bounded');
  assert(after.jsEventListeners - before.jsEventListeners < 500, 'Paste does not retain per-row event listeners');
  report.cases.push({ name: 'large-html-worker', characters: large.length, rows: 600, rounds: 4, responses, before, after, workers: await page.evaluate(() => window.__qaClipboardWorkers) });
  await structuredRound('markdown', 1); await structuredRound('markdown', 80);
  await wholePageRound('markdown');
  await longMarkdownRound();
  await load('保留的正文');
  const rich = { version: 1, openStart: 0, openEnd: 0, content: [{ type: 'paragraph', content: [{ type: 'text', text: '新增的蓝色链接', marks: [{ type: 'textColor', attrs: { color: '#1234ab' } }, { type: 'link', attrs: { href: 'https://example.com/replay' } }] }] }] };
  const data = { 'application/x-noteboard-document-slice': JSON.stringify(rich), 'text/plain': '新增的蓝色链接' };
  await paste(data); assert.equal(await conversion().count(), 0);
  result = await snapshot(); assert(result.text.includes('保留的正文')); assert(result.marks.some(mark => mark.type === 'textColor' && mark.attrs.color === '#1234ab'));
  assert(result.marks.some(mark => mark.type === 'link' && mark.attrs.href === 'https://example.com/replay'));
  await prose.evaluate(element => element.editor.commands.undo()); await frame(); assert.equal((await snapshot()).text, '保留的正文');
  await prose.evaluate(element => element.editor.commands.redo()); await frame(); assert.equal((await snapshot()).text, result.text);
  report.cases.push({ name: 'structured-mime-in-markdown', declarativePresentationRetained: true, conversionPrompt: false, undoRedo: true });
  await page.getByRole('button', { name: '新建或打开', exact: true }).click();
  await page.getByRole('menuitem', { name: /新建 NoteBoard 文档/ }).click();
  await page.waitForFunction(() => Array.from(document.querySelectorAll('.nb-prose.ProseMirror[contenteditable="true"]')).at(-1)?.editor.state.doc.textContent === '');
  await load(); await paste({ 'text/html': translatedHtml, 'text/plain': plainText }); result = await snapshot();
  assert(result.marks.some(mark => mark.type === 'textColor')); assert.equal(result.text, plainText);
  report.cases.push({ name: 'translated-web-html-in-noteboard', nativeAppearanceRetained: true });
  await structuredRound('noteboard', 1); await structuredRound('noteboard', 80);
  await wholePageRound('noteboard');
  assert.equal(report.errors.length, 0); report.passed = true;
} finally {
  if (!report.passed) await page.screenshot({ path: `${out}/failure.png` }).catch(() => {});
  await fs.writeFile(`${out}/results.json`, JSON.stringify(report, null, 2));
  await browser.close(); await server?.httpServer.close();
}
console.log(JSON.stringify({ passed: report.passed, out }));
