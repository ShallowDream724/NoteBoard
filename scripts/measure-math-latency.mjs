// Focused, uncached rendering benchmark. Does not modify application source.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { build } from 'vite';
const repo = process.cwd();
const directory = path.join(repo, '.tmp/math-latency');
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/dell/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
await fs.mkdir(path.join(directory, 'baseline'), { recursive: true });
for (const file of ['mathRendering.ts', 'mathRenderQueue.ts', 'mathWorker.ts', 'mathEngine.ts', 'mathLimits.ts', 'mathSyntax.ts']) {
    await fs.writeFile(path.join(directory, 'baseline', file), execFileSync('git', ['show', `3c129ad:src/features/editor-md/${file}`], { cwd: repo }));
}
await fs.copyFile(path.resolve(repo, '../../outputs/NoteBoard-math-atlas.md'), path.join(directory, 'atlas.md'));
await fs.writeFile(path.join(directory, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"></head><body><article id="content"></article><script type="module" src="./entry.ts"></script></body></html>');
await fs.copyFile(path.join(repo, 'scripts/measure-math-latency-browser.ts'), path.join(directory, 'entry.ts'));
await build({ configFile: false, root: directory, base: './', logLevel: 'warn', build: { outDir: path.join(directory, 'dist'), emptyOutDir: false, minify: true }, worker: { format: 'es' } });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf' };
const server = createServer(async (req, res) => {
    try {
        const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
        const filename = path.join(directory, 'dist', pathname === '/' ? 'index.html' : pathname);
        if (!filename.startsWith(path.join(directory, 'dist') + path.sep))
            throw Error('invalid path');
        res.setHeader('Content-Type', types[path.extname(filename)] ?? 'application/octet-stream');
        res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
        res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
        res.end(await fs.readFile(filename));
    }
    catch {
        res.statusCode = 404;
        res.end();
    }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const result = { createdAt: new Date().toISOString(), baseline: '3c129ad (installed 0.3.9)', cpu: os.cpus()[0].model, logicalCpus: os.cpus().length, totalMemoryGiB: os.totalmem() / 2 ** 30, browser: browser.version(), runs: [] };
try {
    for (let run = 0; run < 3; run++) {
        const context = await browser.newContext({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 1 });
        const page = await context.newPage();
        page.setDefaultTimeout(120000);
        const errors = [];
        page.on('pageerror', e => errors.push(String(e)));
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        await page.waitForFunction(() => !!window.mathBench);
        const cdp = await context.newCDPSession(page);
        await cdp.send('Performance.enable');
        const data = await page.evaluate(async () => window.mathBench.run());
        data.metrics = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
        data.errors = errors;
        result.runs.push(data);
        console.log(JSON.stringify({ run, ...data }));
        await context.close();
    }
}
finally {
    await browser.close();
    server.close();
    await fs.writeFile(path.join(directory, 'results.json'), JSON.stringify(result, null, 2));
}
