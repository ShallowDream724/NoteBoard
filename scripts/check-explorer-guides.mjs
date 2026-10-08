/* global window, document, getComputedStyle */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { preview } from 'vite';
import { installBrowserNativeShell } from './browser-native-shell.mjs';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = '.tmp/explorer-guides';
await fs.mkdir(out, { recursive: true });
const server = await preview({ configFile: false, build: { outDir: 'dist' }, preview: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 2 });
const page = await context.newPage();
const base = 'C:/qa/Codex-tree';
const outputPath = `${base}/outputs`, samples = `${outputPath}/File-Text-Samples`, releases = `${outputPath}/releases`, version = `${releases}/1.0.1`;
const report = { productionBundle: true, boundary: 'Filesystem IPC is mocked; tree components, CSS, tooltip and input behavior are real.', errors: [] };
page.on('pageerror', error => report.errors.push(String(error)));
await installBrowserNativeShell(page);
await page.addInitScript(({ base, outputPath, samples, releases, version }) => {
  const original = window.__TAURI_INTERNALS__.invoke;
  const normalized = path => path.replace(/\\/g, '/').toLowerCase();
  const entry = (path, isDir = false) => ({ path, name: path.split('/').at(-1), isDir, kind: null, size: isDir ? 0 : 50, mtime: 1, isHidden: false, isSymlink: false });
  const directories = new Map([
    [base, [entry(outputPath, true)]],
    [outputPath, [entry(samples, true), entry(releases, true), entry(`${outputPath}/closed-folder`, true)]],
    [samples, ['README.md', 'main.go', 'settings.json'].map(name => entry(`${samples}/${name}`))],
    [releases, [entry(version, true)]],
    [version, ['NoteBoard_1.0.1_x64-setup.exe', 'SHA256SUMS.txt', 'verification.json'].map(name => entry(`${version}/${name}`))],
  ].map(([path, entries]) => [normalized(path), entries]));
  window.__qaDirectoryReads = [];
  window.__TAURI_INTERNALS__.invoke = async (command, args) => {
    if (command === 'plugin:dialog|open') return args?.options?.directory ? base : null;
    if (command === 'read_native_headers') return [];
    if (command === 'read_dir') { window.__qaDirectoryReads.push(args.path); return directories.get(normalized(args.path)) ?? []; }
    if (command === 'register_document') return { type: 'ok' };
    if (command === 'prepare_document') return { type: 'text', payload: { key: args.path, displayName: 'README.md', dirPath: samples,
      kind: 'code', language: 'plaintext', content: 'File tree guide example', encoding: 'utf8', eol: 'lf', size: 23, mtime: 1, readonly: false } };
    return original(command, args);
  };
}, { base, outputPath, samples, releases, version });

const row = path => page.locator('[data-explorer-row]').filter({ has: page.locator('span') }).filter({ hasText: path.split('/').at(-1) }).first();
const moveOutside = () => page.mouse.move(1000, 700);
const captureTree = async name => {
  const tree = await page.locator('.nb-explorer-tree').boundingBox();
  const lastRow = await page.locator('[data-explorer-row]').last().boundingBox();
  await page.screenshot({ path: `${out}/${name}.png`, clip: { x: tree.x, y: tree.y, width: tree.width,
    height: Math.min(tree.height, lastRow.y + lastRow.height - tree.y + 16) } });
};
const snapshot = () => page.evaluate(() => Array.from(document.querySelectorAll('[data-explorer-branch]'), group => {
  const before = getComputedStyle(group, '::before'), rect = group.getBoundingClientRect();
  const header = group.parentElement.querySelector('[data-explorer-row] .nb-explorer-disclosure');
  const arrow = header.getBoundingClientRect();
  return { path: group.getAttribute('data-explorer-branch'), active: group.hasAttribute('data-active-branch'),
    opacity: Number(before.opacity), color: before.backgroundColor, width: before.width, pointerEvents: before.pointerEvents,
    guideCenter: rect.left + parseFloat(before.left) + parseFloat(before.width) / 2,
    arrowCenter: arrow.left + arrow.width / 2, height: rect.height, fill: getComputedStyle(header).fill };
}));
const visible = values => values.filter(value => value.opacity === 1).map(value => value.path.replace(/\\/g, '/'));
const verifyGeometry = values => {
  for (const value of values) {
    assert.equal(value.width, '1px'); assert.equal(value.pointerEvents, 'none'); assert.equal(value.fill, 'none');
    assert(Math.abs(value.guideCenter - value.arrowCenter) <= 0.75, `Guide and disclosure differ: ${value.path}`);
    assert(value.height > 0);
  }
};

try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
  await page.getByRole('button', { name: '新建或打开', exact: true }).click();
  await page.getByRole('menuitem', { name: /打开文件夹/ }).click();
  for (const path of [outputPath, samples, releases, version]) {
    await row(path).click();
    await page.locator('[data-explorer-branch]').filter({ has: row(path === version ? `${version}/SHA256SUMS.txt` : path === releases ? version : path === samples ? `${samples}/README.md` : samples) }).first().waitFor();
  }
  await moveOutside();
  report.selectedFolder = await snapshot(); verifyGeometry(report.selectedFolder);
  assert.deepEqual(visible(report.selectedFolder), [releases]);
  await captureTree('folder-default');

  await row(`${samples}/README.md`).click();
  await page.getByRole('button', { name: '关闭 README.md', exact: true }).waitFor();
  await moveOutside();
  report.selectedFile = await snapshot(); verifyGeometry(report.selectedFile);
  assert.deepEqual(visible(report.selectedFile), [samples]);
  await captureTree('file-default');

  const readsBefore = await page.evaluate(() => window.__qaDirectoryReads.length);
  await row(samples).hover();
  report.hover = await snapshot(); verifyGeometry(report.hover);
  assert.equal(visible(report.hover).length, 4);
  await page.getByRole('tooltip').filter({ hasText: /File-Text-Samples/ }).waitFor();
  report.tooltip = await page.getByRole('tooltip').filter({ hasText: /File-Text-Samples/ }).innerText();
  assert(report.tooltip.replace(/\\/g, '/').includes(samples));
  await page.screenshot({ path: `${out}/all-guides-and-address.png` });
  for (let i = 0; i < 12; i++) { await moveOutside(); await row(samples).hover(); }
  assert.equal(await page.evaluate(() => window.__qaDirectoryReads.length), readsBefore);
  await moveOutside(); assert.deepEqual(visible(await snapshot()), [samples]);
  report.hoverAddedDirectoryReads = 0;

  await row(version).click(); // Fold the folder, then reopen it with the keyboard.
  await page.keyboard.press('ArrowRight');
  await page.locator('[data-explorer-row]').filter({ hasText: 'SHA256SUMS.txt' }).waitFor();
  await page.keyboard.press('Tab');
  report.keyboard = await snapshot();
  assert.equal(visible(report.keyboard).length, 4);
  await row(`${samples}/README.md`).click(); await moveOutside();
  assert.deepEqual(visible(await snapshot()), [samples]);

  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  report.dark = await snapshot(); verifyGeometry(report.dark);
  await captureTree('dark-default');
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  await row(samples).hover(); await page.keyboard.down('Control'); await page.mouse.wheel(0, -100); await page.keyboard.up('Control');
  report.scaled = await snapshot(); verifyGeometry(report.scaled);
  await page.setViewportSize({ width: 680, height: 540 });
  await page.mouse.move(600, 480);
  report.narrow = await snapshot(); verifyGeometry(report.narrow);
  await captureTree('narrow-scaled');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await page.locator('.nb-explorer-disclosure').first().evaluate(element => getComputedStyle(element).transitionDuration), '0s');
  assert.equal(report.errors.length, 0);
  report.passed = true;
} finally {
  if (!report.passed) await page.screenshot({ path: `${out}/failure.png` }).catch(() => {});
  await fs.writeFile(`${out}/results.json`, JSON.stringify(report, null, 2));
  await browser.close(); await server.httpServer.close();
}
console.log(JSON.stringify({ passed: report.passed, out }));
