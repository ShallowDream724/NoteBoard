/* global window */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { build, preview } from 'vite';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const outDir = '.tmp/export-item-pagination-dist';
await build({ configFile: false, build: { outDir, emptyOutDir: true, rollupOptions: { input: 'test/browser/exportItemPagination.html' } }, logLevel: 'error' });
const server = await preview({ configFile: false, build: { outDir }, preview: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/test/browser/exportItemPagination.html`);
  await page.waitForFunction(() => window.exportItemPaginationQA);
  const results = [];
  for (const spacer of [900, 925, 950, 975, 1000]) {
    await page.evaluate(spacer => window.exportItemPaginationQA.render(spacer), spacer);
    const data = await page.pdf({ format: 'A4', margin: { top: '12mm', bottom: '12mm', left: '12mm', right: '12mm' }, printBackground: true });
    await fs.writeFile(`.tmp/export-item-pagination-${spacer}.pdf`, data);
    const task = getDocument({ data: new Uint8Array(data), useSystemFonts: true });
    const pdf = await task.promise;
    const pages = [];
    for (let index = 1; index <= pdf.numPages; index++) {
      const printed = await pdf.getPage(index);
      const text = (await printed.getTextContent()).items.map(item => item.str || '').join(' ');
      const locations = (await printed.getAnnotations()).filter(annotation => annotation.url?.startsWith('https://noteboard.invalid/export-item/'));
      pages.push({ page: index, hasFormula: text.includes('textbf'), text, locations: locations.map(location => location.rect) });
    }
    results.push({ spacer, pages });
    await task.destroy();
  }
  assert.deepEqual(errors, []);
  execFileSync('cargo', ['test', '--manifest-path', 'src-tauri/Cargo.toml', '--lib', 'export::pdf_document::tests::', '--', '--include-ignored'], {
    env: { ...process.env, NOTEBOARD_PDF_PAGINATION_FIXTURES: path.resolve('.tmp') }, stdio: 'inherit',
  });
  for (const result of results) {
    result.locations = JSON.parse(await fs.readFile(`.tmp/export-item-pagination-${result.spacer}.locations.json`, 'utf8'));
    assert(result.pages.some(page => page.page > 1 && page.hasFormula), `The ${result.spacer}px fixture must push the heading to another page`);
    for (const page of result.pages) assert.equal(result.locations.some(location => location.page === page.page), page.hasFormula,
      `${result.spacer}px page ${page.page}: marker must follow actual formula text`);
  }
  await fs.writeFile('.tmp/export-item-pagination-results.json', JSON.stringify({ results, errors }, null, 2));
  console.log(JSON.stringify({ passed: true, cases: results.length, report: '.tmp/export-item-pagination-results.json' }));
} finally { await browser.close(); await new Promise(resolve => server.httpServer.close(resolve)); }
