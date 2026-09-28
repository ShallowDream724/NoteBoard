/* global window, document, getComputedStyle, innerWidth, performance */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'vite';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const server = await createServer({ configFile: false, server: { host: '127.0.0.1', port: 0, hmr: false }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true, args: ['--enable-precise-memory-info', '--js-flags=--expose-gc'] });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/test/browser/htmlExport.html`, { waitUntil: 'commit', timeout: 120000 });
  await page.waitForFunction(() => window.htmlExportReady && document.querySelector('iframe')?.contentWindow, undefined, { timeout: 120000 });
  const frame = page.frameLocator('iframe');
  await frame.locator('.export-carousel-controls').waitFor();
  const exported = await frame.locator('.export-math .katex-html').evaluate(element => {
    const rect = element.querySelector(':scope > .base').getBoundingClientRect();
    const calligraphic = element.querySelector('.mathcal');
    return { width: rect.width, height: rect.height, font: calligraphic && getComputedStyle(calligraphic).fontFamily,
      mathmlVisible: getComputedStyle(document.querySelector('.katex-mathml')).position === 'static',
      standards: document.compatMode === 'CSS1Compat', authoredScriptRan: window.__authoredScriptRan === true,
      fontsLoaded: document.fonts.check('16px KaTeX_Caligraphic') };
  });
  const reference = await page.locator('#reference .katex-html').evaluate(element => {
    const rect = element.querySelector(':scope > .base').getBoundingClientRect(); return { width: rect.width, height: rect.height };
  });
  console.log(JSON.stringify({ phase: 'formula', exported, reference, errors }));
  assert(exported.standards, 'preview must remain in standards mode');
  assert(!exported.authoredScriptRan, 'authored script must remain blocked');
  assert(!exported.mathmlVisible, 'KaTeX visual layout must be visible');
  assert(exported.font.includes('KaTeX_Caligraphic'), 'mathcal must use KaTeX calligraphic');
  assert(exported.fontsLoaded, 'embedded KaTeX font must load offline');
  assert(Math.abs(exported.width - reference.width) < 1, 'export and editor formula widths differ');
  assert(Math.abs(exported.height - reference.height) < 1, 'export and editor formula heights differ');
  assert.equal(await page.locator('.cm-editor').count(), 0, 'preview retains a hidden CodeMirror');
  await frame.getByRole('button', { name: '下一张' }).click();
  assert.equal(await frame.locator('.export-image-slot[data-current]').locator('img').getAttribute('alt'), '乙');
  await page.getByRole('button', { name: '源码' }).click();
  assert.equal(await page.locator('.cm-editor').count(), 1);
  assert.equal(await page.locator('iframe').count(), 0);
  await page.evaluate(() => window.gc?.());
  const source = await page.evaluate(() => ({ heap: performance.memory?.usedJSHeapSize, editors: document.querySelectorAll('.cm-editor').length }));
  await page.evaluate(async () => {
    const oldFrame = document.createElement('iframe');
    oldFrame.id = 'coexistence-baseline';
    oldFrame.sandbox = '';
    oldFrame.srcdoc = window.htmlExportHtml;
    const loaded = new Promise(resolve => oldFrame.addEventListener('load', resolve, { once: true }));
    document.body.append(oldFrame);
    await loaded;
    window.gc?.();
  });
  const coexistence = await page.evaluate(() => ({ heap: performance.memory?.usedJSHeapSize, editors: document.querySelectorAll('.cm-editor').length, frames: document.querySelectorAll('iframe').length }));
  assert.equal(coexistence.editors, 1);
  assert.equal(coexistence.frames, 1);
  await page.evaluate(() => document.querySelector('#coexistence-baseline')?.remove());
  await page.getByRole('button', { name: '预览' }).click();
  await frame.locator('.export-carousel-controls').waitFor();
  await page.evaluate(() => window.gc?.());
  const previewState = await page.evaluate(() => ({ heap: performance.memory?.usedJSHeapSize, editors: document.querySelectorAll('.cm-editor').length }));
  assert.equal(previewState.editors, 0);
  const offlinePath = resolve('.tmp/html-export-offline-qa.html');
  await writeFile(offlinePath, await page.evaluate(() => window.htmlExportHtml));
  const offline = await browser.newPage();
  await offline.goto(pathToFileURL(offlinePath).href);
  await offline.locator('.export-carousel-controls').waitFor();
  const offlineMath = await offline.locator('.export-math .katex-html > .base').evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { width: rect.width, height: rect.height, standards: document.compatMode === 'CSS1Compat', fontsLoaded: document.fonts.check('16px KaTeX_Caligraphic') };
  });
  assert(offlineMath.standards && offlineMath.fontsLoaded);
  assert(Math.abs(offlineMath.width - reference.width) < 1);
  assert(Math.abs(offlineMath.height - reference.height) < 1);
  await offline.getByRole('button', { name: '下一张' }).click();
  assert.equal(await offline.locator('.export-image-slot[data-current] img').getAttribute('alt'), '乙');
  const layout = [];
  for (const width of [818, 360]) {
    await offline.setViewportSize({ width, height: 800 });
    const geometry = await offline.evaluate(() => {
      const article = document.querySelector('#document > article');
      let alert = article.querySelector('.github-alert');
      let wrapper = article.querySelector('.export-table-scroll');
      if (!alert) {
        alert = document.createElement('div'); alert.className = 'github-alert'; alert.textContent = '提示块左边框';
        wrapper = document.createElement('div'); wrapper.className = 'export-table-scroll';
        wrapper.innerHTML = '<table style="width:450px"><tbody><tr><td>宽表格</td><td>内容</td></tr></tbody></table>';
        article.append(alert, wrapper);
      }
      const doc = document.querySelector('#document');
      doc.scrollLeft = 999;
      wrapper.scrollLeft = 999;
      return { viewport: innerWidth, pageWidth: document.documentElement.scrollWidth, documentScrollLeft: doc.scrollLeft,
        alertLeft: alert.getBoundingClientRect().left, documentLeft: doc.getBoundingClientRect().left,
        borderLeft: getComputedStyle(alert).borderLeftWidth, tableWidth: wrapper.querySelector('table').getBoundingClientRect().width,
        tableViewport: wrapper.clientWidth, tableScrollWidth: wrapper.scrollWidth, tableScrollLeft: wrapper.scrollLeft };
    });
    assert.equal(geometry.pageWidth, width);
    assert.equal(geometry.documentScrollLeft, 0, 'whole-document horizontal scroll clips callout borders');
    assert(Math.abs(geometry.alertLeft - geometry.documentLeft) < 1);
    assert.equal(geometry.borderLeft, '1px');
    assert.equal(geometry.tableWidth, 450, 'manual table width must survive narrow windows');
    if (width === 360) assert(geometry.tableScrollWidth > geometry.tableViewport && geometry.tableScrollLeft > 0);
    layout.push(geometry);
  }
  assert.deepEqual(errors, []);
  const result = { passed: true, exported, reference, offlineMath, source, coexistence, preview: previewState, layout, errors };
  await writeFile(resolve('.tmp/html-export-browser-results.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
  await server.close();
}
