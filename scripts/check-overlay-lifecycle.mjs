/* global window, document, KeyboardEvent, Event, Element, getComputedStyle */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { installBrowserNativeShell } from './browser-native-shell.mjs';

// Reuse a caller-owned Vite server. Only an isolated browser profile is changed;
// editor/menu/settings actions use the real application and offline native IPC.
const runtime = process.env.NOTEBOARD_PLAYWRIGHT ?? resolve(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const { chromium } = await import(pathToFileURL(runtime).href);
const origin = process.env.NOTEBOARD_QA_URL ?? 'http://127.0.0.1:26357';
const directory = '.tmp/overlay-lifecycle';
await fs.mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--no-proxy-server'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const sourceModules = new Map();
page.setDefaultTimeout(60000);
const report = { browser: await browser.version(), origin, checks: [], screenshots: [], errors: [], limitations: ['Native filesystem IPC is replaced with an offline boundary.', 'Number input IME keys are dispatched with isComposing; this checks the browser event guard, not a physical IME.'] };
page.on('pageerror', error => report.errors.push(error.message));
page.on('response', response => {
  const url = response.url(); if (url.includes('/src/')) sourceModules.set(new URL(url).pathname, url);
  if (response.status() >= 400) console.error(`HTTP ${response.status()} ${url}`);
});
await page.route('**/*', route => route.request().url().startsWith(origin) || /^(data:|blob:)/.test(route.request().url()) ? route.continue() : route.abort());
// Other agents may edit files while this shared server is running. Keep this
// ephemeral page stable without changing Vite or any other browser's HMR.
await page.routeWebSocket(/.*/, socket => socket.send(JSON.stringify({ type: 'connected' })));
await installBrowserNativeShell(page, { introductionSeen: false });
const prose = () => page.locator('.nb-document-editors > div[style*="position: relative"] .nb-prose.ProseMirror[contenteditable="true"]:visible').last();
const heading = () => page.getByRole('button', { name: '标题等级', exact: true });
const menus = () => page.locator('[role="menu"][data-nb-menu-branch]');
const away = async () => { await page.mouse.move(2, 980); await page.waitForTimeout(450); };
const check = async (name, run) => { const evidence = await run(); report.checks.push({ name, ...evidence }); console.log(`PASS ${name}`); };
const screenshot = async name => { const path = `${directory}/${name}.png`; await page.screenshot({ path }); report.screenshots.push(path); };
const state = async () => ({
  key: await page.evaluate(() => [...document.querySelectorAll('.nb-tab[role="tab"]')].findIndex(tab => tab.getAttribute('aria-selected') === 'true')),
  json: await prose().evaluate(element => element.pmViewDesc.node.toJSON()),
});
const nativeDocument = async text => {
  const count = await page.locator('.nb-tab[role="tab"]').count();
  await page.getByRole('button', { name: '新建或打开', exact: true }).click();
  await page.getByRole('menuitem', { name: '新建 NoteBoard 文档 (.nb)', exact: true }).click();
  await page.waitForFunction(count => document.querySelectorAll('.nb-tab[role="tab"]').length === count + 1, count);
  await prose().waitFor(); await prose().focus(); await page.keyboard.type(text); await page.keyboard.press('Enter');
  return (await state()).key;
};

try {
  await page.goto(origin, { waitUntil: 'commit', timeout: 60000 });
  await prose().waitFor(); await page.waitForTimeout(500);
  const guide = page.getByRole('region', { name: '上手引导', exact: true });
  if (await guide.isVisible()) await guide.getByRole('button', { name: '退出引导', exact: true }).click();
  console.log('READY full application');
  await page.evaluate(() => {
    window.__overlayEvents = [];
    const describe = target => target instanceof Element ? `${target.tagName}.${target.className}(${target.getAttribute('aria-label') || ''})[${target.getAttribute('data-nb-menu-branch') || ''}]` : String(target);
    for (const type of ['pointerover', 'pointerout', 'focusin', 'focusout', 'keydown']) document.addEventListener(type, event => window.__overlayEvents.push({ type, target: describe(event.target), related: describe(event.relatedTarget), key: event.key }), true);
  });
  const first = await nativeDocument('菜单与说明检查');
  await page.keyboard.type('第二段正文');

  await check('正文 hover closes after pointer leaves without a click', async () => {
    await heading().hover(); await page.waitForTimeout(350); assert.equal(await menus().count(), 1);
    await screenshot('heading-open'); await away(); assert.equal(await menus().count(), 0);
    return { before: 1, after: 0, leaveWaitMs: 450 };
  });
  await check('menu action and a subsequent leave do not leave a floating panel', async () => {
    await heading().hover(); await page.getByRole('menuitem', { name: '还原为正文', exact: true }).click();
    await away(); assert.equal(await menus().count(), 0); return { menus: 0 };
  });
  await check('keyboard Escape returns focus to the heading trigger', async () => {
    await heading().focus(); await heading().press('ArrowDown'); await menus().waitFor();
    await page.keyboard.press('Escape'); await page.waitForTimeout(150);
    assert.equal(await menus().count(), 0); assert(await heading().evaluate(element => document.activeElement === element));
    return { menus: 0, triggerFocused: true, escapePresses: 1 };
  });

  const arrow = () => page.locator('.nb-numbering-control-toolbar .nb-numbering-arrow');
  const input = () => page.getByRole('spinbutton', { name: '重新编号起始值', exact: true });
  await prose().locator('p').last().click(); await page.keyboard.press('End');
  await page.locator('.nb-numbering-control-toolbar .nb-numbering-main').click(); await prose().locator('ol').waitFor();
  const beforeNumbering = (await state()).json;
  await check('number input retains focus across pointer leave and IME keys, then Escape rolls back', async () => {
    await arrow().hover(); await input().waitFor(); await input().fill('7'); await away();
    assert(await input().isVisible()); assert(await input().evaluate(element => document.activeElement === element));
    for (const key of ['Escape', 'Enter']) await input().evaluate((element, key) => element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, isComposing: true })), key);
    assert.equal(await input().inputValue(), '7'); assert.equal(await menus().count(), 1);
    await screenshot('number-input-retained'); await input().press('Escape'); await page.waitForTimeout(150);
    assert.equal(await input().count(), 0); assert.deepEqual((await state()).json, beforeNumbering);
    return { retainedMenus: 1, inputFocused: true, imeKeys: 2, cancelledMenus: 0, documentRestored: true };
  });
  await check('numbering style portal can be entered and left while its parent input remains available', async () => {
    await arrow().hover(); await input().waitFor();
    await page.getByRole('button', { name: '编号样式', exact: true }).hover();
    await page.locator('.nb-numbering-style-menu').waitFor();
    await page.getByRole('menuitemradio').first().hover(); assert.equal(await page.getByRole('menuitemradio').count(), 9);
    assert.equal(await menus().count(), 2); await screenshot('numbering-nested');
    await input().hover(); await page.waitForTimeout(450); assert.equal(await page.getByRole('menuitemradio').count(), 0); assert(await input().isVisible());
    await prose().click(); await page.waitForTimeout(150); assert.equal(await menus().count(), 0);
    return { nestedMenus: 2, styleChoices: 9, parentAfterTraversal: 1, afterOutside: 0 };
  });
  await check('window blur closes the current toolbar menu and pending hover cannot reopen it', async () => {
    await heading().hover(); await page.waitForTimeout(350); assert.equal(await menus().count(), 1);
    await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await page.waitForTimeout(450); assert.equal(await menus().count(), 0);
    await away(); await heading().hover(); await page.waitForTimeout(50); await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await page.waitForTimeout(450); assert.equal(await menus().count(), 0); return { visibleAfterBlur: 0, visibleAfterInterruptedDelay: 0 };
  });
  await check('a document switch without outside pointer releases old menus', async () => {
    const second = await nativeDocument('另一个文档');
    await heading().hover(); await page.waitForTimeout(350); assert.equal(await menus().count(), 1);
    const oldBranch = await menus().getAttribute('data-nb-menu-branch');
    await page.mouse.move(2, 980);
    await page.locator('.nb-tab[role="tab"]').nth(first).evaluate(element => element.click());
    await prose().getByText('菜单与说明检查', { exact: true }).waitFor();
    assert.equal(await page.locator(`[role="menu"][data-nb-menu-branch="${oldBranch}"]`).count(), 0);
    assert.equal(await menus().count(), 0); assert.equal((await state()).key, first);
    return { documents: 2, oldMenusAfterSwitch: 0, switchedFrom: second, switchedTo: first };
  });

  await check('annotation editing survives blur, reading portals dismiss after focused header leave', async () => {
    await prose().locator('p').first().click(); await page.keyboard.press('Home'); await page.keyboard.press('Shift+End');
    await page.waitForTimeout(350);
    report.selectionToolbar = await page.evaluate(async urls => {
      const [{ useWindowStore }, { getMdTipTapEditor }] = await Promise.all(urls.map(url => import(url)));
      const editor = getMdTipTapEditor(useWindowStore.getState().activeKey);
      return { selection: editor?.state.selection.toJSON(), hasFocus: editor?.view.hasFocus(), connected: editor?.view.dom.isConnected, classes: editor?.view.dom.className, domSelection: window.getSelection()?.toString(), toolbars: document.querySelectorAll('[aria-label="文字工具栏"]').length, toolbarButtons: [...document.querySelectorAll('[aria-label="文字工具栏"] button')].map(button => ({ label: button.getAttribute('aria-label'), visible: Boolean(button.getClientRects().length) })) };
    }, [sourceModules.get('/src/stores/windowStore.ts'), sourceModules.get('/src/features/editor-md/editorInstances.ts')]);
    console.log(`SELECTION ${JSON.stringify(report.selectionToolbar)}`);
    // The block entry is available even when the selection toolbar is disabled.
    await prose().locator('p').first().hover();
    await page.getByRole('button', { name: /^拖动/ }).first().hover();
    await page.getByRole('menuitem', { name: '添加说明', exact: true }).click();
    const panel = page.getByRole('dialog', { name: '补充说明', exact: true }); await panel.waitFor();
    const draft = panel.locator('.nb-annotation-richtext[contenteditable="true"]'); await draft.click(); await page.keyboard.insertText('说明草稿在后台保留');
    await page.evaluate(() => window.dispatchEvent(new Event('blur'))); assert(await draft.isVisible()); assert.equal(await draft.innerText(), '说明草稿在后台保留');
    await screenshot('annotation-draft'); await panel.getByRole('button', { name: '保存', exact: true }).click();
    await panel.getByRole('button', { name: '关闭说明', exact: true }).click();
    const anchor = prose().locator('.nb-annotation-anchor, .nb-annotation-indicator').first(); await anchor.hover(); await panel.waitFor(); await panel.hover();
    await panel.locator('.nb-annotation-actions button').first().focus(); await away(); assert.equal(await panel.count(), 0);
    return { draftAfterBlur: 1, draftTextPreserved: true, readingAfterFocusedHeaderLeave: 0 };
  });

  await prose().locator('p').first().click(); await heading().hover();
  await page.getByRole('menuitem', { name: '一级标题 (H1)', exact: true }).click();
  await page.locator('.nb-outline-item').first().waitFor();
  for (const mode of ['floating', 'docked']) {
    await check(`${mode} outline and contextual-help portals retain menu traversal and clean up on blur`, async () => {
      await page.getByRole('button', { name: '打开设置', exact: true }).click();
      await page.getByRole('button', { name: '编辑器', exact: true }).click();
      await page.locator('select').filter({ has: page.locator('option[value="docked"]') }).selectOption(mode);
      await page.getByRole('button', { name: '关闭设置', exact: true }).click();
      await page.waitForFunction(mode => document.querySelector('.nb-document-stage')?.getAttribute('data-navigation-mode') === mode, mode);
      await heading().hover(); await page.getByRole('menuitem', { name: '一级标题 (H1)', exact: true }).hover();
      const help = page.locator('.nb-contextual-help-content'); await help.waitFor(); await help.hover();
      assert.equal(await menus().count(), 1);
      const geometry = await help.evaluate(element => ({ bodyPortal: !element.closest('.nb-document-editors'), zIndex: Number(getComputedStyle(element).zIndex), width: element.getBoundingClientRect().width }));
      assert(geometry.bodyPortal); assert(geometry.width > 200);
      await screenshot(`help-${mode}`); await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await page.waitForTimeout(150);
      assert.equal(await menus().count(), 0); assert.equal(await help.count(), 0);
      return { mode, menuDuringHelpTraversal: 1, menusAfterBlur: 0, helpAfterBlur: 0, ...geometry };
    });
  }
  // Stateful drafts survive tab switches without retaining the old portal DOM.
  await prose().locator('.nb-annotation-anchor, .nb-annotation-indicator').first().hover();
  const draftPanel = page.getByRole('dialog', { name: '补充说明', exact: true }); await draftPanel.waitFor();
  await draftPanel.getByRole('button', { name: '编辑说明', exact: true }).click();
  const draftContent = draftPanel.locator('.nb-annotation-richtext[contenteditable="true"]');
  await draftContent.click(); await page.keyboard.press('Control+A'); await page.keyboard.insertText('标签切换尚未保存的说明');
  const parentBeforeDraftSwitch = (await state()).json;
  const draftBefore = await draftContent.innerText(); await screenshot('annotation-before-tab-switch');
  await page.locator('.nb-tab[role="tab"]').last().click(); await prose().getByText('另一个文档', { exact: true }).waitFor();
  const panelsOnOtherDocument = await draftPanel.count();
  await page.locator('.nb-tab[role="tab"]').nth(first).click(); await prose().locator('h1').waitFor();
  const restoredDraftCount = await draftContent.count();
  report.draftSwitch = { draftBefore, panelsOnOtherDocument, restoredDraftCount, restoredDraftText: restoredDraftCount ? await draftContent.innerText() : null, parentDocumentUnchanged: JSON.stringify((await state()).json) === JSON.stringify(parentBeforeDraftSwitch) };
  assert.equal(panelsOnOtherDocument, 0); assert.equal(restoredDraftCount, 1); assert.equal(report.draftSwitch.restoredDraftText, draftBefore); assert(report.draftSwitch.parentDocumentUnchanged);
  report.checks.push({ name: 'annotation draft restores on its own document without saving into either parent', ...report.draftSwitch });
  await screenshot('annotation-after-tab-switch'); console.log(`DRAFT SWITCH ${JSON.stringify(report.draftSwitch)}`);
  await check('close guidance preserves an explicit annotation draft and deliberate discard closes it', async () => {
    const tabCount = await page.locator('.nb-tab[role="tab"]').count();
    await page.locator('.nb-tab[role="tab"]').nth(first).getByRole('button', { name: /^关闭 / }).click();
    const closeDialog = page.locator('[role="dialog"][aria-modal="true"]'); await closeDialog.waitFor();
    await closeDialog.getByRole('button', { name: '保存', exact: true }).click();
    await closeDialog.waitFor({ state: 'detached' }); assert.equal(await page.locator('.nb-tab[role="tab"]').count(), tabCount);
    assert.equal(await draftContent.innerText(), draftBefore); await screenshot('annotation-close-guidance');
    await page.locator('.nb-tab[role="tab"]').nth(first).getByRole('button', { name: /^关闭 / }).click();
    await closeDialog.waitFor(); await closeDialog.getByRole('button', { name: '不保存', exact: true }).click();
    await page.waitForFunction(count => document.querySelectorAll('.nb-tab[role="tab"]').length === count - 1, tabCount);
    assert.equal(await draftPanel.count(), 0); return { retainedAfterSaveClose: true, explicitDiscardRemovedTabs: 1, draftPortalsAfterDiscard: 0 };
  });
  assert.deepEqual(report.errors, []);
  console.log(JSON.stringify({ checks: report.checks.length, screenshots: report.screenshots, errors: report.errors }));
} catch (error) {
  report.failure = error.stack || error.message;
  report.dom = await page.evaluate(() => ({ active: document.activeElement?.outerHTML, selection: window.getSelection()?.toString(), menus: [...document.querySelectorAll('[role="menu"][data-nb-menu-branch]')].map(element => element.outerHTML.slice(0, 400)), events: window.__overlayEvents?.slice(-50) }));
  report.state = await state().catch(error => ({ error: error.message }));
  await screenshot('failure'); console.error(report.failure); process.exitCode = 1;
} finally {
  await fs.writeFile(`${directory}/results.json`, JSON.stringify(report, null, 2)); await browser.close();
}
