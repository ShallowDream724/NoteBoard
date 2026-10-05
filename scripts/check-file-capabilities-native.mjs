/* global document, window */
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
const mode = process.argv[2];
assert(['before', 'after'].includes(mode));
const record = JSON.parse(await fs.readFile(`.tmp/native-qa/file-capabilities-${mode}.json`, 'utf8'));
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${record.port}`);
const page = browser.contexts()[0].pages().find(page => !page.url().startsWith('devtools:'));
const out = `.tmp/file-capabilities/native-${mode}`;
await fs.mkdir(out, { recursive: true });
const report = { native: true, mode, errors: [], fixture: '100,000 × 30 CSV, real filesystem IPC', fonts: 'Generic system fonts in isolated QA profile' };
page.on('pageerror', error => report.errors.push(String(error)));
try {
  if (mode === 'before') await page.locator('.cm-editor:visible').waitFor();
  else {
    await page.getByRole('grid', { name: 'stress.csv 数据', exact: true }).waitFor();
    await page.getByRole('textbox', { name: '单元格位置', exact: true }).fill('AD100000');
    await page.getByRole('button', { name: '定位', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.nb-delimited-detail pre')?.textContent === 'END');
    report.renderedCells = await page.getByRole('gridcell').count();
    assert(report.renderedCells < 1000);
    report.total = await page.locator('.nb-delimited-count').textContent();
    report.nativeRead = await page.evaluate(async files => {
      const svg = await window.__TAURI_INTERNALS__.invoke('read_document', { path: files.svg, maxReadBytes: 2 * 1024 * 1024 });
      const environment = await window.__TAURI_INTERNALS__.invoke('read_document', { path: files.environment });
      let limitRejected = false;
      try { await window.__TAURI_INTERNALS__.invoke('read_document', { path: files.svg, maxReadBytes: 1 }); }
      catch { limitRejected = true; }
      return { svgKind: svg.kind, svgLanguage: svg.language, svgContent: svg.content.includes('<svg'),
        environmentLanguage: environment.language, limitRejected };
    }, { svg: path.resolve('../../outputs/File-Text-Samples/vector.svg'), environment: path.resolve('../../outputs/File-Text-Samples/.env.production') });
    assert.deepEqual(report.nativeRead, { svgKind: 'image', svgLanguage: 'xml', svgContent: true, environmentLanguage: 'ini', limitRejected: true });
  }
  await page.screenshot({ path: `${out}/csv.png` });
  const cdp = await browser.contexts()[0].newCDPSession(page);
  await cdp.send('HeapProfiler.collectGarbage');
  report.heap = await cdp.send('Runtime.getHeapUsage');
  report.dom = await cdp.send('Memory.getDOMCounters');
  assert.equal(report.errors.length, 0);
  report.passed = true;
} finally {
  if (!report.passed) await page.screenshot({ path: `${out}/failure.png` }).catch(() => {});
  await fs.writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(JSON.stringify({ passed: report.passed, out, cells: report.renderedCells }));
