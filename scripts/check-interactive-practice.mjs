/* global window, requestAnimationFrame */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import { preview } from 'vite';
import { installBrowserNativeShell } from './browser-native-shell.mjs';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const cdpUrl = process.env.NOTEBOARD_TEST_CDP;
const minimum = process.argv.includes('--minimum');
const compact = minimum || process.argv.includes('--compact');
const directory = `.tmp/guided-showcase${cdpUrl ? '/native' : minimum ? '/minimum' : compact ? '/compact' : ''}`; await fs.mkdir(directory, { recursive: true });
const server = await preview({ configFile: false, build: { outDir: 'dist' }, preview: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = cdpUrl ? await chromium.connectOverCDP(cdpUrl) : await chromium.launch({ channel: 'msedge', headless: true });
const report = { steps: [], layouts: [], errors: [] }; let page;
const frames = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
try {
  page = cdpUrl ? browser.contexts()[0].pages()[0] : await browser.newPage(compact
    ? { viewport: { width: minimum ? 680 : 960, height: 540 }, deviceScaleFactor: 2 }
    : { viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', error => report.errors.push(error.message));
  if (!cdpUrl) {
    await page.route('**/*', route => route.request().url().startsWith(origin) || route.request().url().startsWith('blob:') ? route.continue() : route.abort());
    await installBrowserNativeShell(page, { introductionSeen: false }); await page.goto(origin);
  } else {
    await page.getByRole('button', { name: '新建或打开', exact: true }).waitFor();
    const fonts = page.getByRole('button', { name: '使用系统字体', exact: true }); if (await fonts.isVisible()) await fonts.click();
    if (!await page.locator('.nb-onboarding-layer').count()) {
      await page.getByRole('button', { name: '回到主界面', exact: true }).click();
      await page.getByRole('button', { name: '浏览功能示例', exact: true }).click();
    }
  }
  const card = page.getByRole('region', { name: '上手引导', exact: true });
  const step = async id => { await page.locator(`.nb-onboarding-layer[data-guide-step="${id}"]`).waitFor({ state: 'visible' }); await frames(); report.steps.push(id); console.log('Step:', id); };
  const continueGuide = () => card.getByRole('button', { name: /^(继续|完成)$/ }).click();
  const checkTarget = async element => {
    const box = await element.boundingBox(), ring = await page.locator('[data-guide-spotlight]').first().boundingBox();
    assert(box && ring && Math.abs(box.x - (ring.x + 4)) < 2 && Math.abs(box.y - (ring.y + 4)) < 2, 'The circle follows the actual interactive target');
    assert.equal(await page.locator('[data-guide-arrow]').count(), 1);
    const panel = await card.boundingBox();
    const intersection = Math.max(0, Math.min(box.x + box.width, panel.x + panel.width) - Math.max(box.x, panel.x)) * Math.max(0, Math.min(box.y + box.height, panel.y + panel.height) - Math.max(box.y, panel.y));
    assert(intersection < 1, 'The instruction card must not cover its target');
  };
  await step('read-note');
  assert.equal(await page.getByRole('button', { name: '动手试一试', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: '交互练习', exact: true }).count(), 0);
  const editor = page.locator('.nb-prose.ProseMirror').last();
  const noteMarker = editor.locator('.nb-annotation-indicator[data-annotation-id="showcase-welcome"]');
  await checkTarget(noteMarker); await page.screenshot({ path: `${directory}/01-note.png` });
  await noteMarker.hover(); await page.locator('[data-annotation-panel="showcase-welcome"]').waitFor(); await continueGuide();
  await step('selection');
  const range = await page.locator('[data-guide-spotlight]').first().boundingBox();
  await page.mouse.move(range.x + 4, range.y + range.height / 2); await page.mouse.down();
  await page.mouse.move(range.x + range.width - 4, range.y + range.height / 2, { steps: 12 }); await page.mouse.up();
  assert.equal(await page.evaluate(() => String(window.getSelection())), '把想法写下来');
  await step('highlight');
  const topHighlight = page.locator('.responsive-toolbar').first().getByRole('button', { name: '应用文字颜色与高亮', exact: true });
  const highlight = await topHighlight.isVisible() ? topHighlight : page.getByRole('toolbar', { name: '文字工具栏', exact: true }).getByRole('button', { name: '应用文字颜色与高亮', exact: true });
  await checkTarget(highlight); await page.screenshot({ path: `${directory}/02-highlight.png` }); await highlight.click();
  await step('annotation-open');
  const bubbleAdd = page.getByRole('toolbar', { name: '文字工具栏', exact: true }).getByRole('button', { name: '添加说明', exact: true });
  const add = await bubbleAdd.count() ? bubbleAdd : page.locator('.responsive-toolbar').first().getByRole('button', { name: '添加说明', exact: true });
  await checkTarget(add); await add.click();
  await step('annotation-save');
  const panel = page.locator('.nb-annotation-panel[data-shortcuts-suspended=true]');
  const body = panel.locator('.nb-annotation-richtext[contenteditable=true]');
  await checkTarget(body); await body.click(); await page.keyboard.insertText('以后在这里整理自己的想法。');
  assert.equal(await card.getByRole('button', { name: '继续', exact: true }).count(), 0, 'An unsaved draft is not completion');
  await page.screenshot({ path: `${directory}/03-annotation.png` });
  await panel.getByRole('button', { name: '保存', exact: true }).click(); await continueGuide();
  await step('insert-menu');
  const blank = await page.locator('[data-guide-spotlight]').first().boundingBox();
  await page.mouse.click(blank.x + 12, blank.y + blank.height / 2); await frames(); await page.keyboard.insertText('/note');
  await step('insert-callout');
  const noteCommand = page.getByRole('button', { name: /^Note(，快捷触发词.*)?$/ }).last();
  await checkTarget(noteCommand); await page.screenshot({ path: `${directory}/04-command.png` }); await noteCommand.click();
  await card.getByRole('button', { name: '继续', exact: true }).waitFor();
  await page.keyboard.insertText('这是我写下的第一条笔记。'); await continueGuide();
  await step('disclosure');
  const disclosure = editor.locator('.nb-disclosure').filter({ has: page.getByRole('textbox', { name: '折叠块标题', exact: true }) }).first();
  const toggle = disclosure.getByRole('button', { name: '展开内容', exact: true });
  await checkTarget(toggle); await toggle.click(); await continueGuide();
  await step('summary'); await page.screenshot({ path: `${directory}/05-complete.png` });
  await card.getByRole('button', { name: '开始使用', exact: true }).click(); assert.equal(await card.count(), 0);
  assert(await editor.innerText().then(text => text.includes('这是我写下的第一条笔记。')));
  // Open help from a real editor menu, including its first lazy-load boundary.
  await editor.locator('p').filter({ hasText: '把想法写下来' }).first().hover();
  await page.locator('.nb-block-drag-handle').click();
  await page.getByRole('menu', { name: '内容块操作', exact: true }).getByRole('button', { name: '设为提示块', exact: true }).hover();
  const help = page.locator('[data-help-key="block.callout.wrap"]');
  await help.waitFor(); await help.locator('.github-alert-note .alert-title').getByText('Note', { exact: true }).waitFor();
  assert.equal(await help.locator('.alert-body').innerText(), '保留当前内容。');
  await page.screenshot({ path: `${directory}/06-menu-help.png` }); await page.keyboard.press('Escape');
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
      await marker.hover(); await nextPage.locator('[data-annotation-panel="showcase-welcome"]').waitFor();
      await nextPage.screenshot({ path: `${directory}/theme-${layout.theme}-${layout.scale}.png` });
      await guide.getByRole('button', { name: '退出引导', exact: true }).click(); assert.equal(await guide.count(), 0);
      report.layouts.push(layout);
    } finally { await nextPage.close(); }
  }
  assert.deepEqual(report.errors, []); console.log(JSON.stringify(report));
} catch (error) { if (page) await page.screenshot({ path: `${directory}/failure.png` }); throw error; }
finally { await fs.writeFile(`${directory}/results.json`, JSON.stringify(report, null, 2)); await browser.close(); await server.close(); }
