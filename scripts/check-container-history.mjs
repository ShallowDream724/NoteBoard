/* global window */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build, preview } from 'vite';
import react from '@vitejs/plugin-react';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const outDir = '.tmp/container-history-dist';
await build({ configFile: false, plugins: [react()], worker: { format: 'es' },
  build: { outDir, emptyOutDir: true, rollupOptions: { input: 'test/browser/containerHistory.html' } }, logLevel: 'error' });
const server = await preview({ configFile: false, build: { outDir }, preview: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/test/browser/containerHistory.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.containerHistoryQA);
  const mount = async blocks => {
    await page.evaluate(value => window.containerHistoryQA.mount(value), blocks);
    await page.waitForFunction(() => window.containerHistoryQA.ready());
    await page.locator('.ProseMirror').waitFor();
  };
  const state = () => page.evaluate(() => window.containerHistoryQA.state());
  const check = async (expected, label) => {
    const actual = await state();
    for (const [key, value] of Object.entries(expected)) assert.deepEqual(actual[key], value, `${label}: ${key}`);
  };
  const typePrecedingText = async () => {
    await page.evaluate(() => window.containerHistoryQA.focusFirstParagraphEnd());
    await page.keyboard.type(' text');
    await check({ text: 'Before text' }, 'preceding text input');
  };
  const initial = [{ type: 'paragraph', content: [{ type: 'text', text: 'Before' }] }];

  await mount(initial);
  await typePrecedingText();
  await page.evaluate(() => window.containerHistoryQA.insertCode());
  await page.keyboard.type('AAA');
  await check({ code: ['AAA'] }, 'code physical typing');
  await page.keyboard.press('Control+z');
  await check({ code: [''] }, 'code undo input');
  await page.keyboard.press('Control+z');
  await check({ code: [], text: 'Before text' }, 'code undo creation');
  await page.keyboard.press('Control+z');
  await check({ text: 'Before' }, 'code undo preceding text');
  for (let step = 0; step < 3; step++) await page.keyboard.press('Control+y');
  await check({ text: 'Before text', code: ['AAA'] }, 'code redo chain');

  // Chromium composition uses the real contenteditable DOM, including async
  // highlighting and gutter updates. It does not emulate a vendor IME itself.
  await mount([{ type: 'codeBlock', attrs: { language: 'python' }, content: [{ type: 'text', text: 'print(1)\n' }] }]);
  await page.evaluate(() => window.containerHistoryQA.focusCode(true));
  const cdp = await page.context().newCDPSession(page);
  const compose = async (preedit, committed) => {
    for (const text of preedit) {
      await cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length });
      await page.waitForTimeout(45);
      assert((await state()).composing, 'presentation updates must preserve composition');
    }
    await cdp.send('Input.insertText', { text: committed });
    await page.waitForFunction(() => !window.containerHistoryQA.state().composing);
    await page.waitForTimeout(100);
  };
  await compose(['w', 'wo', "wo's", "wo'shi"], '我是123');
  await check({ code: ['print(1)\n我是123'] }, 'code first Chinese composition');
  await page.waitForTimeout(550);
  await compose(['z', 'zhong'], '中文');
  await check({ code: ['print(1)\n我是123中文'] }, 'code repeated composition');
  await page.keyboard.press('Control+z');
  await check({ code: ['print(1)\n我是123'] }, 'Chinese composition undo');
  await page.keyboard.press('Control+y');
  await check({ code: ['print(1)\n我是123中文'] }, 'Chinese composition redo');
  await cdp.detach();

  await mount(initial);
  await typePrecedingText();
  await page.keyboard.type(' /h1');
  await page.getByRole('button', { name: /^一级标题 \(H1\)/ }).click();
  const heading = (await state()).doc;
  assert.equal(heading.content[0].type, 'heading');
  await page.keyboard.press('Control+z');
  assert.equal((await state()).doc.content[0].type, 'paragraph');
  assert(!(await page.getByText('搜索 · h1', { exact: true }).count()), 'undo must close command menu');
  await page.keyboard.press('Control+y');
  assert.deepEqual((await state()).doc, heading, 'redo restores complete slash command');
  await page.evaluate(() => window.containerHistoryQA.focusFirstParagraphEnd());
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
  const beforeCut = (await state()).doc;
  await page.keyboard.press('Control+x');
  assert.notDeepEqual((await state()).doc, beforeCut, 'Ctrl+X still cuts selected text');
  await page.keyboard.press('Control+z');
  assert.deepEqual((await state()).doc, beforeCut, 'cut undo');
  await page.keyboard.press('Control+y');
  assert.notDeepEqual((await state()).doc, beforeCut, 'cut redo');

  await mount(initial);
  await typePrecedingText();
  await page.evaluate(() => window.containerHistoryQA.insertMermaid());
  await page.waitForFunction(() => window.containerHistoryQA.state().sourceFocused);
  const template = (await state()).mermaid[0];
  await page.keyboard.type('AAA');
  assert((await state()).mermaid[0].includes('AAA'), 'new Mermaid source must accept physical typing');
  await page.keyboard.press('Control+z');
  await check({ mermaid: [template], sourceOpen: true, sourceFocused: true }, 'Mermaid undo source');
  await page.keyboard.press('Control+z');
  await check({ mermaid: [template], sourceOpen: false }, 'Mermaid exit edit mode');
  await page.keyboard.press('Control+z');
  await check({ mermaid: [], text: 'Before text' }, 'Mermaid undo creation');
  await page.keyboard.press('Control+z');
  await check({ text: 'Before' }, 'Mermaid undo preceding text');
  for (let step = 0; step < 3; step++) await page.keyboard.press('Control+y');
  assert((await state()).mermaid[0].includes('AAA'), 'Mermaid redo must restore source');

  const original = 'graph TD\n  A --> B';
  await mount([...initial, { type: 'mermaidBlock', attrs: { code: original } }]);
  await typePrecedingText();
  await page.getByRole('button', { name: '编辑图表源码' }).click();
  await page.waitForFunction(() => window.containerHistoryQA.state().sourceFocused);
  await page.keyboard.type('AAA');
  assert((await state()).mermaid[0].includes('AAA'), 'existing Mermaid source must accept physical typing');
  await page.keyboard.press('Control+z');
  await check({ mermaid: [original], sourceOpen: true, sourceFocused: true }, 'existing Mermaid undo source');
  await page.keyboard.press('Control+z');
  await check({ mermaid: [original], sourceOpen: false }, 'existing Mermaid exit edit mode');
  await page.keyboard.press('Control+z');
  await check({ mermaid: [original], text: 'Before' }, 'existing Mermaid undo preceding text');

  assert.deepEqual(errors, [], 'browser errors');
  console.log(JSON.stringify({ passed: true, scenarios: ['code physical typing/undo/redo', 'code Chromium IME composition', 'slash command undo/redo and cut', 'new Mermaid source/edit/creation/preceding history', 'existing Mermaid source/edit/preceding history'] }));
} finally {
  await browser.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
