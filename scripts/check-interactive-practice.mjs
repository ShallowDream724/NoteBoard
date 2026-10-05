/* global window, document, NodeFilter, HTMLElement, getComputedStyle, requestAnimationFrame */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import { preview } from 'vite';
import { installBrowserNativeShell } from './browser-native-shell.mjs';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const cdpUrl = process.env.NOTEBOARD_TEST_CDP;
const minimum = process.argv.includes('--minimum');
const compact = minimum || process.argv.includes('--compact');
const scope = process.env.NOTEBOARD_TEST_SCOPE || 'guided-showcase';
assert(/^[a-z\d][a-z\d_-]*$/i.test(scope), 'The screenshot scope must be a directory name');
const directory = `.tmp/${scope}${cdpUrl ? minimum ? '/native-minimum' : compact ? '/native-compact' : '/native' : minimum ? '/minimum' : compact ? '/compact' : ''}`; await fs.mkdir(directory, { recursive: true });
const smallViewport = { width: minimum ? 680 : 960, height: 540 };
const server = await preview({ configFile: false, build: { outDir: 'dist' }, preview: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = cdpUrl ? await chromium.connectOverCDP(cdpUrl) : await chromium.launch({ channel: 'msedge', headless: true });
const report = { directory, steps: [], completions: [], recoveries: [], insertionTargets: [], layouts: [], errors: [] }; let page;
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
    // Keep an action failure visible even if cleanup rejects the pending wait.
    void completion.catch(() => {});
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
  // Tiptap attaches its live editor to this DOM node. Geometry is observed
  // through that real EditorView; this helper never dispatches a transaction.
  const insertionGeometry = async () => editor.evaluate(element => {
    const view = element.editor?.view;
    if (!view) throw new Error('The sample must own a live EditorView');
    const box = rect => ({ x: rect.left, y: rect.top, width: rect.right - rect.left, height: rect.bottom - rect.top });
    const { doc, selection } = view.state, candidates = [];
    doc.forEach((node, pos, index) => {
      let plainText = true; node.forEach(child => { if (!child.isText) plainText = false; });
      if (node.type.name !== 'paragraph' || node.content.size && (!plainText || !/^\/\w*$/.test(node.textContent))) return;
      const paragraph = view.nodeDOM(pos);
      if (!(paragraph instanceof HTMLElement)) return;
      const current = selection.empty && selection.$head.depth === 1 && selection.$head.before(1) === pos;
      const inputPosition = current ? selection.head : pos + 1;
      const caret = box(view.coordsAtPos(inputPosition));
      const line = box(paragraph.getBoundingClientRect());
      const point = { x: Math.min(line.x + line.width - 2, Math.max(line.x + 2, caret.x + 12)), y: caret.y + caret.height / 2 };
      candidates.push({ pos, index, text: node.textContent, current, inputPosition, caret, line, point,
        fontSize: parseFloat(getComputedStyle(paragraph).fontSize), inputReachable: paragraph.contains(document.elementFromPoint(point.x, point.y)) });
    });
    const target = candidates.find(candidate => candidate.current) ?? candidates[0];
    const ring = document.querySelector('[data-guide-spotlight]');
    const panel = document.querySelector('[role="region"][aria-label="上手引导"]');
    return { target, candidates, selection: { head: selection.head, from: selection.from, to: selection.to, empty: selection.empty, depth: selection.$head.depth },
      focused: view.hasFocus(), ring: ring ? box(ring.getBoundingClientRect()) : null, panel: panel ? box(panel.getBoundingClientRect()) : null,
      rings: document.querySelectorAll('[data-guide-spotlight]').length, beaks: document.querySelectorAll('[data-guide-beak]').length };
  });
  const intersection = (left, right) => Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x))
    * Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
  const checkInsertionTarget = async (label, { selected = false, expectedPosition } = {}) => {
    await frames();
    // Observe a settled ring after the real DOM selection or viewport changes.
    await page.waitForFunction(element => {
      const view = element.editor?.view, ring = document.querySelector('[data-guide-spotlight]')?.getBoundingClientRect();
      if (!view || !ring) return false;
      const selection = view.state.selection;
      if (!selection.empty || selection.$head.depth !== 1 || selection.$head.parent.type.name !== 'paragraph') return true;
      const caret = view.coordsAtPos(selection.head);
      return caret.left >= ring.left - 1 && caret.right <= ring.right + 1 && caret.top >= ring.top - 1 && caret.bottom <= ring.bottom + 1;
    }, await editor.elementHandle(), { timeout: 3000 });
    const geometry = await insertionGeometry(), { target, ring, panel } = geometry;
    assert(target && ring && panel, `${label}: the insertion line, spotlight, and card are visible`);
    assert.equal(geometry.rings, 1, `${label}: one insertion point has one spotlight`);
    assert.equal(geometry.beaks, 1, `${label}: the insertion point retains one popover beak`);
    const { caret, line, fontSize } = target;
    assert(caret.x >= ring.x - 1 && caret.x + caret.width <= ring.x + ring.width + 1
      && caret.y >= ring.y - 1 && caret.y + caret.height <= ring.y + ring.height + 1, `${label}: the spotlight contains the complete real caret`);
    assert(ring.width <= fontSize * 6 + 8 && ring.width >= Math.min(line.width, fontSize * 3), `${label}: the writing cue is a compact font-sized area`);
    assert(ring.width < line.width * .5, `${label}: the cue does not grow with the document line width`);
    assert(Math.abs(ring.height - caret.height - 8) < 2, `${label}: the cue follows the real caret line height`);
    assert(ring.x >= line.x - 5 && ring.x + ring.width <= line.x + line.width + 5, `${label}: the cue stays within its paragraph`);
    const overlaps = { inputLine: intersection(line, panel), caret: intersection({ ...caret, width: Math.max(1, caret.width) }, panel), spotlight: intersection(ring, panel) };
    assert(overlaps.inputLine < 1 && overlaps.caret < 1 && overlaps.spotlight < 1, `${label}: the instruction card leaves the input line, caret, and cue uncovered`);
    assert(target.inputReachable, `${label}: a real mouse click can reach the writing point`);
    if (selected) {
      assert(geometry.focused && geometry.selection.empty, `${label}: the guide preserves the editor focus and collapsed caret`);
      assert.equal(geometry.selection.head, target.inputPosition, `${label}: geometry follows the actual selection head`);
      assert.equal(geometry.selection.depth, 1, `${label}: typing uses a top-level paragraph`);
    }
    if (expectedPosition !== undefined) assert.equal(target.inputPosition, expectedPosition, `${label}: the clicked blank insertion position remains unchanged`);
    report.insertionTargets.push({ label, ...geometry, cardOverlapArea: overlaps }); return geometry;
  };
  const checkBlankHandle = async target => {
    await page.mouse.move(target.point.x, target.point.y); await frames();
    const handle = page.getByRole('button', { name: '添加内容', exact: true });
    await handle.waitFor({ state: 'visible' });
    const reachable = await handle.evaluate(element => {
      const box = element.getBoundingClientRect(), panel = document.querySelector('[role="region"][aria-label="上手引导"]')?.getBoundingClientRect();
      const x = box.left + box.width / 2, y = box.top + box.height / 2;
      return { x, y, hit: element.contains(document.elementFromPoint(x, y)), panelCovers: panel && x >= panel.left && x <= panel.right && y >= panel.top && y <= panel.bottom };
    });
    assert(reachable.hit && !reachable.panelCovers, 'The empty paragraph handle remains reachable beside the writing cue');
    // Reach the handle with the real pointer, then return to the writing area
    // before its deliberate hover-open delay starts a separate block menu.
    await page.mouse.move(reachable.x, reachable.y); await frames();
    await page.mouse.move(target.point.x, target.point.y); await frames();
    report.blankHandle = reachable;
  };
  const words = editor.locator('p').filter({ hasText: '把想法写下来' }).first();
  const wordBox = async (text = '把想法写下来') => {
    const box = await words.evaluate((element, text) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT), nodes = [];
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (!node.parentElement?.closest('[contenteditable="false"],.ProseMirror-widget,.nb-annotation-inline-marker')) nodes.push(node);
      }
      const start = nodes.map(node => node.textContent).join('').indexOf(text);
      if (start < 0) return null;
      let offset = 0, from, to;
      for (const node of nodes) {
        const end = offset + node.textContent.length;
        if (!from && start < end) from = { node, offset: start - offset };
        if (start + text.length <= end) { to = { node, offset: start + text.length - offset }; break; }
        offset = end;
      }
      if (!from || !to) return null;
      const range = document.createRange(); range.setStart(from.node, from.offset); range.setEnd(to.node, to.offset);
      const box = range.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height };
    }, text);
    assert(box, 'The original text is available for actual mouse selection'); return box;
  };
  const selectWords = async (text = '把想法写下来') => {
    const full = await wordBox();
    // Collapse the previous range before dragging. Starting inside an existing
    // selection invokes the browser's text drag-and-drop instead of reselecting.
    await page.mouse.click(full.x + 1, full.y + full.height / 2);
    // ArrowLeft also collapses a browser word-selection from rapid clicks.
    // The guide may point at a toolbar above the phrase, so avoid clicking a
    // distant location that is covered by its instruction card.
    await page.keyboard.press('ArrowLeft'); await frames();
    // Let the native double-click interval expire before the new drag starts.
    await page.waitForTimeout(550);
    const box = await wordBox(text);
    await page.mouse.move(box.x, box.y + box.height / 2); await page.mouse.down();
    await page.mouse.move(box.x + box.width, box.y + box.height / 2, { steps: 12 }); await page.mouse.up();
    assert.equal(await page.evaluate(() => String(window.getSelection())), text);
  };
  const checkTextTarget = async () => {
    await frames(); const box = await wordBox();
    await page.waitForFunction(expected => {
      const rings = document.querySelectorAll('[data-guide-spotlight]'), ring = rings[0]?.getBoundingClientRect();
      return rings.length === 1 && ring && Math.abs(expected.x - ring.x - 4) < 2 && Math.abs(expected.y - ring.y - 4) < 2
        && Math.abs(expected.width + 8 - ring.width) < 2 && Math.abs(expected.height + 8 - ring.height) < 2;
    }, box, { timeout: 3000 });
  };
  const remainsPending = async (id, message) => {
    await page.waitForTimeout(450);
    const layer = page.locator('.nb-onboarding-layer');
    assert.equal(await layer.getAttribute('data-guide-step'), id, message);
    assert.equal(await layer.getAttribute('data-guide-completed'), null, message); await card.waitFor();
  };
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
  await selectWords('把想法'); await remainsPending('selection', 'A partial phrase cannot advance the selection step'); await checkTextTarget();
  await page.screenshot({ path: `${directory}/02-selection-partial.png` }); report.recoveries.push('selection-partial');
  await complete('selection', () => selectWords());
  await step('highlight');
  await selectWords('把想法'); await remainsPending('highlight', 'Shortening the selection keeps highlight active'); await checkTextTarget();
  await page.screenshot({ path: `${directory}/03-highlight-partial.png` }); report.recoveries.push('highlight-partial');
  await selectWords(); await frames();
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
  await selectWords('把想法'); await frames(); await checkTextTarget();
  const wrongAdd = await bubbleAdd.isVisible() ? bubbleAdd : topAdd;
  await wrongAdd.click(); await panel.waitFor(); await frames();
  await remainsPending('annotation-save', 'A draft captured for only part of the phrase cannot complete the annotation step');
  const wrongCancel = panel.getByRole('button', { name: '取消编辑', exact: true }); await checkTarget(wrongCancel);
  await page.screenshot({ path: `${directory}/05-annotation-wrong-range.png` }); report.recoveries.push('annotation-wrong-range');
  await wrongCancel.click(); await panel.waitFor({ state: 'hidden' }); await selectWords();
  const reopen = await bubbleAdd.isVisible() ? bubbleAdd : topAdd;
  await reopen.click(); await panel.waitFor(); await frames(); await checkTarget(panel);
  await body.click(); await page.keyboard.insertText('   ');
  await page.screenshot({ path: `${directory}/05-annotation-save-spaces.png` });
  await complete('annotation-save', () => panel.getByRole('button', { name: '保存', exact: true }).click());
  await step('insert-menu');
  const blankBefore = await checkInsertionTarget('step6-before-click');
  assert.equal(blankBefore.target.text, '', 'Step 6 starts from an actual empty paragraph');
  await checkBlankHandle(blankBefore.target);
  await page.screenshot({ path: `${directory}/06-insert-menu.png` });
  let insertionParagraph = blankBefore.target.pos;
  await complete('insert-menu', async () => {
    await page.mouse.click(blankBefore.target.point.x, blankBefore.target.point.y);
    await checkInsertionTarget('step6-after-click', { selected: true, expectedPosition: blankBefore.target.inputPosition });
    await page.screenshot({ path: `${directory}/06-insert-menu-caret.png`, caret: 'initial' });
    // A genuine Enter creates a second eligible line. The writing cue must
    // follow the user's new caret instead of remaining on the first empty one.
    await page.keyboard.press('Enter');
    const nextBlank = await checkInsertionTarget('step6-current-blank', { selected: true });
    assert.equal(nextBlank.target.text, '', 'The new current paragraph is empty');
    assert(nextBlank.candidates.some(candidate => candidate.pos === blankBefore.target.pos), 'The first empty paragraph remains available');
    assert.notEqual(nextBlank.target.pos, blankBefore.target.pos, 'The cue follows the current empty paragraph even when an earlier blank exists');
    insertionParagraph = nextBlank.target.pos;
    await page.screenshot({ path: `${directory}/06-insert-menu-current-blank.png`, caret: 'initial' });
    await page.keyboard.insertText('/note');
  });
  await step('insert-callout');
  const noteCommand = page.getByRole('button', { name: 'Note，快捷触发词 /note', exact: true });
  await checkTarget(noteCommand); await page.screenshot({ path: `${directory}/07-insert-callout.png` });
  // Home places the real caret before the slash, which naturally ends the
  // suggestion session. Escape also exits the guide and cannot test recovery.
  await page.keyboard.press('Home'); await noteCommand.waitFor({ state: 'hidden' });
  await remainsPending('insert-callout', 'Closing the slash menu keeps the insertion step active');
  assert(await card.innerText().then(text => text.includes('可以再次找到 Note 提示块')), 'Step 7 renders the command recovery instruction');
  const fallback = await checkInsertionTarget('step7-command-fallback', { selected: true });
  assert.equal(fallback.target.text, '/note', 'The recovery cue follows the actual plain-text slash query');
  assert.equal(fallback.target.pos, insertionParagraph, 'The recovery cue stays on the user’s insertion paragraph');
  await page.screenshot({ path: `${directory}/07-insert-callout-fallback.png` });
  report.recoveries.push('insert-command-closed');
  await page.keyboard.press('End'); await noteCommand.waitFor({ state: 'visible' }); await frames();
  await checkTarget(noteCommand); await page.screenshot({ path: `${directory}/07-insert-callout-restored.png` });
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
  assert.deepEqual(report.recoveries, ['selection-partial', 'highlight-partial', 'annotation-wrong-range', 'insert-command-closed']);
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
