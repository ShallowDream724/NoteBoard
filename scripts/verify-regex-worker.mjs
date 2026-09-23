// Real browser-worker contract check, isolated from the editor and DOM matching.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { build } from 'vite';

const directory = path.resolve('.tmp/regex-worker-verification');
await fs.mkdir(directory, { recursive: true });
await fs.writeFile(path.join(directory, 'index.html'), '<!doctype html><html><body><script type="module" src="./entry.ts"></script></body></html>');
await fs.writeFile(path.join(directory, 'entry.ts'), `
import { searchRegex } from '../../src/features/search/searchMatching';
const query = (text, pattern, extra = {}) => ({ segments: [{ text, from: 0 }], pattern, caseSensitive: true, ...extra });
window.verifyRegexWorker = async () => {
  const countStart = performance.now();
  const indexed = await searchRegex(query('word '.repeat(50_000), 'word'));
  const indexMilliseconds = performance.now() - countStart;
  if (indexed.error) throw Error(indexed.error);
  let ticks = 0;
  const heartbeat = setInterval(() => ticks++, 10);
  const start = performance.now();
  const timedOut = await searchRegex(query('a'.repeat(32) + '!', '(a+)+$'));
  const timeoutMilliseconds = performance.now() - start;
  clearInterval(heartbeat);
  const controller = new AbortController();
  const cancelled = searchRegex(query('a'.repeat(32) + '!', '(a+)+$'), { signal: controller.signal }).catch(error => error.name);
  setTimeout(() => controller.abort(), 25);
  const cancellation = await cancelled;
  const next = await searchRegex(query('x😀!', '(?<=x)(😀)(?=!)', { replacement: { text: '$1-$&', syntax: 'codemirror' } }));
  return { count: indexed.ranges.length / 2, indexBytes: indexed.ranges.byteLength, indexMilliseconds, timeout: timedOut.limited, timeoutMilliseconds, ticks, cancellation, next: [...next.ranges], replacements: next.replacements };
};
`);
await build({ configFile: false, root: directory, base: './', logLevel: 'warn', build: { outDir: path.join(directory, 'dist'), emptyOutDir: false }, worker: { format: 'es' } });
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const filename = path.join(directory, 'dist', pathname === '/' ? 'index.html' : pathname);
    if (!filename.startsWith(path.join(directory, 'dist') + path.sep)) throw Error('invalid path');
    response.setHeader('Content-Type', path.extname(filename) === '.js' ? 'text/javascript' : 'text/html');
    response.end(await fs.readFile(filename));
  } catch { response.statusCode = 404; response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/dell/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => !!window.verifyRegexWorker);
  const result = await page.evaluate(() => window.verifyRegexWorker());
  assert.equal(result.count, 50_000); assert.equal(result.indexBytes, 400_000);
  assert.equal(result.timeout, 'time'); assert.ok(result.timeoutMilliseconds < 2_500); assert.ok(result.ticks >= 10);
  assert.equal(result.cancellation, 'AbortError'); assert.deepEqual(result.next, [1, 3]); assert.deepEqual(result.replacements, ['😀-😀']);
  await fs.writeFile(path.join(directory, 'results.json'), JSON.stringify({ browser: browser.version(), ...result }, null, 2));
  console.log(JSON.stringify(result));
} finally { await browser.close(); server.close(); }
