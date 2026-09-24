import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { performance } from 'node:perf_hooks';
import { build } from 'vite';
import assert from 'node:assert/strict';

// Isolated production-module measurement. PDF printing here is Chromium's
// print engine, not the native WebView2 IPC/session creation time.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH ?? 'C:/Users/dell/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = process.cwd();
const dir = path.join(root, '.tmp/export-preview-measure');
const sourcePath = process.argv.find(arg => arg.endsWith('.md')) ?? path.resolve(root, '../../outputs/NoteBoard-export-stress.md');
await fs.mkdir(dir, { recursive: true });
if (!process.argv.includes('--reuse-build')) {
  await fs.cp(path.join(root, 'src'), path.join(dir, 'src'), { recursive: true });
  await fs.writeFile(path.join(dir, 'index.html'), '<html><head><meta charset="utf-8"></head><body><main id="document"></main><script type="module" src="./entry.ts"></script></body></html>');
  await fs.writeFile(path.join(dir, 'entry.ts'), `
import {renderDocument} from './src/features/export/renderDocument';
import {createLayoutSession} from './src/features/export/layout';
import {DEFAULT_PDF} from './src/features/export/model';
import './src/features/export/document.css';
window.exportMeasure = {
  async prepare(markdown) {
    const start = performance.now();
    const result = await renderDocument(markdown, '导出压力样本', '');
    const converted = performance.now();
    const root = document.querySelector('#document'); root.innerHTML = result.html;
    document.documentElement.style.cssText = '--export-font:10.5pt;--export-line:1.4;--export-width:186mm';
    await document.fonts.ready;
    const mounted = performance.now();
    this.layout = createLayoutSession(root);
    this.items = result.items;
    return { conversionMs: converted-start, mountFontsMs: mounted-converted, indexMs: performance.now()-mounted, htmlBytes: result.html.length*2, items: result.items.length };
  },
  async update(item) {
    const start = performance.now();
    const report = await this.layout.update(item ? {...DEFAULT_PDF, items: {[item]: 'fit'}} : DEFAULT_PDF);
    return { layoutMs: performance.now()-start, report, nodes: document.querySelectorAll('*').length };
  }
};
`);
  await build({ configFile: false, root: dir, base: './', worker: { format: 'es' }, build: { outDir: path.join(dir, 'dist'), emptyOutDir: false, minify: false }, logLevel: 'warn' });
}
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost').pathname;
    const file = url === '/' ? 'index.html' : url;
    res.setHeader('Content-Type', mime[path.extname(file)] ?? 'application/octet-stream');
    res.end(await fs.readFile(path.join(dir, 'dist', file)));
  } catch { res.statusCode = 404; res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 1100 } });
  const errors = []; page.on('pageerror', error => errors.push(String(error)));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.exportMeasure);
  const preparation = await page.evaluate(md => window.exportMeasure.prepare(md), await fs.readFile(sourcePath, 'utf8'));
  console.log(JSON.stringify({ preparation }));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.start');
  const initial = await page.evaluate(() => window.exportMeasure.update());
  const { profile } = await cdp.send('Profiler.stop');
  await fs.writeFile(path.join(dir, 'layout.cpuprofile'), JSON.stringify(profile));
  console.log(JSON.stringify({ initial }));
  const tracing = process.argv.includes('--trace-print');
  if (tracing) await cdp.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline', transferMode: 'ReturnAsStream' });
  const start = performance.now();
  await page.pdf({ path: path.join(dir, 'preview.pdf'), format: 'A4', printBackground: true, margin: { top: '12mm', bottom: '12mm', left: '12mm', right: '12mm' } });
  const printMs = performance.now() - start;
  if (tracing) {
    const completed = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve));
    await cdp.send('Tracing.end');
    const { stream } = await completed;
    const file = await fs.open(path.join(dir, 'print-trace.json'), 'w');
    try {
      for (;;) {
        const chunk = await cdp.send('IO.read', { handle: stream, size: 1024 * 1024 });
        await file.write(chunk.base64Encoded ? Buffer.from(chunk.data, 'base64') : chunk.data);
        if (chunk.eof) break;
      }
    } finally { await file.close(); await cdp.send('IO.close', { handle: stream }); }
  }
  const local = await page.evaluate(() => window.exportMeasure.update('formula-1'));
  const ui = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  await ui.setContent(`<style>:root{--editor-bg:white;--editor-text:#18202b;--editor-border:#dce1e9;--ui-font-family:Arial,sans-serif}*{box-sizing:border-box}${await fs.readFile(path.join(root, 'src/features/export/export.css'), 'utf8')}</style>
    <div class="export-backdrop"><div class="export-dialog"><header>导出</header><div class="export-body"><aside><section class="export-item-settings"><h4>超宽内容</h4><div class="export-item-list">${Array.from({ length: 50 }, (_, i) => `<button>公式 ${i + 1} · 长公式与表格的排版设置</button>`).join('')}</div></section></aside><main></main></div><footer>78 页</footer></div></div>`);
  const list = await ui.evaluate(() => {
    const root = document.querySelector('.export-item-list');
    const buttons = [...root.querySelectorAll('button')];
    root.scrollTop = root.scrollHeight;
    return { height: root.clientHeight, scrollHeight: root.scrollHeight,
      minimumRowHeight: Math.min(...buttons.map(button => button.getBoundingClientRect().height)),
      lastVisible: buttons.at(-1).getBoundingClientRect().bottom <= root.getBoundingClientRect().bottom + 1 };
  });
  assert.ok(list.scrollHeight > list.height && list.minimumRowHeight >= 32 && list.lastVisible);
  await ui.screenshot({ path: path.join(dir, 'export-list.png') });
  await ui.close();
  const result = { sourcePath, preparation, initial, printMs, local, list, errors };
  await fs.writeFile(path.join(dir, 'results.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ printMs, local, list, errors }));
} finally { await browser.close(); server.close(); }
