/* global window, document, requestAnimationFrame, getComputedStyle */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import { preview } from 'vite';
import { installBrowserNativeShell } from './browser-native-shell.mjs';

// Run against the production bundle. No fixture, test-only editor, store write,
// or synthetic pointer event participates in opening a help card.
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const cdpUrl = process.env.NOTEBOARD_TEST_CDP;
const selectedTheme = process.argv.find(argument => argument.startsWith('--theme='))?.slice('--theme='.length);
assert(!selectedTheme || ['chen-guang', 'hu-po', 'mo-ye'].includes(selectedTheme), 'Use --theme=chen-guang, hu-po, or mo-ye for a focused rerun');
const directory = `.tmp/rich-help-acceptance${cdpUrl ? '/native' : selectedTheme ? `/${selectedTheme}` : ''}`;
await fs.mkdir(directory, { recursive: true });
const server = await preview({ configFile: false, build: { outDir: 'dist' }, preview: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = cdpUrl ? await chromium.connectOverCDP(cdpUrl) : await chromium.launch({ channel: 'msedge', headless: true });
const report = { productionBundle: true, entries: [], layouts: [], cycles: [], errors: [], uncovered: [] };
const expected = new Map([
  ['list.bullet', { kind: 'bullet-list', selector: 'ul:not([data-type]) > li', count: 3 }],
  ['list.ordered', { kind: 'ordered-list', selector: 'ol > li', count: 3 }],
  ['list.task', { kind: 'task-list', selector: 'li[data-type="taskItem"]', count: 3 }],
  ['block.code', { kind: 'code-block', selector: '.nb-code-block .nb-help-code-line', count: 3 }],
  ['block.quote', { kind: 'quote', selector: 'blockquote > p', count: 1 }],
  ['block.divider', { kind: 'divider', selector: 'hr', count: 1 }],
  ['block.paragraph', { kind: 'paragraph', selector: '.nb-help-document > p', count: 1 }],
  ...[1, 2, 3, 4, 5, 6].map(level => [`block.heading.${level}`, { kind: `heading-${level}`, selector: `h${level}`, count: 1 }]),
  ...[4, 6, 9].map(count => [`image.collection.${count}`, { kind: `image-grid-${count}`, selector: '.nb-image-slot', count }]),
  ['image.collection.carousel', { kind: 'image-carousel', selector: '.nb-image-slot', count: 3 }],
  ['image.collection.columns.2', { kind: 'image-columns-2', selector: '.nb-image-slot', count: 6 }],
  ['image.collection.columns.3', { kind: 'image-columns-3', selector: '.nb-image-slot', count: 6 }],
  ['image.collection.layout.carousel', { kind: 'image-carousel', selector: '.nb-image-slot', count: 3 }],
]);
let page;
const helpSelector = '.nb-contextual-help-content > .nb-contextual-help';

async function frames(current) {
  await current.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function editorCounts(current) {
  return current.evaluate(() => {
    const prose = [...document.querySelectorAll('.ProseMirror')];
    return {
      // pmViewDesc is owned by a live ProseMirror EditorView. A CSS class alone
      // does not turn the small read-only presentation into another editor.
      prosemirrorViews: prose.filter(element => Boolean(element.pmViewDesc)).length,
      editableProse: prose.filter(element => element.getAttribute('contenteditable') === 'true').length,
      codemirrorViews: document.querySelectorAll('.cm-editor').length,
    };
  });
}

async function focusSnapshot(current) {
  return current.evaluate(() => {
    const active = document.activeElement;
    return { tag: active?.tagName, className: active?.className, label: active?.getAttribute('aria-label'), editable: active?.getAttribute('contenteditable') };
  });
}

async function releaseHelp(current) {
  const viewport = await current.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
  // Traverse the exit instead of teleporting the pointer once: Radix's
  // trigger/card grace polygon is retired by the next document pointermove.
  await current.mouse.move(2, viewport.height - 2, { steps: 12 });
  await current.mouse.move(8, viewport.height - 2);
  await current.waitForFunction(() => document.querySelectorAll('[data-help-key]').length === 0, undefined, { timeout: 3000 });
  assert.equal(await current.locator('.nb-contextual-help-illustration').count(), 0, 'Dismissed help releases all preview DOM, including accessible tooltip copies');
}

async function dismissMenus(current) {
  await releaseHelp(current);
  await current.keyboard.press('Escape');
  await current.keyboard.press('Escape');
  await current.waitForTimeout(450);
}

function editor(current) { return current.locator('.nb-prose.ProseMirror[contenteditable="true"]').last(); }
function toolbar(current) { return current.locator('.responsive-toolbar').first(); }

async function focusParagraph(current) {
  const paragraph = editor(current).locator('p').filter({ hasText: '这是一份可以直接编辑的功能示例' }).first();
  await paragraph.scrollIntoViewIfNeeded();
  await paragraph.click({ position: { x: 8, y: 10 } });
  await frames(current);
}

async function imageMenu(current) {
  await dismissMenus(current);
  await focusParagraph(current);
  const direct = toolbar(current).getByRole('button', { name: '图片', exact: true });
  if (await direct.isVisible()) {
    await direct.hover();
  } else {
    await toolbar(current).getByRole('button', { name: '插入超链接、图片、表格、公式、图表、提示块、日期时间等', exact: true }).hover();
    await current.getByRole('menuitem', { name: '图片', exact: true }).hover();
  }
  await current.getByRole('menuitem', { name: '四宫格', exact: true }).waitFor();
}

async function insertMenu(current) {
  await dismissMenus(current);
  await focusParagraph(current);
  await toolbar(current).getByRole('button', { name: '插入超链接、图片、表格、公式、图表、提示块、日期时间等', exact: true }).hover();
  await current.getByRole('menuitem', { name: '代码块', exact: true }).waitFor();
}

async function headingMenu(current) {
  await dismissMenus(current);
  await focusParagraph(current);
  await toolbar(current).getByRole('button', { name: '标题等级', exact: true }).hover();
  await current.getByRole('menuitem', { name: '正文段落', exact: true }).waitFor();
}

async function blockMenu(current, kind = 'paragraph') {
  await dismissMenus(current);
  const target = kind === 'collection'
    ? editor(current).locator('.nb-image-collection[data-layout="grid"]').first()
    : editor(current).locator('p').filter({ hasText: '这是一份可以直接编辑的功能示例' }).first();
  await target.scrollIntoViewIfNeeded();
  await target.hover({ position: { x: 8, y: 10 } });
  const handle = current.locator('.nb-block-drag-handle:not(.nb-empty-block-handle)');
  await handle.waitFor();
  await handle.click();
  await current.getByRole('menu', { name: '内容块操作', exact: true }).waitFor();
}

async function plusMenu(current) {
  await dismissMenus(current);
  const blank = editor(current).locator(':scope > p').filter({ hasText: /^$/ }).first();
  await blank.scrollIntoViewIfNeeded();
  await blank.click({ position: { x: 8, y: 10 } });
  await blank.hover({ position: { x: 8, y: 10 } });
  const handle = current.getByRole('button', { name: '添加内容', exact: true });
  await handle.waitFor();
  await handle.click();
  await current.getByRole('menu', { name: '插入内容', exact: true }).waitFor();
}

async function inspectHelp(current, target, key, entrance, { screenshot, delay = false, keepOpen = false } = {}) {
  const definition = expected.get(key);
  assert(definition, `Unknown expected help key: ${key}`);
  const beforeEditors = await editorCounts(current), beforeFocus = await focusSnapshot(current);
  assert(beforeEditors.prosemirrorViews > 0 && beforeEditors.editableProse > 0, 'A real editable ProseMirror view is mounted');
  // Narrow windows may show the outline over the right side of a dropdown.
  // Its exposed leading icon remains a normal, real mouse entry point.
  await target.hover({ position: { x: 8, y: 8 } });
  if (delay) {
    await current.waitForTimeout(250);
    assert.equal(await current.locator(helpSelector).count(), 0, 'Rich hover help waits before mounting');
  }
  const help = current.locator(`${helpSelector}[data-help-key="${key}"]`);
  await help.waitFor({ state: 'visible', timeout: 5000 });
  await frames(current);
  const preview = help.locator('.nb-contextual-help-illustration');
  assert.equal(await preview.getAttribute('data-preview-kind'), definition.kind);
  assert.equal(await preview.locator(definition.selector).count(), definition.count, `${key}: the preview has the expected real presentation DOM`);
  assert.equal(await preview.getAttribute('aria-hidden'), 'true');
  assert.equal(await preview.getAttribute('inert'), '');
  assert.equal(await preview.locator('[contenteditable="true"],.cm-editor').count(), 0, 'Help never creates an editable surface');
  assert.equal(await preview.evaluate(element => [...element.querySelectorAll('.ProseMirror')].some(node => Boolean(node.pmViewDesc))), false, 'Help never creates a ProseMirror view');
  assert((await help.locator(':scope > p').innerText()).trim().length > 15, 'Help has a meaningful operation explanation');
  if (key.startsWith('image.collection.')) {
    const imageStates = await preview.locator('img').evaluateAll(images => images.map(image => ({ complete: image.complete, width: image.naturalWidth, src: image.currentSrc })));
    assert.equal(imageStates.length, definition.count);
    assert(imageStates.every(image => image.complete && image.width > 0 && image.src.startsWith('data:image/svg+xml,')), 'Image help uses loaded local illustrations');
  }
  const panel = help.locator('..');
  const bounds = await panel.boundingBox();
  const triggerBounds = await target.boundingBox();
  const previewBounds = await preview.boundingBox();
  assert(triggerBounds && previewBounds);
  const viewport = await current.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio }));
  assert(bounds && bounds.x >= -0.5 && bounds.y >= -0.5 && bounds.x + bounds.width <= viewport.width + 0.5 && bounds.y + bounds.height <= viewport.height + 0.5, `${key}: popover stays inside the viewport`);
  assert(bounds.width >= Math.min(240, viewport.width - 24), `${key}: rich help must keep a readable illustration width when collision placement flips the card`);
  assert.deepEqual(await editorCounts(current), beforeEditors, 'Mounting help never increases editor instances');
  assert.deepEqual(await focusSnapshot(current), beforeFocus, 'Showing help preserves the existing focus');
  if (screenshot) await current.screenshot({ path: `${directory}/${screenshot}` });
  const side = await panel.getAttribute('data-side');
  const item = { key, entrance, kind: definition.kind, count: definition.count, bounds, triggerBounds, previewBounds, side, viewport, editors: beforeEditors, focusPreserved: true, previewEntered: false };
  report.entries.push(item);
  await current.evaluate(() => {
    const events = []; let pointer;
    const move = event => { pointer = { x: event.clientX, y: event.clientY, item: event.target.closest?.('[role="menuitem"]')?.getAttribute('aria-label') }; };
    const opened = () => events.push({ event: 'tooltip.open', pointer });
    document.addEventListener('pointermove', move, true); document.addEventListener('tooltip.open', opened, true);
    window.__qaHelpHandoffTrace = { events, stop: () => { document.removeEventListener('pointermove', move, true); document.removeEventListener('tooltip.open', opened, true); } };
  });
  // The illustration is deliberately inert and ignores pointer events. Move
  // the real mouse into its geometry instead of requiring it to hit-test.
  // Leave through the edge facing the card before travelling inside it. A
  // diagonal from a row's leading icon can cross the adjacent menu row when a
  // tall card is pinned near a viewport edge, legitimately changing help.
  const centerX = triggerBounds.x + triggerBounds.width / 2;
  const centerY = triggerBounds.y + triggerBounds.height / 2;
  const clamp = (value, low, high) => Math.min(Math.max(value, low), high);
  const handoff = async (stage, x, y) => {
    (item.handoff ||= []).push({ stage, x, y, ...await current.evaluate(({ key, x, y }) => {
      const hit = document.elementFromPoint(x, y);
      return { helpCount: document.querySelectorAll(`.nb-contextual-help-content > .nb-contextual-help[data-help-key="${key}"]`).length,
        imageItems: document.querySelectorAll('[role="menuitem"][aria-label="四宫格"]').length,
        hit: hit?.className, hitHelp: hit?.closest('[data-help-key]')?.getAttribute('data-help-key'), hitMenuItem: hit?.closest('[role="menuitem"]')?.getAttribute('aria-label') };
    }, { key, x, y }) });
  };
  if (side === 'left' || side === 'right') {
    const right = side === 'right';
    const edgeX = right ? triggerBounds.x + triggerBounds.width - 2 : triggerBounds.x + 2;
    await current.mouse.move(edgeX, centerY, { steps: 6 }); await handoff('trigger-edge', edgeX, centerY);
    const cardX = right ? bounds.x + 3 : bounds.x + bounds.width - 3;
    const cardY = clamp(centerY, bounds.y + 3, bounds.y + bounds.height - 3);
    await current.mouse.move(cardX, cardY, { steps: 6 }); await handoff('card-edge', cardX, cardY);
  } else {
    const bottom = side === 'bottom';
    await current.mouse.move(centerX, bottom ? triggerBounds.y + triggerBounds.height - 2 : triggerBounds.y + 2, { steps: 6 });
    await current.mouse.move(clamp(centerX, bounds.x + 3, bounds.x + bounds.width - 3), bottom ? bounds.y + 3 : bounds.y + bounds.height - 3, { steps: 6 });
  }
  await current.mouse.move(previewBounds.x + previewBounds.width / 2, previewBounds.y + previewBounds.height / 2, { steps: 6 });
  await handoff('preview', previewBounds.x + previewBounds.width / 2, previewBounds.y + previewBounds.height / 2);
  await current.waitForTimeout(150);
  item.tooltipEvents = await current.evaluate(() => { const trace = window.__qaHelpHandoffTrace; trace.stop(); delete window.__qaHelpHandoffTrace; return trace.events; });
  await help.waitFor({ state: 'visible', timeout: 2000 });
  assert.deepEqual(await focusSnapshot(current), beforeFocus, 'Moving into the inert preview preserves focus');
  item.previewEntered = true;
  if (!keepOpen) {
    await releaseHelp(current);
    assert.deepEqual(await editorCounts(current), beforeEditors, 'Closing help returns to the same editor instances');
  }
  return help;
}

async function carouselState(help) {
  return help.evaluate(element => {
    const slots = [...element.querySelectorAll('.nb-image-slot')], dots = [...element.querySelectorAll('.nb-image-dot')];
    return {
      active: slots.findIndex(slot => slot.hasAttribute('data-active')) + 1,
      dot: dots.findIndex(dot => dot.getAttribute('aria-pressed') === 'true') + 1,
      pressed: dots.filter(dot => dot.getAttribute('aria-pressed') === 'true').length,
      counter: element.querySelector('.nb-image-counter')?.textContent?.trim(),
      transform: element.querySelector('.nb-image-slots')?.style.transform,
    };
  });
}

async function checkCarousel(current, entrance, reducedMotion, screenshot) {
  await imageMenu(current);
  const help = await inspectHelp(current, current.getByRole('menuitem', { name: '图片轮播', exact: true }), 'image.collection.carousel', entrance, { keepOpen: true, screenshot });
  const check = async active => {
    const state = await carouselState(help);
    assert.deepEqual(state, { active, dot: active, pressed: 1, counter: `${active} / 3`, transform: `translateX(${-(active - 1) * 100}%)` });
    return state;
  };
  const states = [await check(1)];
  if (reducedMotion) {
    await current.waitForTimeout(3600);
    states.push(await check(1));
    assert.equal(await help.locator('.nb-image-slots').evaluate(element => getComputedStyle(element).transitionDuration), '0s');
  } else {
    for (const active of [2, 3]) {
      await current.waitForFunction(({ selector, active }) => {
        const root = document.querySelector(selector);
        return root && [...root.querySelectorAll('.nb-image-slot')].findIndex(slot => slot.hasAttribute('data-active')) + 1 === active;
      }, { selector: `${helpSelector}[data-help-key="image.collection.carousel"]`, active }, { timeout: 2500 });
      states.push(await check(active));
    }
    await current.waitForTimeout(1900);
    states.push(await check(3));
  }
  report.layouts.at(-1).carousel = { reducedMotion, states, onePassStops: !reducedMotion, staticWhenReduced: reducedMotion };
  await current.screenshot({ path: `${directory}/${screenshot.replace('.png', '-settled.png')}` });
  await releaseHelp(current);
}

async function memorySample(current, session) {
  await frames(current);
  await session.send('HeapProfiler.collectGarbage');
  const heap = await session.send('Runtime.getHeapUsage'), dom = await session.send('Memory.getDOMCounters');
  return { heapBytes: heap.usedSize, ...dom, editors: await editorCounts(current), helpNodes: await current.locator('[data-help-key]').count() };
}

async function checkCycles(current) {
  const session = await current.context().newCDPSession(current);
  try {
    // Warm the lazy module and the help/menu presentation before comparing GC.
    await imageMenu(current);
    await inspectHelp(current, current.getByRole('menuitem', { name: '四宫格', exact: true }), 'image.collection.4', 'image-menu-warm');
    await dismissMenus(current);
    const before = await memorySample(current, session);
    for (let cycle = 1; cycle <= 12; cycle++) {
      await imageMenu(current);
      await inspectHelp(current, current.getByRole('menuitem', { name: cycle % 2 ? '四宫格' : '图片轮播', exact: true }), cycle % 2 ? 'image.collection.4' : 'image.collection.carousel', 'image-menu-cycle');
      await dismissMenus(current);
      if (cycle % 4 === 0) report.cycles.push({ cycle, ...await memorySample(current, session) });
    }
    const after = report.cycles.at(-1);
    report.memory = { measurement: 'Production Edge renderer after CDP full GC; 12 actual hover open/close cycles after lazy-load warmup', before, after, heapDelta: after.heapBytes - before.heapBytes, nodeDelta: after.nodes - before.nodes, listenerDelta: after.jsEventListeners - before.jsEventListeners };
    assert.equal(after.helpNodes, 0);
    assert.deepEqual(after.editors, before.editors);
    assert(after.heapBytes - before.heapBytes < 4 * 1024 * 1024, 'Help cycles must not retain document-sized heaps');
    assert(after.nodes - before.nodes < 200, 'Help cycles release their preview DOM');
    assert(after.jsEventListeners - before.jsEventListeners < 40, 'Help cycles release their listeners');
  } finally { await session.detach(); }
}

async function startPage(layout) {
  let current;
  if (cdpUrl) {
    current = browser.contexts()[0].pages()[0];
    assert(current, 'NOTEBOARD_TEST_CDP must expose a running NoteBoard webview');
    if (!await current.getByRole('region', { name: '上手引导', exact: true }).isVisible()) {
      const home = current.getByRole('button', { name: '回到主界面', exact: true });
      if (await home.isVisible()) await home.click();
      await current.getByRole('button', { name: '浏览功能示例', exact: true }).click();
    }
  } else {
    current = await browser.newPage({ viewport: { width: layout.width, height: layout.height }, deviceScaleFactor: layout.dpr, reducedMotion: layout.reducedMotion ? 'reduce' : 'no-preference' });
    await current.route('**/*', route => route.request().url().startsWith(origin) || /^(data:|blob:)/.test(route.request().url()) ? route.continue() : route.abort());
    await installBrowserNativeShell(current, { theme: layout.theme, introductionSeen: false });
    await current.goto(origin);
  }
  current.on('pageerror', error => report.errors.push(error.message));
  const guide = current.getByRole('region', { name: '上手引导', exact: true });
  await guide.waitFor();
  await guide.getByRole('button', { name: '退出引导', exact: true }).click();
  await current.locator('.nb-onboarding-layer').waitFor({ state: 'hidden' });
  await editor(current).waitFor();
  // At small sizes the existing floating outline covers dropdown items and
  // their hover corridors. Exercise the normal user action that exposes them.
  if (await current.evaluate(() => window.innerWidth < 1200)) {
    const collapseOutline = current.getByRole('button', { name: '收起大纲', exact: true });
    if (await collapseOutline.isVisible()) await collapseOutline.click();
  }
  await frames(current);
  return current;
}

try {
  const layouts = cdpUrl ? [{ theme: 'native-current', reducedMotion: false }] : [
    { theme: 'chen-guang', width: 1440, height: 1000, dpr: 1, reducedMotion: false },
    { theme: 'hu-po', width: 960, height: 540, dpr: 2, reducedMotion: true },
    { theme: 'mo-ye', width: 680, height: 540, dpr: 2, reducedMotion: true },
  ];
  for (const layout of layouts.filter(layout => !selectedTheme || layout.theme === selectedTheme)) {
    page = await startPage(layout);
    const actual = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio, reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches }));
    report.layouts.push({ requested: layout, actual, outlineVisible: await page.getByRole('navigation', { name: '文档大纲', exact: true }).isVisible(), entrances: [] });
    if (!cdpUrl) assert.deepEqual(actual, { theme: layout.theme, width: layout.width, height: layout.height, dpr: layout.dpr, reducedMotion: layout.reducedMotion });
    console.log(`Rich help: ${layout.theme} ${actual.width}x${actual.height} DPR ${actual.dpr}`);
    await imageMenu(page);
    await inspectHelp(page, page.getByRole('menuitem', { name: '四宫格', exact: true }), 'image.collection.4', 'image-menu', { screenshot: `${layout.theme}-image-grid.png`, delay: true });
    report.layouts.at(-1).entrances.push('image-menu');
    await checkCarousel(page, 'image-menu', actual.reducedMotion, `${layout.theme}-carousel.png`);
    await plusMenu(page);
    await inspectHelp(page, page.getByRole('menu', { name: '插入内容', exact: true }).getByRole('menuitem', { name: '代码块', exact: true }), 'block.code', 'plus-menu', { screenshot: `${layout.theme}-plus-code.png` });
    report.layouts.at(-1).entrances.push('plus-menu');
    await blockMenu(page);
    await inspectHelp(page, page.getByRole('menu', { name: '内容块操作', exact: true }).getByRole('button', { name: '待办', exact: true }), 'list.task', 'block-drag-menu', { screenshot: `${layout.theme}-block-task.png` });
    report.layouts.at(-1).entrances.push('block-drag-menu');
    await headingMenu(page);
    await inspectHelp(page, page.getByRole('menuitem', { name: '六级标题 (H6)', exact: true }), 'block.heading.6', 'toolbar-heading-menu', { screenshot: `${layout.theme}-toolbar-heading.png` });
    report.layouts.at(-1).entrances.push('toolbar');
    if (cdpUrl || layout.theme === 'chen-guang') {
      for (const [key, name] of [['list.bullet', '无序列表'], ['list.ordered', '有序列表'], ['list.task', '待办']]) {
        await dismissMenus(page); await focusParagraph(page);
        await inspectHelp(page, toolbar(page).getByRole('button', { name, exact: true }), key, 'toolbar-button', { screenshot: `toolbar-${key.replaceAll('.', '-')}.png` });
      }
      for (const [key, name] of [['block.code', '代码块'], ['block.quote', '引用块 (Quote)'], ['block.divider', '水平分割线']]) {
        await insertMenu(page);
        await inspectHelp(page, page.getByRole('menuitem', { name, exact: true }), key, 'toolbar-insert-menu');
      }
      for (const [key, name] of [['block.paragraph', '正文段落'], ...[1, 2, 3, 4, 5, 6].map((level, i) => [`block.heading.${level}`, `${['一', '二', '三', '四', '五', '六'][i]}级标题 (H${level})`])]) {
        await headingMenu(page);
        await inspectHelp(page, page.getByRole('menuitem', { name, exact: true }), key, 'toolbar-heading-menu');
      }
      for (const [key, name] of [['image.collection.6', '六宫格'], ['image.collection.9', '九宫格']]) {
        await imageMenu(page);
        await inspectHelp(page, page.getByRole('menuitem', { name, exact: true }), key, 'image-menu', { screenshot: `${key.replaceAll('.', '-')}.png` });
      }
      for (const [key, name] of [['image.collection.columns.2', '两列拼图'], ['image.collection.columns.3', '三列拼图'], ['image.collection.layout.carousel', '图片轮播']]) {
        await blockMenu(page, 'collection');
        await inspectHelp(page, page.getByRole('menu', { name: '内容块操作', exact: true }).getByRole('menuitemradio', { name, exact: true }), key, 'block-image-layout-menu', { screenshot: `${key.replaceAll('.', '-')}.png` });
      }
      await checkCycles(page);
    }
    assert.equal(await page.getByRole('button', { name: '使用系统字体', exact: true }).count(), 0);
    await dismissMenus(page);
    if (!cdpUrl) await page.close();
    page = undefined;
  }
  const covered = new Set(report.entries.map(entry => entry.key));
  report.uncovered = [...expected.keys()].filter(key => !covered.has(key));
  if (!selectedTheme) assert.deepEqual(report.uncovered, [], 'All added rich-help keys are exercised through actual editor UI');
  report.focusedTheme = selectedTheme;
  assert.deepEqual(report.errors, []);
  report.passed = true;
  await fs.rm(`${directory}/failure.png`, { force: true });
  console.log(JSON.stringify({ passed: true, entries: report.entries.length, layouts: report.layouts, memory: report.memory, uncovered: report.uncovered }));
} catch (error) {
  report.passed = false; report.failure = error.stack || error.message;
  if (page) await page.screenshot({ path: `${directory}/failure.png` }).catch(() => {});
  throw error;
} finally {
  await fs.writeFile(`${directory}/results.json`, JSON.stringify(report, null, 2));
  // CDP is a user-owned native window; disconnecting preserves that window.
  await browser.close();
  await server.close();
}
