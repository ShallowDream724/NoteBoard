/* global window, document, performance, innerWidth, navigator */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build, preview } from 'vite';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const outDir = '.tmp/html-stress-dist';
if (!process.argv.includes('--skip-build')) await build({ configFile: false, worker: { format: 'es' }, build: { target: 'esnext', outDir, emptyOutDir: true, rollupOptions: { input: 'test/browser/htmlStress.html' } }, logLevel: 'error' });
const server = await preview({ configFile: false, build: { outDir }, preview: { host: '127.0.0.1', port: 4189 }, logLevel: 'error' });
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true,
  args: ['--enable-precise-memory-info', '--js-flags=--expose-gc'] });
const browserCdp = await browser.newBrowserCDPSession();
const browserPid = (await browserCdp.send('SystemInfo.getProcessInfo')).processInfo.find(process => process.type === 'browser').id;
const processMemory = () => JSON.parse(execFileSync(process.env.PYTHON || 'D:/anaconda/envs/aider/python.exe', ['-c',
  'import json,psutil,sys; p=psutil.Process(int(sys.argv[1])); m=[{"pid":x.pid,"role":next((a for a in x.cmdline() if a.startswith("--type=")),"browser"),"bytes":x.memory_full_info().uss} for x in [p,*p.children(recursive=True)] if x.is_running()]; print(json.dumps({"privateMiB":round(sum(x["bytes"] for x in m)/1048576,2),"processes":m}))', String(browserPid)], { encoding: 'utf8', windowsHide: true }));
try {
  const errors = [];
  const generator = await browser.newPage();
  generator.on('pageerror', error => errors.push(error.message));
  await generator.goto(`http://127.0.0.1:${server.httpServer.address().port}/test/browser/htmlStress.html`, { waitUntil: 'commit', timeout: 120_000 });
  await generator.waitForFunction(() => window.htmlStressReady || window.htmlStressError, undefined, { timeout: 210_000 });
  const generated = await generator.evaluate(() => ({ html: window.htmlStressHtml, error: window.htmlStressError, elapsedMs: window.htmlStressElapsed }));
  if (generated.error || !generated.html) throw new Error(generated.error || '实际 Worker 未返回 HTML');
  const output = resolve('.tmp/html-stress-real.html');
  await writeFile(output, generated.html);
  await generator.close();

  const offline = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  offline.on('pageerror', error => errors.push(error.message));
  await offline.goto(pathToFileURL(output).href, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await offline.evaluate(() => document.fonts.ready);
  const desktop = await offline.evaluate(() => {
    const formulas = [...document.querySelectorAll('.export-math.display')].map(element => {
      const box = element.getBoundingClientRect(), base = element.querySelector('.katex-html > .base')?.getBoundingClientRect();
      return { rendered: !!base, align: element.getAttribute('data-math-align'), client: element.clientWidth, scroll: element.scrollWidth,
        baseLeft: base?.left, baseRight: base?.right, boxLeft: box.left, boxRight: box.right };
    });
    const table = document.querySelector('.export-table-scroll > table');
    const rows = table.querySelectorAll('tbody > tr');
    return { pageWidth: document.documentElement.scrollWidth, viewport: innerWidth, formulas,
      rows: rows.length, last: rows[rows.length - 1]?.textContent, nodes: document.getElementsByTagName('*').length,
      heap: performance.memory?.usedJSHeapSize, tableWidth: table.getBoundingClientRect().width };
  });
  assert.equal(desktop.rows, 1000);
  assert(desktop.last.includes('END-OF-TABLE-1000'));
  assert.equal(desktop.pageWidth, desktop.viewport);
  assert(desktop.formulas.every(formula => formula.rendered), 'Every stress formula must actually render; a budget fallback is not a successful render');
  for (const formula of desktop.formulas.slice(0, 3)) assert.equal(formula.scroll, formula.client, `${formula.align} ordinary formula has a false scrollbar`);
  assert(desktop.formulas[3].scroll > desktop.formulas[3].client, 'long formula must be locally scrollable');
  assert.equal(await offline.locator('.export-code-language').innerText(), 'Python');
  const anchors = offline.locator('[data-export-annotation="note"]');
  assert.equal(await anchors.count(), 4, 'Inline text, code, formula and table must retain their annotation anchor');
  const panel = offline.getByRole('dialog', { name: '补充说明' });
  await anchors.first().click();
  await panel.waitFor({ state: 'visible' });
  assert((await panel.innerText()).includes('这段说明保留在内容旁边'));
  await offline.screenshot({ path: '.tmp/html-read-view-annotation.png' });
  await offline.keyboard.press('Escape');
  await panel.waitFor({ state: 'hidden' });
  await offline.screenshot({ path: '.tmp/html-read-view-code.png' });
  await anchors.first().focus();
  await offline.keyboard.press('Enter');
  await panel.getByRole('button', { name: '关闭补充说明' }).click();
  await panel.waitFor({ state: 'hidden' });
  for (let count = 0; count < 8; count++) { await anchors.nth(1).click(); await panel.waitFor({ state: 'visible' }); await offline.keyboard.press('Escape'); }
  assert.equal(await offline.locator('[data-annotation-body="note"]').count(), 1, 'Opening annotations must move one body rather than duplicate it');
  await offline.getByRole('button', { name: '折叠代码块' }).click();
  assert.equal(await offline.locator('.export-code-block pre').isVisible(), false);
  await offline.getByRole('button', { name: '展开代码块' }).click();
  await offline.getByRole('button', { name: '自动换行' }).click();
  assert.equal(await offline.getByRole('button', { name: '自动换行' }).getAttribute('aria-pressed'), 'true');
  await offline.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { value: undefined }); document.execCommand = () => { window.copiedCode = document.activeElement.value; return true; }; });
  await offline.getByRole('button', { name: '复制代码内容' }).click();
  assert.equal(await offline.evaluate(() => window.copiedCode), 'print("<tag>")\n  # keep spaces');
  await offline.emulateMedia({ media: 'print' });
  assert.equal(await offline.locator('[data-annotation-store]').isVisible(), true, 'Printing a standalone page must retain its notes');
  await offline.emulateMedia({ media: 'screen' });
  await offline.locator('.export-math.display').nth(3).scrollIntoViewIfNeeded();
  await offline.screenshot({ path: '.tmp/html-stress-long-formula.png' });
  await offline.locator('.export-table-scroll tbody tr').last().scrollIntoViewIfNeeded();
  await offline.screenshot({ path: '.tmp/html-stress-last-row.png' });

  await offline.setViewportSize({ width: 360, height: 800 });
  const narrow = await offline.evaluate(() => {
    const formula = document.querySelectorAll('.export-math.display')[3];
    const table = document.querySelector('.export-table-scroll');
    formula.scrollLeft = formula.scrollWidth;
    table.scrollLeft = table.scrollWidth;
    return { pageWidth: document.documentElement.scrollWidth, viewport: innerWidth, formulaClient: formula.clientWidth,
      formulaScroll: formula.scrollWidth, formulaOffset: formula.scrollLeft, tableClient: table.clientWidth,
      tableScroll: table.scrollWidth, tableOffset: table.scrollLeft, rows: table.querySelectorAll('tbody > tr').length };
  });
  assert.equal(narrow.pageWidth, narrow.viewport);
  assert(narrow.formulaScroll > narrow.formulaClient && narrow.formulaOffset > 0);
  assert(narrow.tableScroll > narrow.tableClient && narrow.tableOffset > 0);
  assert.equal(narrow.rows, 1000);
  await offline.evaluate(() => { const table = document.querySelector('.export-table-scroll'); table.scrollLeft = table.querySelector('tbody tr:last-child td:last-child').offsetLeft; });
  await offline.screenshot({ path: '.tmp/html-stress-narrow.png' });
  await offline.close();

  const host = await browser.newPage();
  await host.goto('about:blank');
  const cdp = await host.context().newCDPSession(host);
  await cdp.send('Performance.enable');
  await cdp.send('HeapProfiler.enable');
  const lifecycle = [];
  for (let index = 0; index < 8; index++) {
    await host.evaluate(async html => {
      const frame = document.createElement('iframe');
      frame.sandbox = 'allow-scripts';
      frame.srcdoc = html;
      const loaded = new Promise(resolve => frame.addEventListener('load', resolve, { once: true }));
      document.body.append(frame);
      await loaded;
    }, generated.html);
    const frame = host.frames()[1];
    const mountedRows = await frame.evaluate(() => document.querySelectorAll('.export-table-scroll tbody > tr').length);
    assert.equal(mountedRows, 1000);
    await host.evaluate(() => document.querySelector('iframe').remove());
    await cdp.send('HeapProfiler.collectGarbage');
    await host.waitForTimeout(500);
    const dom = await cdp.send('Memory.getDOMCounters');
    const metrics = await cdp.send('Performance.getMetrics');
    lifecycle.push({ cycle: index + 1, documents: dom.documents, nodes: dom.nodes, listeners: dom.jsEventListeners,
      heap: metrics.metrics.find(item => item.name === 'JSHeapUsedSize')?.value, ...processMemory() });
  }
  await host.waitForTimeout(35_000);
  const settledMemory = processMemory();
  await host.close();
  await writeFile(resolve('.tmp/html-stress-memory.json'), JSON.stringify({ lifecycle, settledMemory }, null, 2));
  assert(lifecycle.at(-1).documents <= lifecycle[1].documents + 1);
  assert(lifecycle.at(-1).nodes <= lifecycle[1].nodes + 20);
  assert(lifecycle.at(-1).listeners <= lifecycle[1].listeners + 5);
  assert(lifecycle.at(-1).heap <= lifecycle[1].heap + 2_000_000);
  assert(settledMemory.privateMiB <= lifecycle[1].privateMiB + 64, 'Browser process memory must return near its warmed baseline');
  assert.deepEqual(errors, []);
  const result = { passed: true, output, bytes: Buffer.byteLength(generated.html), exportMs: generated.elapsedMs,
    desktop, narrow, lifecycle, settledMemory, errors };
  await writeFile(resolve('.tmp/html-stress-results.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await browser.close(); await new Promise(resolve => server.httpServer.close(resolve)); }
