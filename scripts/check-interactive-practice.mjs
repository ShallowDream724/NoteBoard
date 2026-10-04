/* global window, DataTransfer, ClipboardEvent, requestAnimationFrame */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import { preview } from 'vite';
import { installBrowserNativeShell } from './browser-native-shell.mjs';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const cdpUrl = process.env.NOTEBOARD_TEST_CDP;
const directory = cdpUrl ? '.tmp/interactive-practice/native' : '.tmp/interactive-practice'; await fs.mkdir(directory, { recursive: true });
const server = await preview({ configFile: false, build: { outDir: 'dist' }, preview: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = cdpUrl ? await chromium.connectOverCDP(cdpUrl) : await chromium.launch({ channel: 'msedge', headless: true });
const result = { steps: [], themes: [], layouts: [], errors: [] };
let page;
const frames = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const selectText = async (paragraph, prefix, text) => {
  await paragraph.click(); await frames(); await page.keyboard.press('Home');
  for (let index = 0; index < prefix.length; index++) await page.keyboard.press('ArrowRight');
  for (let index = 0; index < text.length; index++) await page.keyboard.press('Shift+ArrowRight');
  await frames();
  assert.equal(await page.evaluate(() => String(window.getSelection())), text, 'Keyboard selection must reach the actual exercise text');
};
try {
  page = cdpUrl ? browser.contexts()[0].pages()[0] : await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on('pageerror', error => result.errors.push(error.message));
  if (cdpUrl) {
    await page.getByRole('button', { name: '新建或打开', exact: true }).waitFor();
    const skip = page.getByRole('button', { name: /跳过/ }).first();
    if (await skip.isVisible()) await skip.click();
    await page.keyboard.press('Escape');
    const systemFonts = page.getByRole('button', { name: '使用系统字体', exact: true });
    if (await systemFonts.isVisible()) await systemFonts.click();
    // This mode is for an isolated QA profile. Remove its first-run sample and
    // any previous failed practice attempt before starting the real workflow.
    while (await page.locator('.nb-tab-close').count()) {
      await page.locator('.nb-tab-close').last().click(); await frames();
      const discard = page.getByRole('button', { name: '不保存', exact: true });
      if (await discard.isVisible()) await discard.click();
    }
    await page.getByRole('button', { name: '回到主界面', exact: true }).click();
  } else {
    await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
    await installBrowserNativeShell(page);
    await page.goto(origin);
  }
  await page.getByRole('button', { name: '动手试一试', exact: true }).click();
  const panel = page.getByRole('complementary', { name: '互动练习', exact: true });
  await panel.waitFor();
  const editor = page.locator('.nb-prose.ProseMirror:visible'); await editor.waitFor();
  const top = page.locator('.responsive-toolbar').first();
  const done = async () => {
    await panel.locator('.nb-practice-status--complete').waitFor();
    result.steps.push(await panel.locator('h2').innerText());
    console.log('Completed:', result.steps.at(-1));
    await panel.getByRole('button', { name: /^(继续|查看回顾)$/ }).click();
  };
  const newParagraph = async () => {
    await editor.locator(':scope > p').last().click(); await frames();
    await page.keyboard.press('End'); await page.keyboard.press('Enter');
    await frames();
  };
  const insertMenu = () => top.getByRole('button', { name: /^插入超链接/ }).click();
  const observation = editor.locator('p').filter({ hasText: '一次散步，也可以成为一份有趣的笔记。' });
  await selectText(observation, '一次散步，也可以成为一份有趣的笔记。', '观察与记录');
  await done();
  await top.getByRole('button', { name: '应用文字颜色与高亮', exact: true }).click();
  await done();
  await editor.getByText('周末公园观察', { exact: true }).click();
  await top.getByRole('button', { name: '标题等级', exact: true }).click();
  await page.getByRole('menuitem', { name: '二级标题 (H2)', exact: true }).click();
  await done();
  await newParagraph(); await insertMenu();
  await page.getByRole('menuitem', { name: '提示块', exact: true }).first().hover();
  await page.getByRole('menuitem', { name: '说明', exact: true }).click();
  await page.keyboard.insertText('记得带水');
  await done();
  await newParagraph(); await insertMenu();
  await page.getByRole('menuitem', { name: '折叠块', exact: true }).click();
  await page.getByRole('textbox', { name: '折叠块标题', exact: true }).fill('装备清单');
  await editor.locator('.nb-disclosure-body p').last().click();
  await page.keyboard.insertText('温度计');
  await done();
  await newParagraph(); await insertMenu();
  await page.getByRole('menuitem', { name: '表格', exact: true }).hover();
  await page.getByRole('menuitem', { name: '紧凑表格 (2x2)', exact: true }).click();
  const cells = editor.locator('table').last().locator('th,td');
  for (const [index, text] of ['项目', '记录', '天气', '晴'].entries()) { await cells.nth(index).click(); await page.keyboard.insertText(text); }
  await done();
  await cells.first().click();
  await page.getByRole('button', { name: '表格样式', exact: true }).first().click();
  await page.getByRole('menuitemradio', { name: '三线表', exact: true }).click();
  await done();
  await newParagraph(); await insertMenu();
  await page.getByRole('menuitem', { name: '公式与图表', exact: true }).hover();
  await page.getByRole('menuitem', { name: '行内公式 ($...$)', exact: true }).click();
  await page.getByRole('textbox', { name: '行内公式源码', exact: true }).fill('x^2+y^2=r^2');
  await page.keyboard.press('Enter');
  await done();
  await selectText(observation, '一次散步，也可以成为一份有趣的笔记。', '观察与记录');
  await page.getByRole('toolbar', { name: '文字工具栏', exact: true }).getByRole('button', { name: '添加说明', exact: true }).click();
  const note = page.getByRole('dialog', { name: '补充说明', exact: true });
  await note.locator('.nb-annotation-richtext[contenteditable=true]').click();
  await page.keyboard.insertText('把每一次发现记下来，方便日后比较。');
  await note.getByRole('button', { name: '保存', exact: true }).click();
  await note.getByRole('button', { name: '关闭说明', exact: true }).click();
  await done();
  const actionText = '行动建议：下次带上温度计，比较不同位置。';
  await selectText(editor.getByText(actionText, { exact: true }), '', actionText);
  const cut = await editor.evaluate(element => {
    const data = new DataTransfer(); element.dispatchEvent(new ClipboardEvent('cut', { bubbles: true, cancelable: true, clipboardData: data }));
    return Object.fromEntries([...data.types].map(type => [type, data.getData(type)]));
  });
  assert(Object.keys(cut).some(key => key.includes('noteboard')));
  await editor.getByText('观察结论：树荫下比开阔草地更凉爽。', { exact: true }).click();
  await frames();
  await page.keyboard.press('Home'); await frames();
  await editor.evaluate((element, data) => {
    const transfer = new DataTransfer(); for (const [type, text] of Object.entries(data)) transfer.setData(type, text);
    element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }));
  }, cut);
  // A text-only cut joins the destination paragraph. Split at the inserted
  // text's trailing caret so the moved text remains a separate block.
  await frames(); await page.keyboard.press('Enter'); await frames();
  await done();
  await editor.getByText('期待下一次散步。', { exact: true }).click(); await page.keyboard.press('End');
  await page.keyboard.insertText(' 新记录');
  await top.getByRole('button', { name: '撤销', exact: true }).click();
  await panel.getByText('已撤销，现在重做让修改恢复', { exact: true }).waitFor();
  await top.getByRole('button', { name: '重做', exact: true }).click();
  await done();
  assert.equal(result.steps.length, 11);
  assert((await panel.innerText()).includes('完成 11 项，跳过 0 项'));
  await page.screenshot({ path: `${directory}/complete.png` });
  // Navigating to Home pauses the practice observer; returning resumes the same tab.
  const tabsBefore = await page.getByRole('button', { name: /^关闭 公园观察练习/ }).count();
  await page.getByRole('button', { name: '回到主界面', exact: true }).click();
  await page.getByRole('button', { name: '动手试一试', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: /^关闭 公园观察练习/ }).count(), tabsBefore);
  assert((await panel.innerText()).includes('完成 11 项'));
  await panel.getByRole('button', { name: '结束练习', exact: true }).click();
  assert.equal(await panel.count(), 0);

  for (const theme of cdpUrl ? [] : ['chen-guang', 'hu-po', 'mo-ye']) {
    const themePage = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
    await installBrowserNativeShell(themePage, { theme });
    themePage.on('pageerror', error => result.errors.push(error.message));
    await themePage.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
    try {
      await themePage.goto(origin);
      await themePage.getByRole('button', { name: '动手试一试', exact: true }).click();
      await themePage.getByRole('complementary', { name: '互动练习' }).waitFor();
      await themePage.locator('.nb-prose.ProseMirror:visible > p').first().click();
      await themePage.locator('.responsive-toolbar').first().getByRole('button', { name: /^插入超链接/ }).click();
      await themePage.getByRole('menuitem', { name: '折叠块', exact: true }).hover();
      const help = themePage.locator('[data-help-key="block.disclosure"]'); await help.waitFor();
      const box = await help.boundingBox(); assert(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= 1281 && box.y + box.height <= 901);
      await help.hover(); assert(await help.isVisible(), 'Rich help stays open while reading its card');
      assert.equal(await help.locator('svg').count(), 1);
      await themePage.screenshot({ path: `${directory}/help-${theme}.png` });
      await themePage.keyboard.press('Escape');
      assert.equal(await help.count(), 0);
      result.themes.push(theme);
    } finally { await themePage.close(); }
  }
  for (const layout of cdpUrl ? [] : [{ width: 960, height: 720, uiScale: 100 }, { width: 1920, height: 1080, uiScale: 200 }]) {
    // The desktop scale changes the CSS viewport; an IPC stub cannot zoom a
    // browser WebView. Reproduce the same physical size and effective CSS size.
    const scale = layout.uiScale / 100;
    const viewport = { width: Math.round(layout.width / scale), height: Math.round(layout.height / scale) };
    const layoutPage = await browser.newPage({ viewport, deviceScaleFactor: scale, reducedMotion: 'reduce' });
    await installBrowserNativeShell(layoutPage, { uiScale: layout.uiScale });
    await layoutPage.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
    layoutPage.on('pageerror', error => result.errors.push(error.message));
    try {
      await layoutPage.goto(origin);
      await layoutPage.getByRole('button', { name: '动手试一试', exact: true }).click();
      const practice = layoutPage.getByRole('complementary', { name: '互动练习', exact: true });
      await practice.waitFor();
      const box = await practice.boundingBox();
      assert(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1);
      await practice.getByRole('button', { name: '跳过此项', exact: true }).click();
      await practice.getByRole('heading', { name: '给文字加高亮', exact: true }).waitFor();
      await layoutPage.screenshot({ path: `${directory}/layout-${layout.width}-${layout.uiScale}.png` });
      await practice.getByRole('button', { name: '收起练习任务', exact: true }).click();
      await practice.getByRole('button', { name: '展开练习任务', exact: true }).click();
      await practice.getByRole('button', { name: '退出练习', exact: true }).click();
      assert.equal(await practice.count(), 0);
      result.layouts.push(layout);
    } finally { await layoutPage.close(); }
  }
  assert.deepEqual(result.errors, []);
  console.log(JSON.stringify(result));
} catch (error) {
  if (page) await page.screenshot({ path: `${directory}/failure.png` });
  console.error('Runtime errors:', result.errors); throw error;
} finally {
  await fs.writeFile(`${directory}/results.json`, JSON.stringify(result, null, 2));
  await browser.close(); await server.close();
}
