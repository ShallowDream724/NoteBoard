/* global window, document, requestAnimationFrame, getComputedStyle, InputEvent, CompositionEvent, KeyboardEvent */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build, preview } from 'vite';
import react from '@vitejs/plugin-react';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const outDir = '.tmp/math-inline-editing-dist';
if (!process.argv.includes('--skip-build')) await build({ configFile: false, plugins: [react()], worker: { format: 'es' }, build: { outDir, emptyOutDir: true, rollupOptions: { input: 'test/browser/mathInlineEditing.html' } }, logLevel: 'error' });
const server = await preview({ configFile: false, build: { outDir }, preview: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
const results = [];
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 740 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/test/browser/mathInlineEditing.html`);
  const frame = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const paragraph = text => ({ type: 'paragraph', content: [{ type: 'text', text }] });
  const inline = (latex = 'a+b', before = 'Before ', after = ' after') => ({ type: 'paragraph', content: [
    { type: 'text', text: before }, { type: 'mathInline', attrs: { latex } }, { type: 'text', text: after },
  ] });
  const mount = async content => {
    await page.evaluate(content => window.mathInlineEditingQA.mount(content), content);
    await page.waitForFunction(() => window.mathInlineEditingQA.ready()); await frame();
  };
  const state = () => page.evaluate(() => window.mathInlineEditingQA.state());
  const source = page.getByRole('textbox', { name: '行内公式源码' });
  const open = async () => {
    await page.locator('.math-node').click(); await source.waitFor(); await frame();
  };
  await mount([inline(), paragraph('The following paragraph must stay in place.')]);
  await page.locator('.math-node .katex-html').waitFor();
  const rendered = await page.locator('.math-node-preview .math-preview').elementHandle();
  const before = await page.locator('.ProseMirror > p').first().boundingBox();
  const nextBefore = await page.locator('.ProseMirror > p').nth(1).boundingBox();
  await open();
  const compact = await source.evaluate(element => {
    const b = element.getBoundingClientRect(), p = element.closest('p').getBoundingClientRect();
    return { width: b.width, height: b.height, paragraphHeight: p.height, top: b.top, paragraphTop: p.top };
  });
  assert(compact.width < 100 && compact.height < 35, JSON.stringify(compact));
  assert.equal(await source.evaluate(element => getComputedStyle(element).outlineStyle), 'none', 'Source must not acquire paragraph-fragment focus boxes');
  assert(Math.abs(compact.paragraphHeight - before.height) < 3, 'Inline source must retain the paragraph line height');
  assert(Math.abs((await page.locator('.ProseMirror > p').nth(1).boundingBox()).y - nextBefore.y) < 3, 'Preview must not push following prose down');
  assert(await rendered.evaluate(element => element === document.querySelector('.math-node-preview .math-preview')), 'Entering must reuse the rendered preview');
  assert.equal(await page.locator('.ProseMirror > .embedded-source-editor').count(), 0);
  results.push({ compact });
  await page.screenshot({ path: '.tmp/math-inline-compact.png' });
  await page.locator('.ProseMirror').evaluate(element => { element.style.fontSize = '26px'; }); await frame();
  assert.equal(await source.evaluate(element => getComputedStyle(element).fontSize), '24.7px');
  await page.evaluate(() => { document.documentElement.dataset.theme = 'mo-ye'; }); await frame();
  await page.screenshot({ path: '.tmp/math-inline-dark-large.png' });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'chen-guang'; });
  await page.locator('.ProseMirror').evaluate(element => { element.style.fontSize = ''; }); await frame();

  if (process.argv.includes('--style-only')) {
    for (const [theme, delimiter, closing] of [['chen-guang', '$', '$'], ['hu-po', '\\(', '\\)'], ['mo-ye', '$', '$']]) {
      const formula = inline(String.raw`\frac{a+b}{c}`, '正文中的 ', ' 继续这句话。');
      formula.content[1].attrs.delimiter = delimiter;
      await mount([formula, paragraph('下一行正文保持原位，公式预览贴近源码下方。')]);
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      await page.locator('.ProseMirror').evaluate(element => { element.style.fontSize = '26px'; });
      await page.locator('.math-node .katex-html').waitFor(); await open();
      assert.deepEqual(await page.locator('.formula-source-delimiter').allTextContents(), [delimiter, closing]);
      assert.equal(await source.textContent(), String.raw`\frac{a+b}{c}`);
      const colors = await source.evaluate(element => {
        const wrapper = element.closest('.formula-source-inline'), opening = wrapper.querySelector('.formula-source-delimiter'), closing = wrapper.querySelector('.formula-source-delimiter:last-child');
        const input = element.getBoundingClientRect(), start = opening.getBoundingClientRect(), end = closing.getBoundingClientRect();
        return { source: getComputedStyle(element).color, delimiter: getComputedStyle(opening).color,
          openingRight: start.right, sourceLeft: input.left, sourceRight: input.right, closingLeft: end.left };
      });
      assert.notEqual(colors.source, colors.delimiter);
      assert(colors.openingRight <= colors.sourceLeft + 1 && colors.closingLeft >= colors.sourceRight - 1, JSON.stringify(colors));
      await page.screenshot({ path: `.tmp/math-inline-${theme}-delimiters.png` });
      results.push({ theme, delimiter, colors });
    }
    for (const [text, position, delimiters] of [['Before $$ after', 9, ['$', '$']], [String.raw`Before \(\) after`, 10, ['\\(', '\\)']]]) {
      await mount([paragraph(text)]); await page.evaluate(position => window.mathInlineEditingQA.focus(position), position);
      await page.keyboard.type('abc', { delay: 10 });
      assert.equal(await source.textContent(), 'abc'); assert.deepEqual((await state()).formulas, ['abc']);
      assert.deepEqual(await page.locator('.formula-source-delimiter').allTextContents(), delimiters);
      await page.keyboard.press('ArrowRight'); await page.keyboard.type('tail');
      assert.equal((await state()).text, 'Before tail after');
    }
  } else {
  // Native preedit stays in the same inline source, commits once, and shares document history.
  const input = await source.elementHandle();
  await page.evaluate(() => window.mathInlineEditingQA.watchUpdates());
  await source.evaluate(element => {
    element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    element.textContent = 'a+bzhong';
    element.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true, inputType: 'insertCompositionText' }));
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  assert.deepEqual((await state()).formulas, ['a+b']); assert.equal((await state()).updates, 0);
  assert(await input.evaluate(element => element.isConnected && document.activeElement === element));
  await source.evaluate(element => {
    element.textContent = 'a+b中，';
    element.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true, inputType: 'insertCompositionText' }));
    element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '中，' }));
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
  });
  assert.deepEqual((await state()).formulas, ['a+b中，']); assert.equal((await state()).updates, 1);
  await page.keyboard.press('Control+z');
  assert.deepEqual((await state()).formulas, ['a+b']); assert.equal(await source.textContent(), 'a+b');
  await page.keyboard.press('Control+y');
  assert.deepEqual((await state()).formulas, ['a+b中，']);
  assert(await input.evaluate(element => element.isConnected && document.activeElement === element));
  await page.keyboard.press('End');
  assert(await source.evaluate(element => document.activeElement === element), 'End must stay inside inline source');
  await page.keyboard.press('ArrowRight');
  await source.waitFor({ state: 'detached' }); await page.keyboard.type('outside');
  assert.equal((await state()).text, 'Before outside afterThe following paragraph must stay in place.');
  assert.equal(await page.locator('.math-node-preview').evaluate(element => getComputedStyle(element).position), 'static');

  await mount([paragraph('Before $$ after')]); await page.evaluate(() => window.mathInlineEditingQA.focus(9));
  await page.keyboard.type('abc', { delay: 10 });
  assert.equal(await source.textContent(), 'abc'); assert.deepEqual((await state()).formulas, ['abc']);
  await page.keyboard.press('ArrowRight'); await page.keyboard.type('tail');
  assert.equal((await state()).text, 'Before tail after');

  for (const entry of ['slash', 'toolbar']) {
    await mount([paragraph('Before ')]); await page.evaluate(() => window.mathInlineEditingQA.focus(8));
    if (entry === 'slash') {
      await page.keyboard.type('/math');
      await page.getByRole('button', { name: /^行内公式 \(/ }).click();
    } else await page.evaluate(() => window.mathInlineEditingQA.insertInline());
    await source.waitFor(); await frame();
    assert.equal(await source.textContent(), '');
    assert(await source.evaluate(element => document.activeElement === element), `${entry} must focus blank inline source`);
    await page.keyboard.type('abc'); assert.deepEqual((await state()).formulas, ['abc']);
    await page.keyboard.press('Control+z'); assert.deepEqual((await state()).formulas, ['']);
    await page.keyboard.press('Control+z'); assert.deepEqual((await state()).formulas, []);
    assert.equal((await state()).text, 'Before ');
    await page.keyboard.press('Control+y'); assert.deepEqual((await state()).formulas, ['']);
    assert.equal(await source.count(), 0, 'History replay must not reopen an empty inline formula');
    await page.keyboard.press('Control+y'); assert.deepEqual((await state()).formulas, ['abc']);
    assert.equal(await page.locator('[role="listbox"]').count(), 0);
    results.push({ entry, blankAndFocused: true, history: true });
  }

  // Real Chromium preedit in the inline host preserves the first character and
  // grows in the paragraph rather than scrolling inside a small input.
  await mount([inline('你好', '正文 ', ' 后文')]); await open();
  const cdp = await page.context().newCDPSession(page);
  await page.keyboard.press('End');
  for (const text of ['z', 'zhong', "zhong'wen"]) {
    await cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length });
    assert.deepEqual((await state()).formulas, ['你好']);
  }
  await cdp.send('Input.insertText', { text: '中文，' });
  await page.waitForFunction(() => window.mathInlineEditingQA.state().formulas[0] === '你好中文，');
  assert.equal(await source.textContent(), '你好中文，');
  await page.keyboard.press('Control+a');
  assert.equal(await page.evaluate(() => window.getSelection().toString()), '你好中文，');
  await page.keyboard.press('End');
  const extended = '你好中文，' + 'a'.repeat(200);
  await page.keyboard.type('a'.repeat(200)); await frame();
  assert.equal(await source.textContent(), extended);
  assert.deepEqual((await state()).formulas, [extended]);
  const flowing = await source.evaluate(element => {
    const rects = [...element.getClientRects()];
    const range = document.createRange(); range.setStart(element.firstChild, 0); range.setEnd(element.firstChild, 1);
    const first = range.getBoundingClientRect(), paragraph = element.closest('p').getBoundingClientRect();
    return { fragments: rects.length, overflow: getComputedStyle(element).overflow, scrollTop: element.scrollTop, scrollLeft: element.scrollLeft,
      firstLeft: first.left, firstTop: first.top, paragraphLeft: paragraph.left, paragraphTop: paragraph.top };
  });
  assert(flowing.fragments > 1 && flowing.overflow === 'visible' && flowing.scrollTop === 0 && flowing.scrollLeft === 0, JSON.stringify(flowing));
  assert(flowing.firstLeft >= flowing.paragraphLeft && flowing.firstTop >= flowing.paragraphTop, JSON.stringify(flowing));
  await page.screenshot({ path: '.tmp/math-inline-flowing.png' });
  results.push({ nativeComposition: true, flowing });
  await cdp.detach();

  // Long source flows at the paragraph width; the preview stays inside the scroll viewport.
  await mount([inline(String.raw`\frac{a+b+c+d+e+f+g+h+i+j+k+l+m+n+o+p+q+r+s+t}{1+\sqrt{x^2+y^2}}`, 'A sentence close to the line boundary with preceding words. '), ...Array.from({ length: 20 }, (_, i) => paragraph(`Following line ${i}`))]);
  await open();
  const long = await source.evaluate(element => {
    const b = element.getBoundingClientRect(), scroller = element.closest('[data-editor-scroll]').getBoundingClientRect();
    const p = element.closest('.math-node').querySelector('.math-node-preview').getBoundingClientRect();
    return { source: { left: b.left, right: b.right, height: b.height }, preview: { left: p.left, right: p.right }, viewport: { left: scroller.left, right: scroller.right } };
  });
  assert(long.source.right <= long.viewport.right + 1 && long.source.height < 135, JSON.stringify(long));
  assert(long.preview.left >= long.viewport.left && long.preview.right <= long.viewport.right + 1, JSON.stringify(long));
  results.push({ long });
  await page.keyboard.press('Escape');

  await mount([...Array.from({ length: 24 }, (_, i) => paragraph(`Leading line ${i}`)), inline('x^2+y^2'), ...Array.from({ length: 5 }, (_, i) => paragraph(`Trailing line ${i}`))]);
  await open();
  await page.locator('[data-editor-scroll]').evaluate(element => {
    element.scrollTop += element.querySelector('.math-node').getBoundingClientRect().bottom - element.getBoundingClientRect().bottom + 12;
  }); await frame(); await frame();
  const edge = await page.locator('.math-node').evaluate(element => {
    const source = element.getBoundingClientRect(), preview = element.querySelector('.math-node-preview').getBoundingClientRect(), viewport = element.closest('[data-editor-scroll]').getBoundingClientRect();
    return { sourceTop: source.top, sourceBottom: source.bottom, previewTop: preview.top, previewBottom: preview.bottom, viewportTop: viewport.top, viewportBottom: viewport.bottom };
  });
  assert(edge.previewTop >= edge.viewportTop && edge.previewBottom <= edge.viewportBottom, JSON.stringify(edge));
  assert(edge.previewBottom < edge.sourceTop, `Preview should flip above near the bottom: ${JSON.stringify(edge)}`);
  results.push({ edge });
  await page.screenshot({ path: '.tmp/math-inline-edge.png' });
  await page.setViewportSize({ width: 420, height: 740 }); await frame(); await frame();
  const narrow = await page.locator('.math-node-preview').boundingBox();
  assert(narrow.x >= 0 && narrow.x + narrow.width <= 420, JSON.stringify(narrow));
  await page.setViewportSize({ width: 1000, height: 740 });

  await mount([{ type: 'mathBlock', attrs: { latex: 'E=mc^2' } }, paragraph('After block')]);
  await page.locator('.math-node').click(); await page.getByRole('textbox', { name: '块公式源码' }).waitFor();
  await page.locator('.math-node .katex-html').waitFor(); await frame();
  const gap = await page.evaluate(() => {
    const hint = document.querySelector('.formula-source-hint').getBoundingClientRect(), preview = document.querySelector('.math-node-preview .katex-display').getBoundingClientRect();
    return preview.top - hint.bottom;
  });
  assert(gap >= 0 && gap <= 6, `Block preview gap ${gap}`); results.push({ blockHintGap: gap });
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, results }, null, 2));
} finally { await browser.close(); await new Promise(resolve => server.httpServer.close(resolve)); }
