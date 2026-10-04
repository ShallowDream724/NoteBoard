/* global window, document, getComputedStyle */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { build, preview } from 'vite';
import react from '@vitejs/plugin-react';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const outDir = '.tmp/formula-scroll-dist';
await fs.mkdir('.tmp', { recursive: true });
await fs.writeFile('.tmp/formula-scroll-editor.html', '<!doctype html><html><body><div id="root"></div><script type="module" src="./formula-scroll-editor.tsx"></script></body></html>');
await fs.writeFile('.tmp/formula-scroll-editor.tsx', `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { TooltipProvider } from '../src/components/Tooltip';
import { TipTapEditor } from '../src/features/editor-md/TipTapEditor';
import { useDocumentStore } from '../src/stores/documentStore';
import { useWindowStore } from '../src/stores/windowStore';
import { useSettingsStore } from '../src/stores/settingsStore';
import { applyTheme, applyTypography } from '../src/core/theme/applyTheme';
import { NATIVE_DOCUMENT_HEADER } from '../src/core/nativeDocument';
import { getMdTipTapEditor } from '../src/features/editor-md/editorInstances';
import { parseEditorDocument, serializeEditorDocument } from '../src/features/editor-md/editorDocumentCodec';
import { setDocumentFormulaReadingMode } from '../src/features/editor-md/documentReadingView';
import '../src/styles/globals.css';
import '../src/components/appShell.css';
const key = 'untitled:formula-scroll.noteboard';
const record = block => '@block ' + JSON.stringify(block);
const initial = NATIVE_DOCUMENT_HEADER + '\\n' + record({ type: 'paragraph', content: [{ type: 'text', text: 'Formula scroll ready' }] }) + '\\n';
applyTheme('chen-guang'); applyTypography(useSettingsStore.getState().settings.typography);
useDocumentStore.getState().upsertFromPayload({ key, displayName: 'Formula scroll.noteboard', dirPath: '', kind: 'noteboard', language: 'markdown', content: initial, encoding: 'utf8', eol: 'lf', size: 0, mtime: 0, readonly: false });
useWindowStore.getState().openTab({ key, displayName: 'Formula scroll.noteboard', path: null, kind: 'noteboard', language: 'markdown', isDirty: false, isPreview: false, viewMode: 'visual', externalStatus: null, isDetached: false });
const style = document.createElement('style'); style.textContent = 'html,body,#root{margin:0;width:100%;height:100%}.nb-editor-area{height:100%}'; document.head.append(style);
createRoot(document.getElementById('root')).render(<TooltipProvider><div className="nb-editor-area"><TipTapEditor docKey={key}/></div></TooltipProvider>);
window.formulaScrollQA = {
  ready: () => !!getMdTipTapEditor(key),
  load: (latex, textAlign) => parseEditorDocument(getMdTipTapEditor(key), NATIVE_DOCUMENT_HEADER + '\\n' + record({ type: 'mathBlock', attrs: { latex, delimiter: '$$', textAlign } }) + '\\n' + record({ type: 'paragraph' }) + '\\n'),
  reading: mode => setDocumentFormulaReadingMode(getMdTipTapEditor(key), mode),
  source: () => serializeEditorDocument(getMdTipTapEditor(key)),
};
`);
await fs.writeFile('.tmp/formula-scroll-export.html', '<!doctype html><html><body><script type="module" src="./formula-scroll-export.ts"></script></body></html>');
await fs.writeFile('.tmp/formula-scroll-export.ts', `
import { parseMarkdownDocument } from '../src/features/editor-md/documentExtensions';
import { renderDocument } from '../src/features/export/renderDocument';
import { standaloneHtml } from '../src/features/export/standaloneHtml';
window.formulaScrollExport = async (latex, align) => {
  const source = '$$\\n' + latex + '\\n$$';
  const parsed = parseMarkdownDocument(source), json = parsed.toJSON();
  json.content[0].attrs.textAlign = align;
  const snapshot = parsed.type.schema.nodeFromJSON(json);
  const rendered = await renderDocument(source, 'Formula scroll', '', undefined, snapshot, undefined, undefined, 'html');
  return standaloneHtml(rendered.html, rendered.title);
};
`);
if (!process.argv.includes('--reuse')) await build({ configFile: false, plugins: [react()], worker: { format: 'es' }, build: { outDir, emptyOutDir: true, rollupOptions: { input: ['.tmp/formula-scroll-editor.html', '.tmp/formula-scroll-export.html'] } }, logLevel: 'error' });
const server = await preview({ configFile: false, build: { outDir }, preview: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [], result = { editor: [], html: [], unreserved: {}, errors };
const short = String.raw`\begin{aligned}s(t)&=\begin{cases}0,&t\le0,\\[2pt]3t^2-2t^3,&0<t<1,\\[2pt]1,&t\ge1,\end{cases}\\[6pt]s'(0)&=s'(1)=0,\quad\int_0^1s(t)\,\mathrm{d}t=\frac12.\end{aligned}`;
const long = Array.from({ length: 90 }, (_, index) => `x_{${index}}`).join('+');
const geometry = host => {
  const style = getComputedStyle(host), box = host.getBoundingClientRect();
  const bases = [...host.querySelectorAll('.katex-html > .base')].map(base => base.getBoundingClientRect());
  host.scrollLeft = host.scrollWidth;
  const end = host.scrollLeft; host.scrollLeft = 0;
  return { alignment: host.closest('[data-math-align]')?.getAttribute('data-math-align'), clientWidth: host.clientWidth, scrollWidth: host.scrollWidth, scrollEnd: end, paddingEnd: style.paddingInlineEnd, overflowX: style.overflowX,
    contentWidth: Math.max(...bases.map(base => base.right)) - Math.min(...bases.map(base => base.left)),
    left: Math.min(...bases.map(base => base.left)) - box.left, right: Math.max(...bases.map(base => base.right)) - box.left };
};
const check = (row, isLong) => {
  assert.equal(row.alignment, row.align, 'The rendered document must use the requested alignment');
  assert.equal(row.overflowX, 'auto', 'The selected formula viewport must own scrolling');
  assert.equal(row.paddingEnd, row.align === 'right' ? '2px' : '0px', 'Only right alignment reserves the KaTeX cell');
  if (isLong) {
    assert(row.scrollWidth > row.clientWidth + 1000, 'A genuinely wide formula must keep its natural scrolling extent');
    assert(row.scrollEnd > 1000, 'A genuinely wide formula must remain horizontally scrollable');
  } else {
    assert.equal(row.scrollWidth, row.clientWidth, 'A fitting formula must not have a horizontal scrollbar');
    assert.equal(row.scrollEnd, 0, 'A fitting formula must not have a hidden scroll range');
    assert(row.left >= -1 && row.right <= row.clientWidth + 1, 'Every visible formula base must fit');
  }
};
try {
  const root = `http://127.0.0.1:${server.httpServer.address().port}`;
  const editor = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  editor.on('pageerror', error => errors.push(error.message));
  await editor.goto(root + '/.tmp/formula-scroll-editor.html');
  // ready() exposes the kernel before TipTapEditor has synchronized initial source.
  await editor.waitForFunction(() => window.formulaScrollQA?.ready() && window.formulaScrollQA.source().includes('Formula scroll ready'));
  await editor.waitForTimeout(300);
  for (const align of ['left', 'center', 'right']) for (const [name, latex] of [['short', short], ['long', long]]) {
    const source = await editor.evaluate(({ latex, align }) => {
      const qa = window.formulaScrollQA; qa.load(latex, align);
      qa.reading('scroll'); return qa.source();
    }, { latex, align });
    await editor.waitForFunction(latex => document.querySelector('.math-node annotation')?.textContent === latex, latex);
    await editor.evaluate(() => document.fonts.ready);
    await editor.waitForTimeout(200);
    const row = { align, name, ...await editor.locator('.math-node-preview').evaluate(geometry) };
    result.editor.push(row); check(row, name === 'long');
    if (align === 'right' && name === 'short') {
      await editor.screenshot({ path: '.tmp/formula-scroll-editor.png' });
      result.unreserved.editor = await editor.locator('.math-node-preview').evaluate(host => {
        host.style.paddingInlineEnd = '0px'; const excess = host.scrollWidth - host.clientWidth; host.style.paddingInlineEnd = ''; return excess;
      });
      assert.equal(result.unreserved.editor, 2, 'The fitting fixture must reproduce the original 2px overflow without the reservation');
    }
    assert.equal(await editor.evaluate(() => window.formulaScrollQA.source()), source, 'The reading layout must retain formula source');
    // Returning to expand removes the consumer's reservation as well as overflow.
    await editor.evaluate(() => window.formulaScrollQA.reading('expand'));
    assert.equal(await editor.locator('.math-node-preview').evaluate(host => getComputedStyle(host).paddingInlineEnd), '0px');
  }
  const generator = await browser.newPage(); generator.on('pageerror', error => errors.push(error.message));
  await generator.goto(root + '/.tmp/formula-scroll-export.html');
  await generator.waitForFunction(() => !!window.formulaScrollExport);
  const offline = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  offline.on('pageerror', error => errors.push(error.message));
  const network = []; offline.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()); });
  for (const align of ['left', 'center', 'right']) for (const [name, latex] of [['short', short], ['long', long]]) {
    const html = await generator.evaluate(({ latex, align }) => window.formulaScrollExport(latex, align), { latex, align });
    const file = path.resolve(`.tmp/formula-scroll-${align}-${name}.html`); await fs.writeFile(file, html);
    await offline.goto(pathToFileURL(file).href); await offline.evaluate(() => document.fonts.ready);
    const row = { align, name, ...await offline.locator('.export-math.display').evaluate(geometry) };
    check(row, name === 'long'); result.html.push(row);
    if (align === 'right' && name === 'short') {
      await offline.screenshot({ path: '.tmp/formula-scroll-html.png' });
      result.unreserved.html = await offline.locator('.export-math.display').evaluate(host => {
        host.style.paddingInlineEnd = '0px'; const excess = host.scrollWidth - host.clientWidth; host.style.paddingInlineEnd = ''; return excess;
      });
      assert.equal(result.unreserved.html, 2);
    }
    await offline.emulateMedia({ media: 'print' });
    assert.equal(await offline.locator('.export-math.display').evaluate(host => getComputedStyle(host).paddingInlineEnd), '0px', 'Printing must release the scroll reservation');
    await offline.emulateMedia({ media: 'screen' });
  }
  assert.deepEqual(network, [], 'Standalone formulas must render without network requests');
  assert.deepEqual(errors, []); result.success = true;
  console.log(JSON.stringify(result));
} catch (error) { result.success = false; result.failure = error.message; throw error; }
finally { await fs.writeFile('.tmp/formula-scroll-results.json', JSON.stringify(result, null, 2)); await browser.close(); await new Promise(resolve => server.httpServer.close(resolve)); }
