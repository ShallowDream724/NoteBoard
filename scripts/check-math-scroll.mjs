/* global window, document */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build, preview } from 'vite';
import react from '@vitejs/plugin-react';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const outDir = '.tmp/math-scroll-dist';
await build({ configFile: false, plugins: [react()], worker: { format: 'es' }, build: { outDir, emptyOutDir: true, rollupOptions: { input: 'test/browser/mathAlignment.html' } }, logLevel: 'error' });
const server = await preview({ configFile: false, build: { outDir }, preview: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/test/browser/mathAlignment.html`);
  await page.waitForFunction(() => window.mathAlignmentQA);
  await page.evaluate(() => window.mathAlignmentQA.mountSharedHistory());
  const shared = page.locator('[data-math-shared-history]');
  await shared.locator('.ProseMirror').waitFor();
  await page.evaluate(() => window.mathAlignmentQA.prepareSharedScroll(true));
  const source = shared.getByRole('textbox', { name: '块公式源码' });
  await source.waitFor();
  await page.keyboard.press('End');
  await page.keyboard.type('b');
  await page.waitForTimeout(550);
  await page.keyboard.type('c');
  await page.keyboard.press('Control+z');
  assert.equal(await source.inputValue(), 'b');
  const scroll = shared.locator('[data-editor-scroll]');
  const state = () => scroll.evaluate(el => ({ top: el.scrollTop, height: el.clientHeight, total: el.scrollHeight, focus: document.activeElement?.tagName }));
  for (const action of ['Control+z', 'Control+z', 'Control+y', 'Control+y']) {
    await scroll.evaluate(el => { el.scrollTop = 0; });
    if (await source.count()) await source.hover();
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(1000);
    assert((await state()).top > 200, 'Wheel over source after formula undo must scroll the document');
    await page.keyboard.press(action);
    await page.waitForTimeout(150);
  }
  await shared.locator('.ProseMirror > p').first().click();
  await scroll.evaluate(el => { el.scrollTop = 0; });
  for (let step = 0; step < 15; step++) await page.mouse.wheel(0, 8);
  await page.waitForTimeout(300);
  assert((await state()).top > 60, 'Small touchpad-like wheel deltas after leaving source must scroll');
  assert.deepEqual(errors, []);
  console.log('Math source undo/redo, creation removal and document scrolling passed');
} finally { await browser.close(); await new Promise(resolve => server.httpServer.close(resolve)); }
