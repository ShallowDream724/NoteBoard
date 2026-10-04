/* global requestAnimationFrame */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import { preview } from 'vite';
import { installBrowserNativeShell } from './browser-native-shell.mjs';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const server = await preview({ configFile: false, build: { outDir: 'dist' }, preview: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
const cdp = await page.context().newCDPSession(page), report = { cycles: [], errors: [] };
page.on('pageerror', error => report.errors.push(error.message));
await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
await installBrowserNativeShell(page);
try {
  await page.goto(origin);
  const home = page.getByRole('button', { name: '动手试一试', exact: true });
  for (let cycle = 0; cycle < 8; cycle++) {
    await home.click();
    await page.getByRole('complementary', { name: '互动练习', exact: true }).waitFor();
    await page.locator('.nb-prose.ProseMirror:visible').waitFor();
    await page.getByRole('button', { name: '关闭 公园观察练习.nb', exact: true }).click();
    const discard = page.getByRole('button', { name: '不保存', exact: true });
    await home.or(discard).first().waitFor();
    if (await discard.isVisible()) await discard.click();
    await home.waitFor();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.locator('.ProseMirror,.nb-practice-panel').count(), 0, 'Closing the tab releases the editor and practice panel');
    await cdp.send('HeapProfiler.collectGarbage');
    const heap = await cdp.send('Runtime.getHeapUsage');
    report.cycles.push({ cycle, heapMiB: heap.usedSize / 1048576, ...await cdp.send('Memory.getDOMCounters') });
  }
  const first = report.cycles[1], last = report.cycles.at(-1);
  assert(last.heapMiB - first.heapMiB < 8, 'Repeated practice sessions must not retain document-sized heaps');
  assert(last.nodes - first.nodes < 200, 'Closed practice sessions must not retain editor DOM');
  assert(last.jsEventListeners - first.jsEventListeners < 50, 'Practice observers and editor event listeners must be released');
  assert.deepEqual(report.errors, []);
  console.log(JSON.stringify(report));
} finally {
  await fs.mkdir('.tmp/interactive-practice', { recursive: true });
  await fs.writeFile('.tmp/interactive-practice/memory.json', JSON.stringify(report, null, 2));
  await browser.close(); await server.close();
}
