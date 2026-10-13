/* global window */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { build, preview } from 'vite';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const outDir = '.tmp/container-pagination-dist';
await build({ configFile: false, worker: { format: 'es' }, build: { outDir, emptyOutDir: true, rollupOptions: { input: 'test/browser/containerPagination.html' } }, logLevel: 'error' });
const server = await preview({ configFile: false, build: { outDir }, preview: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true, args: ['--no-proxy-server'] });
try {
  const page = await browser.newPage(); const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/test/browser/containerPagination.html`);
  await page.waitForFunction(() => window.containerPaginationQA);
  const cases = [['note', false], ['disclosure', false], ['code', false], ['quote', false], ['math', false], ['image', false], ['nestedImage', false], ['grid', true], ['note', true], ['disclosure', true], ['code', true], ['table', true]];
  const results = [];
  for (const [kind, long] of cases) {
    const geometry = await page.evaluate(({ kind, long }) => window.containerPaginationQA.render(kind, long), { kind, long });
    assert.deepEqual(geometry.report.issues, [], `${kind} layout must be valid`);
    const data = await page.pdf({ format: 'A4', margin: { top: '12mm', bottom: '12mm', left: '12mm', right: '12mm' }, printBackground: true });
    const name = `${kind}-${long ? 'long' : 'short'}`;
    await fs.writeFile(`.tmp/container-pagination-${name}.pdf`, data);
    const task = getDocument({ data: new Uint8Array(data), useSystemFonts: true }); const pdf = await task.promise;
    const pages = [];
    for (let index = 1; index <= pdf.numPages; index++) {
      const printed = await pdf.getPage(index); const operators = await printed.getOperatorList();
      const text = (await printed.getTextContent()).items.map(item => item.str || '').join('').replace(/\s/g, '');
      pages.push({ index, text, images: operators.fnArray.filter(op => [OPS.paintImageXObject, OPS.paintInlineImageXObject].includes(op)).length });
    }
    const containing = token => pages.filter(page => page.text.includes(token)).map(page => page.index);
    if (kind === 'image' || kind === 'nestedImage') { const imagePages = pages.filter(page => page.images).map(page => page.index); assert.deepEqual(containing('ImageCaptionEnd'), imagePages); assert.deepEqual(imagePages, [2]); }
    else if (kind === 'math') { assert.deepEqual(containing('MathStart'), [2]); assert.deepEqual(containing('MathEnd'), [2]); }
    else if (kind === 'grid') for (let index = 0; index < 8; index++) { const matches = pages.filter(page => page.text.includes(`GridCaption${index}End`)); assert.equal(matches.length, 1); assert(matches[0].images > 0); }
    else {
      for (const line of geometry.lines) assert.equal(containing(line).length, 1, `${name}: ${line} lost or duplicated`);
      if (long) { assert.deepEqual(containing(geometry.lines[0]), [1], `${name} must use remaining first-page space`); assert(containing(geometry.lines.at(-1))[0] > 1); }
      else { assert.deepEqual(containing(geometry.lines[0]), [2]); const title = { note: 'NoteStart', disclosure: 'DisclosureStart', code: 'CodeStart', quote: 'QuoteStart' }[kind]; assert.deepEqual(containing(title), [2]); }
    }
    assert.equal(containing('DocumentEnd').length, 1);
    results.push({ name, geometry, pages }); await task.destroy();
  }
  assert.deepEqual(errors, []);
  await fs.writeFile('.tmp/container-pagination-results.json', JSON.stringify({ results, errors }, null, 2));
  console.log(JSON.stringify({ passed: true, cases: results.length, report: '.tmp/container-pagination-results.json' }));
} finally { await browser.close(); await new Promise(resolve => server.httpServer.close(resolve)); }
