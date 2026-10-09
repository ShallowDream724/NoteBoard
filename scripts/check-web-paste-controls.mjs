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
const server = cdp ? null : await preview({ configFile: false, build: { outDir: 'dist' }, preview: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
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
  await load('保留的正文');
  const rich = { version: 1, openStart: 0, openEnd: 0, content: [{ type: 'paragraph', content: [{ type: 'text', text: '新增的蓝色链接', marks: [{ type: 'textColor', attrs: { color: '#1234ab' } }, { type: 'link', attrs: { href: 'https://example.com/replay' } }] }] }] };
  const data = { 'application/x-noteboard-document-slice': JSON.stringify(rich), 'text/plain': '新增的蓝色链接' };
  await paste(data); await conversion().waitFor(); await conversion().getByRole('button', { name: '取消', exact: true }).click(); await frame();
  assert.equal((await snapshot()).text, '保留的正文');
  await paste(data); await conversion().waitFor(); await conversion().getByRole('button', { name: '转换并继续', exact: true }).click();
  await page.waitForFunction(() => Array.from(document.querySelectorAll('.nb-prose.ProseMirror[contenteditable="true"]')).at(-1)?.editor.state.doc.textContent.includes('新增的蓝色链接'), null, { timeout: 20000 });
  result = await snapshot(); assert(result.text.includes('保留的正文')); assert(result.marks.some(mark => mark.type === 'textColor' && mark.attrs.color === '#1234ab'));
  assert(result.marks.some(mark => mark.type === 'link' && mark.attrs.href === 'https://example.com/replay'));
  await page.screenshot({ path: `${out}/conversion-replays-paste.png` });
  await prose.evaluate(element => element.editor.commands.undo()); await frame(); assert.equal((await snapshot()).text, '保留的正文');
  await prose.evaluate(element => element.editor.commands.redo()); await frame(); assert.equal((await snapshot()).text, result.text);
  await load(); await paste({ 'text/html': translatedHtml, 'text/plain': plainText }); result = await snapshot();
  assert(result.marks.some(mark => mark.type === 'textColor')); assert.equal(result.text, plainText);
  report.cases.push({ name: 'explicit-NB-paste', cancelPreservesContent: true, confirmedPasteRetained: true, undoRedo: true, nativeAppearanceRetained: true });
  assert.equal(report.errors.length, 0); report.passed = true;
} finally {
  if (!report.passed) await page.screenshot({ path: `${out}/failure.png` }).catch(() => {});
  await fs.writeFile(`${out}/results.json`, JSON.stringify(report, null, 2));
  await browser.close(); await server?.httpServer.close();
}
console.log(JSON.stringify({ passed: report.passed, out }));
