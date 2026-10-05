/* global window, document, getComputedStyle, requestAnimationFrame */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import { preview } from 'vite';
import { installBrowserNativeShell } from './browser-native-shell.mjs';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const baseline = process.argv.includes('--baseline');
const cdpUrl = process.env.NOTEBOARD_TEST_CDP;
const directory = `.tmp/document-gutters${cdpUrl ? '/native' : baseline ? '/before' : ''}`;
await fs.mkdir(directory, { recursive: true });
const server = await preview({ configFile: false, build: { outDir: 'dist' }, preview: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = cdpUrl ? await chromium.connectOverCDP(cdpUrl) : await chromium.launch({ channel: 'msedge', headless: true });
const report = { productionBundle: true, native: Boolean(cdpUrl), baseline, browser: await browser.version(),
  bundleModifiedAt: (await fs.stat('dist/index.html')).mtime.toISOString(), layouts: [], errors: [],
  limitations: ['Checks use the real production showcase. Offline browser settings/filesystem IPC are shimmed; native checks retain the real bridge.',
    'Natural wide table/formula content may extend beyond the content lane; its presentation is measured separately from symmetric gutter layout.'] };
let page;
const editorSelector = '.nb-prose.ProseMirror[contenteditable="true"]';
const prose = current => current.locator(editorSelector).last();
const image = current => prose(current).locator('.nb-image:not(.nb-image-slot .nb-image) [data-image-frame]').first();
const frames = current => current.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

async function geometry(current) {
  return current.evaluate(() => {
    const box = element => {
      if (!element) return null;
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height, center: x + width / 2 };
    };
    const editor = [...document.querySelectorAll('.nb-prose.ProseMirror[contenteditable="true"]')].at(-1);
    const scroller = editor.closest('[data-editor-scroll]');
    const stage = editor.closest('.nb-document-stage');
    const content = editor.closest('.nb-document-content');
    const style = getComputedStyle(editor), scrollStyle = getComputedStyle(scroller);
    const editorBox = box(editor), scrollBox = box(scroller);
    const imageFrame = editor.querySelector('.nb-image:not(.nb-image-slot .nb-image) [data-image-frame]');
    const left = parseFloat(style.paddingLeft), right = parseFloat(style.paddingRight);
    const usableCenter = scrollBox.x + scroller.clientLeft + scroller.clientWidth / 2;
    const contentLeft = editorBox.x + left, contentRight = editorBox.x + editorBox.width - right;
    const outline = document.querySelector('.nb-document-outline');
    const formula = editor.querySelector('.math-node-display .math-preview');
    const table = editor.querySelector('.tableWrapper table');
    return { viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio }, theme: document.documentElement.dataset.theme,
      pane: box(stage), content: box(content), editor: editorBox, scroller: scrollBox, scrollerClientWidth: scroller.clientWidth,
      usableCenter, padding: { left, right }, outerMargins: { left: editorBox.x - scrollBox.x, right: scrollBox.x + scroller.clientWidth - editorBox.x - editorBox.width },
      contentEdges: { left: contentLeft, right: contentRight, center: (contentLeft + contentRight) / 2 },
      whitespace: { left: contentLeft - scrollBox.x, right: scrollBox.x + scroller.clientWidth - contentRight },
      image: box(imageFrame), imageAlign: imageFrame?.parentElement.style.alignItems, imageWidth: imageFrame?.style.width,
      imageCenterError: imageFrame ? box(imageFrame).center - usableCenter : null,
      table: box(table), tableOverflow: table && getComputedStyle(table.parentElement).overflowX,
      formula: box(formula), formulaOverflow: formula && getComputedStyle(formula.closest('.math-node-preview')).overflowX,
      maxWidth: style.maxWidth, contentMaxWidth: style.getPropertyValue('--content-max-width').trim(),
      gutterVariable: style.getPropertyValue('--document-gutter').trim(),
      scrollOverflowX: scrollStyle.overflowX, outline: box(outline), outlineTop: outline && getComputedStyle(outline).top,
      outlineBorder: outline && getComputedStyle(outline).borderWidth,
      editors: { prose: [...document.querySelectorAll('.ProseMirror')].filter(element => Boolean(element.pmViewDesc)).length,
        editable: document.querySelectorAll('.ProseMirror[contenteditable="true"]').length, code: document.querySelectorAll('.cm-editor').length } };
  });
}

async function openShowcase(current) {
  const guide = current.getByRole('region', { name: '上手引导', exact: true });
  if (cdpUrl && !await current.locator('.nb-onboarding-layer').count()) {
    const home = current.getByRole('button', { name: '回到主界面', exact: true });
    if (await home.isVisible()) await home.click();
    await current.getByRole('button', { name: '浏览功能示例', exact: true }).click();
  }
  await guide.waitFor();
  await guide.getByRole('button', { name: '退出引导', exact: true }).click();
  await current.locator('.nb-onboarding-layer').waitFor({ state: 'hidden' });
  await prose(current).waitFor();
  await frames(current);
  const openOutline = current.getByRole('button', { name: '展开大纲', exact: true });
  if (await openOutline.isVisible()) {
    await openOutline.click();
    await current.locator('.nb-document-outline').waitFor();
    await frames(current);
  }
  assert.equal(await current.getByRole('button', { name: '使用系统字体', exact: true }).count(), 0);
}

async function imageScreenshot(current, name) {
  const frame = image(current);
  await frame.scrollIntoViewIfNeeded();
  await current.waitForFunction(() => {
    const img = [...document.querySelectorAll('.nb-prose.ProseMirror[contenteditable="true"]')].at(-1)?.querySelector('.nb-image:not(.nb-image-slot .nb-image) [data-image-frame] img');
    return img?.complete && img.naturalWidth > 0;
  });
  await frames(current);
  await current.mouse.move(2, 2);
  await current.waitForTimeout(200);
  const path = `${directory}/${name}-image.png`;
  await current.screenshot({ path, fullPage: true });
  return path;
}

async function outlineCheck(current, entry) {
  const before = await geometry(current);
  assert.equal(before.outlineTop, '56px');
  assert.equal(before.outlineBorder, '0px');
  await current.getByRole('button', { name: '收起大纲', exact: true }).click();
  await current.locator('.nb-document-outline').waitFor({ state: 'detached' });
  await frames(current);
  const closed = await geometry(current);
  await current.getByRole('button', { name: '展开大纲', exact: true }).click();
  await current.locator('.nb-document-outline').waitFor();
  await frames(current);
  const reopened = await geometry(current);
  for (const after of [closed, reopened]) {
    assert(Math.abs(before.editor.width - after.editor.width) <= 0.5);
    assert(Math.abs(before.content.width - after.content.width) <= 0.5);
    assert(Math.abs(before.image.width - after.image.width) <= 0.5);
    assert(Math.abs(before.image.center - after.image.center) <= 0.5);
    assert.deepEqual(after.editors, before.editors);
  }
  entry.outline = { before, closed, reopened, widthsAndViewsPreserved: true };
}

async function documentSnapshot(current) {
  return prose(current).evaluate(element => JSON.stringify(element.pmViewDesc.node.toJSON()));
}

async function dismissMenus(current) {
  await current.keyboard.press('Escape');
  await current.mouse.move(2, 2);
  await current.waitForTimeout(220);
}

async function hoverBlock(current, block, label) {
  await dismissMenus(current);
  await block.scrollIntoViewIfNeeded();
  await block.hover({ position: { x: 8, y: 10 } });
  const handle = current.getByRole('button', { name: label, exact: true });
  await handle.waitFor();
  await frames(current);
  return handle;
}

async function controlGeometry(handle, protectedElement) {
  return handle.evaluate((element, protectedNode) => {
    const rect = node => { const { x, y, width, height } = node.getBoundingClientRect(); return { x, y, width, height }; };
    const grip = element.querySelector('.nb-block-grip');
    const icon = element.querySelector('svg,.nb-block-heading-icon');
    return { handle: rect(element), protected: rect(protectedNode), label: element.getAttribute('aria-label'),
      gripDisplay: grip && getComputedStyle(grip).display, icon: icon && rect(icon),
      focusable: element.tabIndex >= 0, hasMenu: element.getAttribute('aria-haspopup') };
  }, await protectedElement.elementHandle());
}

function intersection(a, b) {
  return Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
    * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
}

function assertControl(control, expectedWidth) {
  assert.equal(control.handle.width, expectedWidth, `${control.label} uses the container-specific width`);
  assert.equal(control.gripDisplay, expectedWidth === 30 ? 'none' : 'block', 'Only compact handles hide the grip');
  assert(control.icon?.width > 0 && control.icon?.height > 0, 'Block type icon remains visible');
  assert(control.focusable && control.hasMenu === 'menu');
  assert(control.handle.x + control.handle.width <= control.protected.x + 0.5, `${control.label} does not cover its protected content/control`);
  assert.equal(intersection(control.handle, control.protected), 0);
}

async function checkBlockControls(current, entry) {
  await current.getByRole('button', { name: '收起大纲', exact: true }).click();
  await current.locator('.nb-document-outline').waitFor({ state: 'detached' });
  const original = await documentSnapshot(current);
  const expectedWidth = entry.initial.pane.width <= 720 ? 30 : 50;
  const controls = [];
  const paragraph = prose(current).locator(':scope > p').filter({ hasText: '这是一份可以直接编辑的功能示例' }).first();
  let handle = await hoverBlock(current, paragraph, '拖动段落');
  const paragraphControl = await controlGeometry(handle, paragraph);
  assertControl(paragraphControl, expectedWidth); controls.push(paragraphControl);
  await handle.click();
  await current.getByRole('menu', { name: '内容块操作', exact: true }).waitFor();
  await current.getByRole('menuitem', { name: '删除', exact: true }).waitFor();
  await dismissMenus(current);
  handle = await hoverBlock(current, paragraph, '拖动段落');
  await handle.focus(); await current.keyboard.press('Enter');
  await current.getByRole('menu', { name: '内容块操作', exact: true }).waitFor();
  await dismissMenus(current);
  entry.keyboardMenu = { activatedWithEnter: true };

  const heading = prose(current).locator('h2').filter({ hasText: '图片与图注' }).first();
  handle = await hoverBlock(current, heading, '拖动标题');
  const fold = heading.locator('.nb-heading-fold-toggle');
  const headingControl = await controlGeometry(handle, fold);
  assertControl(headingControl, expectedWidth); controls.push(headingControl);
  await fold.click();
  assert.equal(await fold.getAttribute('aria-expanded'), 'false');
  assert(await prose(current).locator('.nb-heading-fold-hidden').count() > 0, 'Real heading fold hides its section');
  await fold.click();
  assert.equal(await fold.getAttribute('aria-expanded'), 'true');
  entry.headingFold = { collapsedAndExpanded: true, handleGap: headingControl.protected.x - headingControl.handle.x - headingControl.handle.width };

  const table = prose(current).locator('.tableWrapper table').first();
  const firstCell = table.locator('th,td').first();
  handle = await hoverBlock(current, firstCell, '拖动表格');
  const tableControl = await controlGeometry(handle, table);
  assertControl(tableControl, expectedWidth); controls.push(tableControl);
  const rails = await current.locator('.nb-table-select-handle:not([hidden])').evaluateAll(elements => elements.map(element => {
    const { x, y, width, height } = element.getBoundingClientRect();
    return { x, y, width, height, className: element.className, label: element.getAttribute('aria-label') };
  }));
  assert(rails.some(rail => rail.className.includes('nb-table-select-row')) && rails.some(rail => rail.className.includes('nb-table-select-column')), 'Real table hover shows row and column controls');
  assert(rails.every(rail => intersection(tableControl.handle, rail) === 0), 'Block handle does not intersect table row/column controls');
  entry.tableRails = { rails, handle: tableControl.handle, overlapArea: 0 };
  await handle.click();
  const menu = current.getByRole('menu', { name: '内容块操作', exact: true });
  await menu.waitFor();
  await menu.getByRole('button', { name: '整张表格居中', exact: true }).click();
  await dismissMenus(current);

  const singleImage = prose(current).locator('.nb-image:not(.nb-image-slot .nb-image)').first();
  handle = await hoverBlock(current, singleImage, '拖动图片');
  const imageControl = await controlGeometry(handle, image(current));
  assertControl(imageControl, expectedWidth); controls.push(imageControl);
  await handle.click();
  await menu.waitFor();
  assert.equal(await menu.getByRole('button', { name: '图片居中', exact: true }).getAttribute('aria-pressed'), 'true');
  await menu.getByRole('button', { name: '图片居中', exact: true }).click();
  await frames(current);
  entry.selectedImage = await prose(current).evaluate(element => {
    const selected = element.querySelector('.ProseMirror-selectednode');
    const node = selected?.pmViewDesc?.node;
    return { className: selected?.className, selectedNode: node?.type.name, align: node?.attrs.align, width: node?.attrs.width };
  });
  assert.equal(entry.selectedImage.selectedNode, 'image', 'Actual image menu selects the existing showcase image');
  assert.equal(entry.selectedImage.align, 'center');
  entry.selectedImageScreenshot = await imageScreenshot(current, entry.requested.name + '-selected');
  assert(Math.abs((await geometry(current)).imageCenterError) <= 1);

  const blank = prose(current).locator(':scope > p').filter({ hasText: /^$/ }).first();
  const plus = await hoverBlock(current, blank, '添加内容');
  const plusControl = await controlGeometry(plus, blank);
  assert.equal(plusControl.handle.width, 30);
  assert(plusControl.handle.x + plusControl.handle.width <= plusControl.protected.x + 0.5);
  await plus.click();
  await current.getByRole('menu', { name: '插入内容', exact: true }).waitFor();
  await current.getByRole('menuitem', { name: '代码块', exact: true }).waitFor();
  await dismissMenus(current);
  entry.emptyParagraph = { plus: plusControl, opensInsertMenu: true };
  entry.controls = controls;
  assert.deepEqual(JSON.parse(await documentSnapshot(current)), JSON.parse(original), 'Geometry/menu/folding checks preserve document content');

  // Move an existing short paragraph using pointer capture, then undo exactly
  // that discrete operation. This tests the type-only compact hit target.
  const source = prose(current).locator(':scope > p').filter({ hasText: '把想法写下来，把关系画出来。' }).first();
  const dragPasses = [];
  for (let pass = 0; pass < 2; pass++) {
    // The first actual edit lets the existing ProseMirror table normalizer
    // propagate header widths into source cells with null colwidth. Compare
    // the second drag against an immediate, already-normalized document.
    handle = await hoverBlock(current, source, '拖动段落');
    const beforeDrag = await documentSnapshot(current);
    const targetBox = await paragraph.boundingBox(), handleBox = await handle.boundingBox();
    assert(targetBox && handleBox);
    await current.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await current.mouse.down();
    await current.mouse.move(targetBox.x + 30, targetBox.y + targetBox.height + 2, { steps: 10 });
    await current.locator('.nb-block-drop-indicator').waitFor();
    assert.equal(await current.locator('.nb-block-drag-preview.is-invalid').count(), 0);
    await current.mouse.up(); await frames(current);
    const dragged = await documentSnapshot(current);
    assert.notDeepEqual(JSON.parse(dragged), JSON.parse(beforeDrag), 'Actual drag reorders the paragraph');
    const paragraphTexts = text => JSON.parse(text).content.filter(node => node.type === 'paragraph').map(node => node.content?.map(item => item.text || '').join(''));
    assert.notDeepEqual(paragraphTexts(dragged), paragraphTexts(beforeDrag), 'Drag changes existing paragraph order');
    await prose(current).focus(); await current.keyboard.press('Control+z'); await frames(current);
    const restored = await documentSnapshot(current);
    assert.deepEqual(paragraphTexts(restored), paragraphTexts(beforeDrag), 'Undo restores the paragraph order');
    await fs.writeFile(`${directory}/${entry.requested.name}-drag-${pass}-before.json`, beforeDrag);
    await fs.writeFile(`${directory}/${entry.requested.name}-drag-${pass}-restored.json`, restored);
    if (pass === 1) assert.deepEqual(JSON.parse(restored), JSON.parse(beforeDrag), 'Undo strictly restores the immediate pre-drag document');
    dragPasses.push({ pass, normalizationWarmup: pass === 0, reorderedExistingParagraph: true, paragraphOrderRestored: true, fullStructureRestored: pass === 1 });
  }
  entry.drag = { passes: dragPasses, reorderedExistingParagraph: true, restoredWithUndo: true, comparison: 'Full document against an immediate baseline after the actual table-normalization warmup' };
  await current.getByRole('button', { name: '展开大纲', exact: true }).click();
  await current.locator('.nb-document-outline').waitFor();
}

async function checkOtherAxes(current, entry) {
  await current.getByRole('button', { name: '收起大纲', exact: true }).click();
  const table = prose(current).locator('.tableWrapper table').first();
  await table.scrollIntoViewIfNeeded(); await frames(current);
  const tableLayout = await geometry(current);
  const tableFits = tableLayout.table.width <= tableLayout.contentEdges.right - tableLayout.contentEdges.left + 1;
  if (tableFits) assert(Math.abs(tableLayout.table.center - tableLayout.usableCenter) <= 1, 'Fitting centered table shares the same axis');
  else assert.equal(tableLayout.tableOverflow, 'visible', 'Natural wide table remains unclipped by its block wrapper');
  const formula = prose(current).locator('.math-node-display').first();
  await formula.scrollIntoViewIfNeeded();
  await formula.locator('.katex').first().waitFor(); await frames(current);
  const original = await documentSnapshot(current);
  const handle = await hoverBlock(current, formula, '拖动公式块');
  await handle.click();
  await current.getByRole('menu', { name: '内容块操作', exact: true }).getByRole('button', { name: '公式对齐', exact: true }).click();
  await current.locator('.nb-alignment-menu').getByRole('button', { name: '居中', exact: true }).click();
  await dismissMenus(current); await frames(current);
  const formulaLayout = await geometry(current);
  const formulaFits = formulaLayout.formula.width <= formulaLayout.contentEdges.right - formulaLayout.contentEdges.left + 1;
  if (formulaFits) assert(Math.abs(formulaLayout.formula.center - formulaLayout.usableCenter) <= 1, 'Fitting centered formula shares the same axis');
  else assert.equal(formulaLayout.formulaOverflow, 'visible', 'Natural wide formula remains unclipped by its block wrapper');
  entry.otherAxes = { tableFits, table: tableLayout.table, tableCenterError: tableLayout.table.center - tableLayout.usableCenter,
    tableOverflow: tableLayout.tableOverflow, formulaFits, formula: formulaLayout.formula,
    formulaCenterError: formulaLayout.formula.center - formulaLayout.usableCenter, formulaOverflow: formulaLayout.formulaOverflow, actualFormulaMenuCentered: true };
  await prose(current).focus(); await current.keyboard.press('Control+z'); await frames(current);
  assert.deepEqual(JSON.parse(await documentSnapshot(current)), JSON.parse(original), 'Formula alignment QA is undone to preserve the original left-aligned example');
  await current.getByRole('button', { name: '展开大纲', exact: true }).click(); await frames(current);
}

try {
  const layouts = cdpUrl ? [{ name: 'native-compact', width: 680, height: 540, dpr: 2, explorer: true }] : [
    { name: 'chen-guang-wide-open', theme: 'chen-guang', width: 1440, height: 1000, dpr: 1, explorer: true },
    { name: 'chen-guang-wide-closed', theme: 'chen-guang', width: 1440, height: 1000, dpr: 1, explorer: false },
    { name: 'hu-po-compact-open', theme: 'hu-po', width: 960, height: 540, dpr: 2, explorer: true },
    { name: 'mo-ye-minimum-open', theme: 'mo-ye', width: 680, height: 540, dpr: 2, explorer: true },
    { name: 'chen-guang-minimum-closed', theme: 'chen-guang', width: 680, height: 540, dpr: 2, explorer: false },
  ];
  for (const layout of layouts) {
    page = cdpUrl ? browser.contexts()[0].pages()[0] : await browser.newPage({ viewport: { width: layout.width, height: layout.height }, deviceScaleFactor: layout.dpr });
    assert(page);
    page.on('pageerror', error => report.errors.push(error.message));
    if (cdpUrl) {
      assert.equal(await page.evaluate(() => Boolean(window.__qaIpcCalls)), false);
      const size = { width: layout.width, height: layout.height };
      await page.evaluate(async size => {
        const { invoke, metadata } = window.__TAURI_INTERNALS__, label = metadata.currentWindow.label;
        if (await invoke('plugin:window|is_maximized', { label })) await invoke('plugin:window|toggle_maximize', { label });
        await invoke('plugin:window|set_size', { label, value: { Logical: size } });
      }, size);
      await page.waitForFunction(size => Math.abs(window.innerWidth - size.width) <= 2 && Math.abs(window.innerHeight - size.height) <= 2, size);
    } else {
      await page.route('**/*', route => route.request().url().startsWith(origin) || /^(data:|blob:)/.test(route.request().url()) ? route.continue() : route.abort());
      await installBrowserNativeShell(page, { theme: layout.theme, introductionSeen: false });
      await page.goto(origin);
    }
    await openShowcase(page);
    if (cdpUrl && layout.explorer && (await geometry(page)).pane.x < 4) {
      await page.keyboard.press('Control+Shift+b'); await frames(page);
    }
    if (!layout.explorer) { await page.keyboard.press('Control+Shift+b'); await frames(page); }
    const screenshot = await imageScreenshot(page, layout.name);
    const initial = await geometry(page), entry = { requested: layout, initial, screenshot };
    report.layouts.push(entry);
    if (!baseline) {
      const expectedGutter = initial.pane.width <= 720 ? 64 : 80;
      assert.equal(initial.padding.left, expectedGutter);
      assert.equal(initial.padding.right, expectedGutter);
      assert(Math.abs(initial.whitespace.left - initial.whitespace.right) <= 1, 'Visible whitespace is symmetric');
      assert(Math.abs(initial.contentEdges.center - initial.usableCenter) <= 1, 'Content lane shares the scroll area center');
      assert(Math.abs(initial.imageCenterError) <= 1, 'Centered showcase image shares the scroll area center');
      await outlineCheck(page, entry);
      await checkBlockControls(page, entry);
      await checkOtherAxes(page, entry);
    }
    console.log(JSON.stringify({ name: layout.name, pane: initial.pane.width, padding: initial.padding, whitespace: initial.whitespace, imageCenterError: initial.imageCenterError }));
    if (!cdpUrl) await page.close(); page = undefined;
  }
  assert.deepEqual(report.errors, []);
  report.passed = true;
  await fs.rm(`${directory}/failure.png`, { force: true });
} catch (error) {
  report.passed = false; report.failure = error.stack || error.message;
  if (page) await page.screenshot({ path: `${directory}/failure.png`, fullPage: true }).catch(() => {});
  throw error;
} finally {
  await fs.writeFile(`${directory}/results.json`, JSON.stringify(report, null, 2));
  await browser.close(); await server.close();
}
