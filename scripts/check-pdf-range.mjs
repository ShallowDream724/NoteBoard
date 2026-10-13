/* global window */
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'vite';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'C:/Users/dell/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const directory = path.resolve('.tmp/pdf-range');
await fs.mkdir(directory, { recursive: true });
await fs.writeFile(path.join(directory, 'index.html'), '<html><body><script type="module" src="./entry.ts"></script></body></html>');
await fs.writeFile(path.join(directory, 'native.ts'), `
export async function invoke(command, request) {
  if (command !== 'read_pdf') throw Error('Unexpected native command');
  window.reads.push(request);
  if (request.length > 1048576) throw Error('Native range limit exceeded');
  return window.pdfBytes.slice(request.offset, request.offset + request.length).buffer;
}
`);
await fs.writeFile(path.join(directory, 'entry.ts'), `
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import worker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { NativePdfRange } from '../../src/features/export/nativePdfRange';
GlobalWorkerOptions.workerSrc = worker;
window.reads = []; window.ranges = [];
let source = '%PDF-1.7\\n', offsets = [0];
function object(id, value) { offsets[id] = source.length; source += id + ' 0 obj\\n' + value + '\\nendobj\\n'; }
object(1, '<< /Type /Catalog /Pages 2 0 R >>');
object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
object(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>');
const content = 'BT /F1 12 Tf 20 700 Td (Print range test) Tj ET\\n%' + 'x'.repeat(3 * 1048576) + '\\n';
object(4, '<< /Length ' + content.length + ' >>\\nstream\\n' + content + 'endstream');
object(5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
const xref = source.length;
source += 'xref\\n0 6\\n0000000000 65535 f \\n' + offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n \\n').join('') + 'trailer\\n<< /Root 1 0 R /Size 6 >>\\nstartxref\\n' + xref + '\\n%%EOF';
window.pdfBytes = new TextEncoder().encode(source);
const failures = [];
const range = new NativePdfRange({id:'fixture',revision:1,size:window.pdfBytes.length,pages:1,locations:[],issues:[],adjustable:[]}, error => failures.push(String(error)));
const request = range.requestDataRange.bind(range);
range.requestDataRange = (begin, end) => { window.ranges.push([begin,end]); request(begin,end); };
const task = getDocument({range,rangeChunkSize:65536,disableAutoFetch:true,disableStream:true,useSystemFonts:true});
window.finished = (async () => {
  try {
    const pdf = await task.promise, page = await pdf.getPage(1), text = await page.getTextContent();
    const bytes = await pdf.getData();
    return {text:text.items.map(item => item.str || '').join(' '),bytes:bytes.length,sourceBytes:window.pdfBytes.length,sameBytes:bytes.every((value,index) => value === window.pdfBytes[index]),reads:window.reads,ranges:window.ranges,failures};
  } finally { range.abort(); await task.destroy(); }
})();
`);
const server = await createServer({ configFile: false, root: process.cwd(), resolve: { alias: { '@tauri-apps/api/core': path.join(directory, 'native.ts') } }, optimizeDeps: { noDiscovery: true, include: [] }, server: { host: '127.0.0.1', port: 0, hmr: false, watch: null } });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--no-proxy-server'] });
try {
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(server.resolvedUrls.local[0] + '.tmp/pdf-range/index.html');
  await page.waitForFunction(() => window.finished);
  const result = await page.evaluate(() => window.finished);
  assert.equal(result.text, 'Print range test');
  assert.equal(result.bytes, result.sourceBytes);
  assert.equal(result.sameBytes, true);
  assert(result.ranges.some(([begin, end]) => end - begin > 1048576), 'Fixture must exercise a multi-IPC PDF.js range');
  assert(result.reads.every(read => read.length <= 1048576));
  assert.deepEqual(result.failures, []); assert.deepEqual(errors, []);
  console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); await server.close(); }
