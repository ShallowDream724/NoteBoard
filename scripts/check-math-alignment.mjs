/* global window, document, requestAnimationFrame, getComputedStyle, innerWidth, MouseEvent */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { build, preview } from 'vite';
import react from '@vitejs/plugin-react';

// Keep the browser tooling outside the shipped application. CI/local runtimes
// can supply an installed Playwright module without a machine-specific path.
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const outDir = '.tmp/math-alignment-dist';
await build({ configFile: false, plugins: [react()], worker: { format: 'es' }, build: { outDir, emptyOutDir: true, rollupOptions: { input: 'test/browser/mathAlignment.html' } }, logLevel: 'error' });
const server = await preview({ configFile: false, build: { outDir }, preview: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
const results = [];
let standaloneMathFonts = [];
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errors = [];
  page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/test/browser/mathAlignment.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.mathAlignmentQA && document.querySelector('.math-node-display .katex-html'));
  await page.evaluate(() => document.fonts.ready);
  const frame = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const bounds = async (target, glyphs) => page.evaluate(({ target, glyphs }) => {
    const host = document.querySelector(target), style = getComputedStyle(host), box = host.getBoundingClientRect();
    const parts = [...host.querySelectorAll(glyphs)].map(element => element.getBoundingClientRect()).filter(rect => rect.width && rect.height);
    return { left: Math.min(...parts.map(rect => rect.left)), right: Math.max(...parts.map(rect => rect.right)),
      start: box.left + parseFloat(style.paddingLeft), end: box.right - parseFloat(style.paddingRight) };
  }, { target, glyphs });
  const check = (label, align, b) => {
    const expected = align === 'left' ? b.start : align === 'right' ? b.end : (b.start + b.end) / 2;
    const actual = align === 'left' ? b.left : align === 'right' ? b.right : (b.left + b.right) / 2;
    assert(Math.abs(actual - expected) < 3, `${label} ${align}: actual ${actual}, expected ${expected}`);
    results.push({ label, align, ...b });
  };
  const glyphs = '.katex-display > .katex > .katex-html > .base';
  const formula = await page.locator('.math-node-display .katex-display').elementHandle();
  const inlineBefore = await page.locator('.math-node:not(.math-node-display)').boundingBox();
  for (const align of ['left', 'center', 'right']) {
    assert.equal(await page.evaluate(value => window.mathAlignmentQA.align(value), align), align);
    await frame();
    check('editor', align, await bounds('.math-node-display', glyphs));
    assert(await formula.evaluate(element => element === document.querySelector('.math-node-display .katex-display')), 'Alignment must reuse rendered math');
    const exported = await page.evaluate(() => window.mathAlignmentQA.export());
    const output = await browser.newPage({ viewport: { width: 1000, height: 800 } });
    for (const mode of ['print', 'standalone']) {
      await output.setContent(mode === 'print' ? `<style>${exported.css}</style><style>:root{--export-font:18px;--export-line:1.6;--export-width:800px}body{width:800px;margin:30px}</style>${exported.html}` : exported.standalone);
      await output.emulateMedia({ media: 'print' });
      const b = await output.locator('.export-math.display').evaluate((host, mode) => {
        const box = host.getBoundingClientRect();
        const parts = [...host.querySelectorAll(mode === 'standalone' ? 'math mi,math mn,math mo' : '.katex-display > .katex > .katex-html > .base')].map(el => el.getBoundingClientRect()).filter(b => b.width && b.height);
        return { start: box.left, end: box.right, left: Math.min(...parts.map(b => b.left)), right: Math.max(...parts.map(b => b.right)) };
      }, mode);
      check(mode, align, b);
      const callouts = await output.locator('.github-alert').evaluateAll(elements => elements.map(el => ({
        position: getComputedStyle(el).position, border: getComputedStyle(el).borderTopWidth,
        background: getComputedStyle(el).backgroundColor, icon: getComputedStyle(el.querySelector('.callout-icon')).position,
      })));
      assert.equal(callouts.length, 6);
      for (const style of callouts) {
        assert.equal(style.position, 'relative'); assert.equal(style.border, '1px'); assert.equal(style.icon, 'absolute');
        assert.notEqual(style.background, 'rgba(0, 0, 0, 0)', `${mode}: callout background missing`);
      }
      if (mode === 'standalone' && align === 'left') {
        const devtools = await output.context().newCDPSession(output);
        await devtools.send('DOM.enable'); await devtools.send('CSS.enable');
        const { root } = await devtools.send('DOM.getDocument');
        const { nodeId } = await devtools.send('DOM.querySelector', { nodeId: root.nodeId, selector: '.export-math math mi' });
        standaloneMathFonts = (await devtools.send('CSS.getPlatformFontsForNode', { nodeId })).fonts.map(font => font.familyName);
        await devtools.detach();
        await output.emulateMedia({ media: 'screen' });
        const carousel = output.locator('.export-image-carousel');
        assert(await carousel.getByRole('button', { name: '上一张', exact: true }).isDisabled());
        await carousel.getByRole('button', { name: '下一张', exact: true }).click();
        assert.equal(await carousel.locator('[aria-current=true]').getAttribute('aria-label'), '第 2 张');
        await carousel.locator('[data-current] img').click();
        assert(await output.getByRole('dialog', { name: '图片预览' }).isVisible());
        await output.keyboard.press('Escape');
        assert.equal(await output.locator('dialog[open]').count(), 0);
        assert.equal(await output.locator('.export-page-title,.export-page-icon').count(), 0);
        const [savedCopy] = await Promise.all([output.waitForEvent('download'), output.getByRole('button', { name: '保存副本' }).click()]);
        assert(savedCopy.suggestedFilename().endsWith('.html'));
        assert((await readFile(await savedCopy.path(), 'utf8')).includes('Callout body'));
        await output.setViewportSize({ width: 390, height: 844 });
        assert(await output.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await output.screenshot({ path: '.tmp/html-export-mobile.png', fullPage: true });
        await output.setViewportSize({ width: 1000, height: 800 });
        await output.screenshot({ path: '.tmp/html-export-desktop.png', fullPage: true });
        await output.emulateMedia({ media: 'print' });
        assert.equal(await carousel.locator('.export-image-slot:visible').count(), 2);
        assert.equal(await output.locator('.export-page-actions:visible').count(), 0);
      }
    }
    await output.close();
  }
  assert.deepEqual(await page.locator('.math-node:not(.math-node-display)').boundingBox(), inlineBefore, 'Block alignment must not move inline math');
  await page.evaluate(() => window.mathAlignmentQA.undo()); await frame();
  check('undo', 'center', await bounds('.math-node-display', glyphs));
  await page.evaluate(() => window.mathAlignmentQA.align('right')); await frame();
  await page.evaluate(() => window.mathAlignmentQA.reload()); await frame();
  await page.waitForFunction(() => document.querySelector('.math-node-display .katex-html'));
  check('reload', 'right', await bounds('.math-node-display', glyphs));
  await page.evaluate(() => window.mathAlignmentQA.matrix());
  await page.waitForSelector('.nb-matrix-view');
  for (const align of ['left', 'center', 'right']) {
    await page.evaluate(value => window.mathAlignmentQA.align(value), align); await frame();
    check('virtual matrix', align, await bounds('.math-node-display', '.nb-matrix-view'));
  }
  await page.evaluate(() => window.mathAlignmentQA.prepareTyping()); await frame();
  await page.keyboard.type(String.raw`,$wos$:,$\text{aaa}$,`);
  assert.deepEqual(await page.evaluate(() => window.mathAlignmentQA.formulas()), ['a', 'wos', String.raw`\text{aaa}`]);
  await page.evaluate(() => window.mathAlignmentQA.prepareHistory());
  await page.locator('code .hljs-keyword').first().waitFor();
  await page.evaluate(() => window.mathAlignmentQA.deleteFormula());
  const code = await page.locator('code').elementHandle();
  assert(await page.locator('code .hljs-keyword').count() > 0);
  await page.evaluate(() => window.mathAlignmentQA.restoreFormula());
  assert(await code.evaluate(element => element === document.querySelector('code')), 'Undo must retain the unaffected code view');
  assert(await page.locator('code .hljs-keyword').count() > 0, 'Undo must retain already highlighted code immediately');
  await page.evaluate(() => window.mathAlignmentQA.prepareInlineEntry());
  await page.keyboard.type('abc', { delay: 15 });
  const source = page.getByRole('textbox', { name: '行内公式源码' });
  assert.equal(await source.inputValue(), 'abc');
  assert.deepEqual(await page.evaluate(() => window.mathAlignmentQA.formulas()), ['abc']);
  assert(await source.evaluate(element => document.activeElement === element));
  await page.keyboard.press('ArrowRight');
  await source.waitFor({ state: 'detached' });
  await page.keyboard.type('outside');
  assert.deepEqual(await page.evaluate(() => window.mathAlignmentQA.formulas()), ['abc']);
  assert.equal(await page.evaluate(() => window.mathAlignmentQA.text()), 'Before outside after');
  await page.evaluate(() => window.mathAlignmentQA.mountSharedHistory());
  const shared = page.locator('[data-math-shared-history]');
  await shared.locator('.ProseMirror').waitFor();
  await shared.locator('.ProseMirror').focus();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' text');
  assert.equal((await page.evaluate(() => window.mathAlignmentQA.sharedState())).text, 'Before text');
  await page.evaluate(() => window.mathAlignmentQA.insertSharedBlock());
  const sharedSource = shared.getByRole('textbox', { name: '块公式源码' });
  await sharedSource.waitFor();
  await sharedSource.focus();
  const sourceElement = await sharedSource.elementHandle();
  await page.keyboard.type('a');
  await page.waitForTimeout(550);
  await page.keyboard.type('b');
  assert.deepEqual((await page.evaluate(() => window.mathAlignmentQA.sharedState())).formulas, ['ab']);
  for (const expected of ['a', '']) {
    await page.keyboard.press('Control+z');
    assert.deepEqual((await page.evaluate(() => window.mathAlignmentQA.sharedState())).formulas, [expected]);
    assert(await sourceElement.evaluate(element => element.isConnected && document.activeElement === element), 'Source undo must retain the textarea and focus');
    assert.equal(await sourceElement.evaluate(element => element.selectionStart), expected.length);
  }
  await page.keyboard.press('Control+z');
  assert.deepEqual((await page.evaluate(() => window.mathAlignmentQA.sharedState())).formulas, []);
  assert.equal(await sharedSource.count(), 0);
  await page.keyboard.press('Control+z');
  assert.equal((await page.evaluate(() => window.mathAlignmentQA.sharedState())).text, 'Before');
  for (let step = 0; step < 4; step++) await page.keyboard.press('Control+y');
  assert.deepEqual((await page.evaluate(() => window.mathAlignmentQA.sharedState())).formulas, ['ab']);
  assert.equal((await page.evaluate(() => window.mathAlignmentQA.sharedState())).text, 'Before text');
  await page.evaluate(() => window.mathAlignmentQA.prepareSharedInline());
  await shared.locator('.math-node:not(.math-node-display)').waitFor();
  await shared.locator('.math-node:not(.math-node-display)').evaluate(element => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  const inlineSource = shared.getByRole('textbox', { name: '行内公式源码' });
  await inlineSource.waitFor();
  await inlineSource.focus();
  const inlineElement = await inlineSource.elementHandle();
  await page.keyboard.type('a');
  await page.waitForTimeout(550);
  await page.keyboard.type('b');
  for (const expected of ['a', '']) {
    await page.keyboard.press('Control+z');
    assert.deepEqual((await page.evaluate(() => window.mathAlignmentQA.sharedState())).formulas, [expected]);
    assert(await inlineElement.evaluate(element => element.isConnected && document.activeElement === element), 'Inline source undo must retain the textarea and focus');
    assert.equal(await inlineElement.evaluate(element => element.selectionStart), expected.length);
  }
  for (const expected of ['a', 'ab']) {
    await page.keyboard.press('Control+y');
    assert.deepEqual((await page.evaluate(() => window.mathAlignmentQA.sharedState())).formulas, [expected]);
    assert(await inlineElement.evaluate(element => element.isConnected && document.activeElement === element), 'Inline source redo must retain the textarea and focus');
    assert.equal(await inlineElement.evaluate(element => element.selectionStart), expected.length);
  }
  assert.equal((await page.evaluate(() => window.mathAlignmentQA.sharedState())).text, 'Before  After');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, checks: results.length, standaloneMathFonts, results }, null, 2));
} finally { await browser.close(); await new Promise(resolve => server.httpServer.close(resolve)); }
