// Focused scheduler comparison; every measured expression is freshly rendered.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { build } from 'vite';

const repo = process.cwd(), directory = path.join(repo, '.tmp/math-worker-scheduling');
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/dell/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
for (const version of ['baseline', 'current']) {
  await fs.mkdir(path.join(directory, version), { recursive: true });
  for (const file of ['mathRendering.ts', 'mathWorker.ts', 'mathEngine.ts', 'mathLimits.ts', 'mathSyntax.ts', ...(version === 'current' ? ['mathWorkerProtocol.ts'] : [])]) {
    const source = version === 'baseline' ? execFileSync('git', ['show', `3c129ad:src/features/editor-md/${file}`], { cwd: repo }) : await fs.readFile(path.join(repo, 'src/features/editor-md', file));
    await fs.writeFile(path.join(directory, version, file), source);
  }
}
await fs.copyFile(path.resolve(repo, '../../outputs/NoteBoard-math-atlas.md'), path.join(directory, 'atlas.md'));
await fs.copyFile(path.join(repo, 'scripts/measure-math-worker-scheduling-browser.ts'), path.join(directory, 'entry.ts'));
await fs.writeFile(path.join(directory, 'index.html'), '<!doctype html><html><body><script type="module" src="./entry.ts"></script></body></html>');
await build({ configFile: false, root: directory, base: './', logLevel: 'warn', build: { outDir: path.join(directory, 'dist'), emptyOutDir: false, minify: true }, worker: { format: 'es' } });
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const filename = path.join(directory, 'dist', pathname === '/' ? 'index.html' : pathname);
    if (!filename.startsWith(path.join(directory, 'dist') + path.sep)) throw Error('invalid path');
    res.setHeader('Content-Type', path.extname(filename) === '.js' ? 'text/javascript' : 'text/html');
    res.end(await fs.readFile(filename));
  } catch { res.statusCode = 404; res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const output = { createdAt: new Date().toISOString(), cpu: os.cpus()[0].model, browser: browser.version(), baseline: '3c129ad', runs: [] };
try {
  for (let run = 0; run < 3; run++) {
    const context = await browser.newContext(); const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => !!window.mathWorkerBench);
    const result = await page.evaluate(() => window.mathWorkerBench());
    output.runs.push(result); console.log(JSON.stringify({ run, ...result }));
    await context.close();
  }
} finally {
  await browser.close(); server.close();
  await fs.writeFile(path.join(directory, 'results.json'), JSON.stringify(output, null, 2));
}
