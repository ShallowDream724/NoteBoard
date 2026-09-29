/* global window */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { build, preview } from 'vite';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const outDir = '.tmp/export-math-overflow-dist';
if (!process.argv.includes('--reuse')) await build({ configFile: false, worker: { format: 'es' }, build: { outDir, emptyOutDir: true, rollupOptions: { input: 'test/browser/exportMathOverflow.html' } }, logLevel: 'error' });
const server = await preview({ configFile: false, build: { outDir }, preview: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/test/browser/exportMathOverflow.html`);
  await page.waitForFunction(() => window.exportMathOverflowQA);
  const results = [];
  const contained = formula => {
    assert(formula.baseLeft >= formula.left - 1, `${formula.id}: content crosses the left boundary`);
    assert(formula.baseRight <= formula.right + 1, `${formula.id}: content crosses the right boundary`);
  };
  for (const fontPt of [10.5, 18, 24]) {
    const result = await page.evaluate(fontPt => window.exportMathOverflowQA.render({ fontPt }), fontPt);
    assert.deepEqual(result.report, { issues: [], adjustable: [] });
    result.after.forEach(formula => { contained(formula); assert.equal(formula.zoom, ''); assert.equal(formula.wrap, false); });
    // This is the real KaTeX strut overflow that used to block an otherwise
    // fitting right-aligned formula. Keep the regression tied to that geometry.
    const right = result.before.find(formula => formula.align === 'right');
    assert(right.scrollWidth > right.offsetWidth + 1);
    results.push({ name: `loss-${fontPt}pt`, ...result });
  }
  await page.screenshot({ path: '.tmp/export-math-overflow-loss.png', fullPage: true });
  const source = String.raw`\text{${'WIDE CONTENT '.repeat(35)}}`;
  const oversized = await page.evaluate(source => window.exportMathOverflowQA.render({ source }), source);
  assert.equal(oversized.report.issues.filter(issue => issue.blocking).length, 3, 'Genuine oversized content must still block all alignments');
  assert(oversized.after.every(formula => formula.baseRight - formula.baseLeft > formula.width + 1));
  results.push({ name: 'unbreakable-auto', ...oversized });
  const fitted = await page.evaluate(source => window.exportMathOverflowQA.render({ source, mode: 'fit' }), source);
  assert.deepEqual(fitted.report.issues, []);
  fitted.after.forEach(formula => { contained(formula); assert(Number(formula.zoom) < 1); });
  results.push({ name: 'unbreakable-fit', ...fitted });
  const wrapped = await page.evaluate(source => window.exportMathOverflowQA.render({ source }), 'F=' + Array.from({ length: 45 }, (_, index) => `x_{${index}}`).join('+'));
  assert.deepEqual(wrapped.report.issues, []);
  wrapped.after.forEach(formula => { contained(formula); assert(formula.wrap); });
  results.push({ name: 'wrapped-operators', ...wrapped });
  const sum = Array.from({ length: 24 }, (_, index) => `x_{${index}}+y_{${index}}`).join('+');
  for (const [name, source] of [
    ['fraction', `R=\\frac{${sum}}{${sum}}`],
    ['root', `R=\\sqrt{${sum}}`],
    ['nested', `R=\\left(\\frac{${sum}}{1+\\sqrt{${sum}}}\\right)`],
  ]) {
    const structured = await page.evaluate(source => window.exportMathOverflowQA.render({ source }), source);
    if (structured.report.issues.length) {
      await fs.writeFile('.tmp/export-structured-failure.json', JSON.stringify({ name, structured, html: await page.locator('.export-math').first().innerHTML() }, null, 2));
      await page.screenshot({ path: '.tmp/export-structured-failure.png', fullPage: true });
    }
    assert.deepEqual(structured.report.issues, [], `${name}: shared structural reflow must fit all alignments`);
    structured.after.forEach(contained);
    results.push({ name: `structured-${name}`, ...structured });
  }
  await page.screenshot({ path: '.tmp/export-math-structured-wrap.png', fullPage: true });
  await page.evaluate(() => window.exportMathOverflowQA.sidebar());
  await page.getByRole('heading', { name: '内容处理说明' }).waitFor();
  await page.locator('.export-dialog').screenshot({ path: '.tmp/ux6-export-sidebar.png' });
  assert.deepEqual(errors, []);
  await fs.writeFile('.tmp/export-math-overflow-results.json', JSON.stringify({ results, errors }, null, 2));
  console.log(JSON.stringify({ passed: true, cases: results.length, alignmentsPerCase: 3, report: '.tmp/export-math-overflow-results.json' }));
} finally { await browser.close(); await new Promise(resolve => server.httpServer.close(resolve)); }
