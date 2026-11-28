/* global window, document, TextEncoder */
// Run against a fresh production build: node scripts/check-external-change-banner.mjs [outDir]
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { preview } from 'vite';
import { installBrowserNativeShell } from './browser-native-shell.mjs';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const modes = {
  visual: { viewport: '[data-editor-scroll="markdown"]:visible', content: '.nb-prose.ProseMirror:visible' },
  source: { viewport: '.nb-markdown-source:visible', content: '.nb-markdown-source .cm-content:visible' },
};
const reloadName = '重新加载';
const overwriteName = '覆盖磁盘文件';
const root = 'C:/qa/External-Change';
const filename = 'conflict.md';
const key = `${root}/${filename}`;
const initial = 'Original Markdown';
const outDir = process.argv[2] || 'dist';
const server = await preview({ configFile: false, build: { outDir }, preview: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });

async function installFileFixture(page) {
  await installBrowserNativeShell(page);
  await page.addInitScript(({ root, filename, key, initial }) => {
    const { invoke } = window.__TAURI_INTERNALS__;
    const watches = new Map();
    let mtime = 1;
    let defer;
    const qa = window.externalChangeQA = {
      disk: initial,
      writes: [],
      reads: [],
      watching: false,
      pending: null,
      changeDisk(content) {
        qa.disk = content;
        mtime++;
        for (const callback of watches.values()) callback({ paths: [key] });
      },
      deferNext(command) { defer = command; },
      release: null,
    };
    const metadata = () => ({ mtime, size: new TextEncoder().encode(qa.disk).length });
    const payload = () => ({ key, displayName: filename, dirPath: root, kind: 'markdown', language: 'markdown', content: qa.disk, encoding: 'utf8', eol: 'lf', readonly: false, ...metadata() });
    window.__TAURI_INTERNALS__.invoke = async (command, args) => {
      if (defer === command) {
        defer = null;
        qa.pending = command;
        await new Promise(resolve => { qa.release = resolve; });
        qa.pending = null;
        qa.release = null;
      }
      switch (command) {
        case 'plugin:dialog|open': return root;
        case 'path_exists': return { exists: args.path === root || args.path === key, isDir: args.path === root };
        case 'read_dir': return [{ path: key, name: filename, kind: 'markdown', isDir: false, isHidden: false, isSymlink: false, ...metadata() }];
        case 'read_native_headers': return [];
        case 'prepare_document': return { type: 'text', payload: payload() };
        case 'register_document': return { type: 'ok' };
        case 'plugin:fs|watch': {
          const id = args.onEvent.id;
          watches.set(id, args.onEvent.onmessage);
          qa.watching = true;
          return id;
        }
        case 'plugin:resources|close': watches.delete(args.rid); return null;
        case 'read_document': qa.reads.push(qa.disk); return payload();
        case 'write_document':
          qa.writes.push({ path: args.path, content: args.content });
          qa.disk = args.content;
          mtime++;
          return { ok: true, error: null, ...metadata() };
        default: return invoke(command, args);
      }
    };
  }, { root, filename, key, initial });
}

async function actionPoints(page) {
  const points = [];
  for (const name of [overwriteName, reloadName]) {
    const hit = await page.getByRole('button', { name, exact: true }).evaluate(button => {
      const { left, right, top, bottom } = button.getBoundingClientRect();
      const x = (left + right) / 2;
      const y = (top + bottom) / 2;
      const hits = [left + 3, x, right - 3].map(sampleX => {
        const target = document.elementFromPoint(sampleX, y);
        return button.contains(target) ? null : target?.className || target?.tagName || '(outside viewport)';
      });
      return { x, y, bottom, hits };
    });
    points.push({ name, ...hit });
  }
  assert(points.every(point => point.hits.every(hit => hit === null)), `Banner buttons are obscured: ${JSON.stringify(points)}`);
  return points;
}

async function beginConflict(page, content, edited, disk) {
  await content.focus();
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText(edited);
  assert.equal((await content.innerText()).trim(), edited);
  await page.evaluate(disk => window.externalChangeQA.changeDisk(disk), disk);
  await page.getByRole('button', { name: reloadName, exact: true }).waitFor();
  return actionPoints(page);
}

async function resolveConflict(page, point, command, pendingName, otherName) {
  await page.evaluate(command => window.externalChangeQA.deferNext(command), command);
  await page.mouse.click(point.x, point.y);
  await page.waitForFunction(command => window.externalChangeQA.pending === command, command);
  for (const name of [pendingName, otherName]) {
    assert(await page.getByRole('button', { name, exact: true }).isDisabled(), `${name} must be disabled during ${command}`);
  }
  await page.evaluate(() => window.externalChangeQA.release());
  await page.getByRole('button', { name: reloadName, exact: true }).waitFor({ state: 'detached' });
  await page.getByRole('button', { name: overwriteName, exact: true }).waitFor({ state: 'detached' });
}

async function checkMode(browser, mode, width) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  page.setDefaultTimeout(7000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await installFileFixture(page);
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
    await page.getByRole('button', { name: '新建或打开', exact: true }).click();
    await page.getByRole('menuitem', { name: /打开文件夹/ }).click();
    await page.locator('[data-explorer-row]').filter({ hasText: filename }).dblclick();
    await page.waitForFunction(() => window.externalChangeQA.watching);
    await page.locator(modes.visual.content).waitFor();
    if (mode === 'source') await page.getByRole('button', { name: '切换为源码模式', exact: true }).click();
    await page.setViewportSize({ width, height: 800 });
    const content = page.locator(modes[mode].content);
    assert.equal((await content.innerText()).trim(), initial);

    const externalReload = 'Markdown written externally before reload';
    const [, reload] = await beginConflict(page, content, 'Unsaved Markdown before reload', externalReload);
    const viewport = await page.locator(modes[mode].viewport).boundingBox();
    assert(viewport.y >= reload.bottom, 'The editor viewport starts below the banner');
    const reads = await page.evaluate(() => window.externalChangeQA.reads.length);
    await resolveConflict(page, reload, 'read_document', '正在加载…', overwriteName);
    assert.deepEqual(await page.evaluate(reads => window.externalChangeQA.reads.slice(reads), reads), [externalReload]);
    assert.equal((await content.innerText()).trim(), externalReload);
    assert.deepEqual(await page.evaluate(() => window.externalChangeQA.writes), []);

    const localOverwrite = 'Unsaved Markdown kept by overwrite';
    const [overwrite] = await beginConflict(page, content, localOverwrite, 'Markdown written externally before overwrite');
    await resolveConflict(page, overwrite, 'write_document', '正在覆盖…', reloadName);
    const written = await page.evaluate(() => ({ disk: window.externalChangeQA.disk, writes: window.externalChangeQA.writes }));
    assert.equal(written.disk, localOverwrite);
    assert.deepEqual(written.writes, [{ path: key, content: localOverwrite }]);
    assert.deepEqual(errors, []);
    console.log(`Passed ${mode} at ${width}px: reload and overwrite receive physical clicks, disable both actions during IPC, and apply the correct content.`);
  } catch (error) {
    throw new Error(`${mode} at ${width}px: ${error.message}`, { cause: error });
  } finally {
    await page.close();
  }
}

try {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const results = await Promise.allSettled([1200, 680].flatMap(width => Object.keys(modes).map(mode => checkMode(browser, mode, width))));
    const failures = results.filter(result => result.status === 'rejected').map(result => result.reason);
    if (failures.length) throw new AggregateError(failures, 'Markdown external-change banner browser checks failed');
  } finally {
    await browser.close();
  }
} finally {
  await new Promise(resolve => server.httpServer.close(resolve));
}
