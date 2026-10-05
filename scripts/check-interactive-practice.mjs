/* global window, document, NodeFilter, requestAnimationFrame */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import { preview } from 'vite';
import { installBrowserNativeShell } from './browser-native-shell.mjs';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const cdpUrl = process.env.NOTEBOARD_TEST_CDP;
const minimum = process.argv.includes('--minimum');
const compact = minimum || process.argv.includes('--compact');
const directory = `.tmp/guided-showcase${cdpUrl ? minimum ? '/native-minimum' : compact ? '/native-compact' : '/native' : minimum ? '/minimum' : compact ? '/compact' : ''}`; await fs.mkdir(directory, { recursive: true });
const smallViewport = { width: minimum ? 680 : 960, height: 540 };
const server = await preview({ configFile: false, build: { outDir: 'dist' }, preview: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = cdpUrl ? await chromium.connectOverCDP(cdpUrl) : await chromium.launch({ channel: 'msedge', headless: true });
const report = { steps: [], completions: [], layouts: [], errors: [] }; let page;
const frames = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
try {
  page = cdpUrl ? browser.contexts()[0].pages()[0] : await browser.newPage(compact
    ? { viewport: smallViewport, deviceScaleFactor: 2 }
    : { viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', error => report.errors.push(error.message));
  if (!cdpUrl) {
    await page.route('**/*', route => route.request().url().startsWith(origin) || route.request().url().startsWith('blob:') ? route.continue() : route.abort());
    await installBrowserNativeShell(page, { introductionSeen: false }); await page.goto(origin);
  } else {
    await page.getByRole('button', { name: '新建或打开', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '使用系统字体', exact: true }).count(), 0,
      'Native QA must start with system fonts preconfigured; use scripts/launch-native-qa.py');
    if (compact) {
      // Resize the actual Tauri window; CDP alone preserves its existing size.
      await page.evaluate(async size => {
        const { invoke, metadata } = window.__TAURI_INTERNALS__, label = metadata.currentWindow.label;
        if (await invoke('plugin:window|is_maximized', { label })) await invoke('plugin:window|toggle_maximize', { label });
        await invoke('plugin:window|set_size', { label, value: { Logical: size } });
      }, smallViewport);
      await page.waitForFunction(size => Math.abs(window.innerWidth - size.width) <= 2 && Math.abs(window.innerHeight - size.height) <= 2, smallViewport);
    }
    if (!await page.locator('.nb-onboarding-layer').count()) {
      await page.getByRole('button', { name: '回到主界面', exact: true }).click();
      await page.getByRole('button', { name: '浏览功能示例', exact: true }).click();
    }
  }
  report.viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight, scale: window.devicePixelRatio }));
  const card = page.getByRole('region', { name: '上手引导', exact: true });
  const step = async id => {
    await page.locator(`.nb-onboarding-layer[data-guide-step="${id}"]:not([data-guide-completed])`).waitFor({ state: 'visible' });
    await card.waitFor(); await frames();
    assert.equal(await card.getByRole('button', { name: /^(继续|完成|继续浏览)$/ }).count(), 0, 'Guide actions advance without a Continue button');
    assert.equal(await page.locator('[data-guide-arrow]').count(), 0, 'The guide uses a small popover beak, not a separate arrow');
    report.steps.push(id); console.log('Step:', id);
  };
  const complete = async (id, action, screenshot) => {
    // Read the rendered completion state while the same layer is settling.
    // This observes real UI only; all actions below use mouse or keyboard input.
    const completion = page.waitForFunction(expected => {
      const layer = document.querySelector(`.nb-onboarding-layer[data-guide-step="${expected}"][data-guide-completed="true"]`);
      return layer && {
        step: layer.dataset.guideStep,
        cards: document.querySelectorAll('[role="region"][aria-label="上手引导"]').length,
        rings: document.querySelectorAll('[data-guide-spotlight]').length,
        beaks: document.querySelectorAll('[data-guide-beak]').length,
      };
    }, id, { timeout: 5000 });
    await action();
    const state = await (await completion).jsonValue();
    assert.deepEqual(state, { step: id, cards: 0, rings: 0, beaks: 0 }, 'Completion immediately clears the card, circle, and beak');
    report.completions.push(state);
    if (screenshot) await page.screenshot({ path: `${directory}/${screenshot}` });
  };
  const checkTarget = async element => {
    // Opening a rich-text draft mounts its responsive toolbar before the next
    // ResizeObserver frame. Assert the settled ring, not two different frames.
    await page.waitForFunction(target => {
      const box = target.getBoundingClientRect(), ring = document.querySelector('[data-guide-spotlight]')?.getBoundingClientRect();
      return ring && Math.abs(box.x - ring.x - 4) < 2 && Math.abs(box.y - ring.y - 4) < 2
        && Math.abs(box.width + 8 - ring.width) < 2 && Math.abs(box.height + 8 - ring.height) < 2;
    }, await element.elementHandle(), { timeout: 3000 });
    const box = await element.boundingBox(), ring = await page.locator('[data-guide-spotlight]').first().boundingBox();
    assert(box && ring && Math.abs(box.x - (ring.x + 4)) < 2 && Math.abs(box.y - (ring.y + 4)) < 2, 'The circle follows the actual interactive target');
    assert.equal(await page.locator('[data-guide-spotlight]').count(), 1, 'One target has one circle');
    assert(Math.abs(box.width + 8 - ring.width) < 2 && Math.abs(box.height + 8 - ring.height) < 2, 'The circle covers the whole target');
    assert.equal(await page.locator('[data-guide-beak]').count(), 1);
    assert.equal(await page.locator('[data-guide-arrow]').count(), 0);
    const panel = await card.boundingBox();
    assert(panel, 'The instruction card is visible');
    const intersection = Math.max(0, Math.min(box.x + box.width, panel.x + panel.width) - Math.max(box.x, panel.x)) * Math.max(0, Math.min(box.y + box.height, panel.y + panel.height) - Math.max(box.y, panel.y));
    assert(intersection < 1, 'The instruction card must not cover its target');
    const horizontalGap = Math.max(box.x - panel.x - panel.width, panel.x - box.x - box.width, 0);
    const verticalGap = Math.max(box.y - panel.y - panel.height, panel.y - box.y - box.height, 0);
    assert(Math.hypot(horizontalGap, verticalGap) <= 32, 'The popover stays close to its target');
  };
  await step('read-note');
  // A live native resize may move the current target offscreen after the
  // initial one-time scroll. Exercise the visible recovery action as a user.
  const locate = card.getByRole('button', { name: '定位到这一步', exact: true });
  if (await locate.isVisible()) { await locate.click(); await frames(); }
  assert.equal(await page.getByRole('button', { name: '动手试一试', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: '交互练习', exact: true }).count(), 0);
  const editor = page.locator('.nb-prose.ProseMirror').last();
  const noteMarker = editor.locator('.nb-annotation-indicator[data-annotation-id="showcase-welcome"]');
  await checkTarget(noteMarker); const beforeHover = await card.boundingBox();
  await page.screenshot({ path: `${directory}/01-note-before-hover.png` });
  await complete('read-note', async () => {
    await noteMarker.hover(); await page.locator('[data-annotation-panel="showcase-welcome"]').waitFor();
    // boundingBox() waits for an attached locator and could accidentally read
    // the next step's card after the current one has already disappeared.
    const afterHover = await card.evaluateAll(elements => {
      const box = elements[0]?.getBoundingClientRect();
      return box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null;
    });
    if (afterHover) assert(Math.abs(beforeHover.x - afterHover.x) < 1 && Math.abs(beforeHover.y - afterHover.y) < 1, 'Opening the hover note must not reposition the guide card');
    report.noteHover = { before: beforeHover, after: afterHover, hiddenOnCompletion: !afterHover };
  }, '01-note-completed.png');
  await step('selection');
  assert.equal(await page.locator('[data-guide-spotlight]').count(), 1, 'The one-line text target has one merged circle');
  await page.screenshot({ path: `${directory}/02-selection.png` });
  const range = await page.locator('[data-guide-spotlight]').first().boundingBox();
  await complete('selection', async () => {
    await page.mouse.move(range.x + 4, range.y + range.height / 2); await page.mouse.down();
    await page.mouse.move(range.x + range.width - 4, range.y + range.height / 2, { steps: 12 }); await page.mouse.up();
  });
  assert.equal(await page.evaluate(() => String(window.getSelection())), '把想法写下来');
  await step('highlight');
  const topHighlight = page.locator('.responsive-toolbar').first().getByRole('button', { name: '应用文字颜色与高亮', exact: true });
  if (minimum) assert.equal(await topHighlight.isVisible(), false, 'The minimum-width run must exercise the collapsed top control');
  const highlight = await topHighlight.isVisible() ? topHighlight : page.getByRole('toolbar', { name: '文字工具栏', exact: true }).getByRole('button', { name: '应用文字颜色与高亮', exact: true });
  await checkTarget(highlight); await page.screenshot({ path: `${directory}/03-highlight.png` });
  await complete('highlight', () => highlight.click());
  await step('annotation-open');
  const bubbleAdd = page.getByRole('toolbar', { name: '文字工具栏', exact: true }).getByRole('button', { name: '添加说明', exact: true });
  const topAdd = page.locator('.responsive-toolbar').first().getByRole('button', { name: '添加说明', exact: true });
  const add = await bubbleAdd.isVisible() ? bubbleAdd : topAdd;
  await checkTarget(add); await page.screenshot({ path: `${directory}/04-annotation-open.png` });
  await complete('annotation-open', () => add.click());
  await step('annotation-save');
  const panel = page.locator('.nb-annotation-panel[data-shortcuts-suspended=true]');
  const body = panel.locator('.nb-annotation-richtext[contenteditable=true]');
  await checkTarget(panel); await body.click(); await page.keyboard.insertText('   ');
  await page.screenshot({ path: `${directory}/05-annotation-draft.png` });
  await panel.getByRole('button', { name: '取消', exact: true }).click(); await panel.waitFor({ state: 'hidden' });
  // Wait longer than normal completion settling: cancelling an empty-looking
  // draft must not silently count as saving it.
  await page.waitForTimeout(450);
  assert.equal(await page.locator('.nb-onboarding-layer').getAttribute('data-guide-step'), 'annotation-save');
  assert.equal(await page.locator('.nb-onboarding-layer').getAttribute('data-guide-completed'), null, 'Cancelling a draft is not completion');
  await page.screenshot({ path: `${directory}/05-annotation-cancelled.png` });
  const words = editor.locator('p').filter({ hasText: '把想法写下来' }).first();
  const textBox = await words.evaluate((element, text) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode, offset = node.textContent.indexOf(text);
      if (offset < 0) continue;
      const range = document.createRange(); range.setStart(node, offset); range.setEnd(node, offset + text.length);
      const box = range.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height };
    }
    return null;
  }, '把想法写下来');
  assert(textBox, 'The original text is still available for reselection');
  await page.mouse.move(textBox.x, textBox.y + textBox.height / 2); await page.mouse.down();
  await page.mouse.move(textBox.x + textBox.width, textBox.y + textBox.height / 2, { steps: 12 }); await page.mouse.up();
  assert.equal(await page.evaluate(() => String(window.getSelection())), '把想法写下来');
  const reopen = await bubbleAdd.isVisible() ? bubbleAdd : topAdd;
  await reopen.click(); await panel.waitFor(); await frames(); await checkTarget(panel);
  await body.click(); await page.keyboard.insertText('   ');
  await page.screenshot({ path: `${directory}/05-annotation-save-spaces.png` });
  await complete('annotation-save', () => panel.getByRole('button', { name: '保存', exact: true }).click());
  await step('insert-menu');
  await page.screenshot({ path: `${directory}/06-insert-menu.png` });
  const blank = await page.locator('[data-guide-spotlight]').first().boundingBox();
  await complete('insert-menu', async () => {
    await page.mouse.click(blank.x + 12, blank.y + blank.height / 2); await frames(); await page.keyboard.insertText('/note');
  });
  await step('insert-callout');
  const noteCommand = page.getByRole('button', { name: /^Note(，快捷触发词.*)?$/ }).last();
  await checkTarget(noteCommand); await page.screenshot({ path: `${directory}/07-insert-callout.png` });
  await complete('insert-callout', () => noteCommand.click());
  await page.keyboard.insertText('这是我写下的第一条笔记。');
  await step('disclosure');
  const disclosure = editor.locator('.nb-disclosure').filter({ has: page.getByRole('textbox', { name: '折叠块标题', exact: true }) }).first();
  const toggle = disclosure.getByRole('button', { name: '展开内容', exact: true });
  await checkTarget(toggle); await page.screenshot({ path: `${directory}/08-disclosure.png` });
  await complete('disclosure', () => toggle.click());
  await page.locator('.nb-onboarding-layer').waitFor({ state: 'hidden' });
  assert.equal(await card.count(), 0); assert.equal(await page.locator('[data-guide-step="summary"]').count(), 0);
  await page.screenshot({ path: `${directory}/09-complete.png` });
  assert.deepEqual(report.steps, ['read-note', 'selection', 'highlight', 'annotation-open', 'annotation-save', 'insert-menu', 'insert-callout', 'disclosure']);
  assert(await editor.innerText().then(text => text.includes('这是我写下的第一条笔记。')));
  // Open help from a real editor menu, including its first lazy-load boundary.
  // Use an unannotated paragraph at its exposed left edge. The saved note's
  // hover window and restored outline are separate, intentional surfaces.
  await editor.locator('p').filter({ hasText: '这是一份可以直接编辑的功能示例' }).first().hover({ position: { x: 8, y: 10 } });
  await page.locator('.nb-block-drag-handle').click();
  await page.getByRole('menu', { name: '内容块操作', exact: true }).getByRole('button', { name: '设为提示块', exact: true }).hover();
  const help = page.locator('[data-help-key="block.callout.wrap"]');
  await help.waitFor(); await help.locator('.github-alert-note .alert-title').getByText('Note', { exact: true }).waitFor();
  assert.equal(await help.locator('.alert-body').innerText(), '保留当前内容。');
  await page.screenshot({ path: `${directory}/10-menu-help.png` }); await page.keyboard.press('Escape');
  for (const layout of cdpUrl || compact ? [] : [
    { theme: 'hu-po', width: 1280, height: 900, scale: 1 },
    { theme: 'mo-ye', width: 960, height: 540, scale: 2 },
  ]) {
    const nextPage = await browser.newPage({ viewport: { width: layout.width, height: layout.height }, deviceScaleFactor: layout.scale, reducedMotion: 'reduce' });
    try {
      await installBrowserNativeShell(nextPage, { theme: layout.theme, introductionSeen: false });
      nextPage.on('pageerror', error => report.errors.push(error.message));
      await nextPage.goto(origin); const guide = nextPage.getByRole('region', { name: '上手引导', exact: true }); await guide.waitFor();
      const box = await guide.boundingBox(); assert(box.x >= 0 && box.y >= 0 && box.x + box.width <= layout.width + 1 && box.y + box.height <= layout.height + 1);
      const marker = nextPage.locator('.nb-annotation-indicator[data-annotation-id="showcase-welcome"]');
      assert.equal(await guide.getByRole('button', { name: /^(继续|完成|继续浏览)$/ }).count(), 0);
      assert.equal(await nextPage.locator('[data-guide-beak]').count(), 1);
      await nextPage.screenshot({ path: `${directory}/theme-${layout.theme}-${layout.scale}-before-hover.png` });
      await marker.hover(); await nextPage.locator('[data-annotation-panel="showcase-welcome"]').waitFor();
      await nextPage.locator('.nb-onboarding-layer[data-guide-step="read-note"][data-guide-completed="true"]').waitFor();
      assert.equal(await guide.count(), 0); assert.equal(await nextPage.locator('[data-guide-spotlight]').count(), 0);
      await nextPage.screenshot({ path: `${directory}/theme-${layout.theme}-${layout.scale}-completed.png` });
      await nextPage.locator('.nb-onboarding-layer[data-guide-step="selection"]').waitFor(); await guide.waitFor();
      await guide.getByRole('button', { name: '退出引导', exact: true }).click(); assert.equal(await guide.count(), 0);
      report.layouts.push(layout);
    } finally { await nextPage.close(); }
  }
  assert.equal(await page.getByRole('button', { name: '使用系统字体', exact: true }).count(), 0, 'No font download prompt appeared during the flow');
  report.fontPromptAbsent = true;
  assert.deepEqual(report.errors, []); console.log(JSON.stringify(report));
} catch (error) { if (page) await page.screenshot({ path: `${directory}/failure.png` }); throw error; }
finally { await fs.writeFile(`${directory}/results.json`, JSON.stringify(report, null, 2)); await browser.close(); await server.close(); }
