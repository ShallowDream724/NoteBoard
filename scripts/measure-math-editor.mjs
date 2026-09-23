// Diagnostic comparison against the installed source version, isolated from app edits.
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/dell/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const repo = process.cwd(), dir = path.join(repo, '.tmp/math-editor-measure');
await fs.mkdir(dir, { recursive: true });
if (!process.argv.includes('--reuse-build')) {
    execFileSync('tar', ['-x'], { cwd: dir, input: execFileSync('git', ['archive', '3c129ad', 'src'], { cwd: repo, maxBuffer: 64 * 1024 * 1024 }), maxBuffer: 64 * 1024 * 1024 });
    const preview = path.join(dir, 'src/features/editor-md/mathPreview.ts');
    let source = await fs.readFile(preview, 'utf8');
    // Controlled diagnostic branch only: keep all previews mounted, changing no math.
    source = source.replace('const stopNear = observeNearby(host,', 'const stopNear = window.__benchEager ? (show(), () => {}) : observeNearby(host,');
    await fs.writeFile(preview, source);
    await fs.writeFile(path.join(dir, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="./entry.tsx"></script></body></html>');
    await fs.copyFile(path.join(repo, 'scripts/measure-math-editor-browser.tsx'), path.join(dir, 'entry.tsx'));
    await build({ configFile: false, root: dir, base: './', worker: { format: 'es' }, plugins: [react(), tailwindcss()], resolve: { alias: { '@': path.join(dir, 'src') } }, build: { outDir: path.join(dir, 'dist'), emptyOutDir: false, minify: true }, logLevel: 'warn' });
}
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const server = createServer(async (req, res) => { try {
    const p = new URL(req.url, 'http://localhost').pathname;
    res.setHeader('Content-Type', mime[path.extname(p)] ?? 'text/html');
    res.end(await fs.readFile(path.join(dir, 'dist', p === '/' ? 'index.html' : p)));
}
catch {
    res.statusCode = 404;
    res.end();
} });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const results = [];
const atlas = await fs.readFile(path.resolve(repo, '../../outputs/NoteBoard-math-atlas.md'), 'utf8');
try {
    for (const eager of [false, true, false, true]) {
        const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(String(e)));
        page.setDefaultTimeout(120000);
        await page.addInitScript(eager => { window.__benchEager = eager; window.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: 'measure' }, currentWebview: { label: 'measure' } }, invoke: async () => null, transformCallback: () => 0, convertFileSrc: p => p }; }, eager);
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        await page.waitForFunction(() => !!window.editorBench);
        const mount = await page.evaluate(md => window.editorBench.mount(md), atlas);
        if (eager)
            await page.waitForFunction(() => document.querySelectorAll('.math-preview .katex').length === 466);
        else
            await page.waitForFunction(() => document.querySelectorAll('.math-preview .katex').length >= 4);
        const cdp = await context.newCDPSession(page);
        await cdp.send('Performance.enable');
        await cdp.send('Profiler.enable');
        await cdp.send('Profiler.start');
        const before = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x => [x.name, x.value]));
        const scroll = await page.evaluate(async (continuous) => {
            if (!continuous)
                return window.editorBench.scroll();
            const host = document.querySelector('#root');
            await document.fonts.ready;
            const frame = () => new Promise(r => requestAnimationFrame(r));
            const gaps = [];
            const tasks = [];
            const observer = new PerformanceObserver(list => tasks.push(...list.getEntries().map(e => e.duration)));
            observer.observe({ type: 'longtask' });
            const start = performance.now(), startHeight = host.scrollHeight;
            let previous = await frame();
            for (let pass = 0; pass < 2; pass++)
                for (let step = 0; step < 100; step++) {
                    host.scrollTop = (pass ? 100 - step : step) * 180;
                    const now = await frame();
                    gaps.push(now - previous);
                    previous = now;
                }
            observer.disconnect();
            gaps.sort((a, b) => a - b);
            return { mode: '180 CSS px per frame', ms: performance.now() - start, gaps: { n: gaps.length, p50: gaps[100], p95: gaps[190], max: gaps.at(-1), over33: gaps.filter(x => x > 33).length, over50: gaps.filter(x => x > 50).length }, tasks, startHeight, endHeight: host.scrollHeight, mountedFormulaCount: host.querySelectorAll('.math-preview .katex').length, elements: host.querySelectorAll('*').length };
        }, process.argv.includes('--continuous'));
        const after = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x => [x.name, x.value]));
        const { profile } = await cdp.send('Profiler.stop');
        await fs.writeFile(path.join(dir, `profile-${process.argv.includes('--continuous') ? 'continuous' : 'jump'}-${results.length}-${eager ? 'eager' : 'lazy'}.json`), JSON.stringify(profile));
        const delta = Object.fromEntries(['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'LayoutCount', 'RecalcStyleCount'].map(k => [k, after[k] - before[k]]));
        const result = { eager, mount, scroll, delta, errors };
        results.push(result);
        console.log(JSON.stringify(result));
        await context.close();
    }
}
finally {
    await browser.close();
    server.close();
    await fs.writeFile(path.join(dir, process.argv.includes('--continuous') ? 'results-continuous.json' : 'results.json'), JSON.stringify(results, null, 2));
}
