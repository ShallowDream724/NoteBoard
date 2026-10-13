/* global window, document, requestAnimationFrame */
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/dell/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const baseUrl = process.argv.find(arg => arg.startsWith('--base-url='))?.slice('--base-url='.length) ?? 'http://127.0.0.1:26357';
const dir = path.join(process.cwd(), '.tmp/plantuml-preview'); await fs.mkdir(dir, { recursive: true });
await fs.writeFile(path.join(dir, 'index.html'), '<html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="./entry.tsx"></script></body></html>');
await fs.writeFile(path.join(dir, 'entry.tsx'), `
import React from 'react'; import {createRoot} from 'react-dom/client';
import {Editor,EditorContent} from '@tiptap/react'; import {buildExtensions} from '../../src/features/editor-md/extensions';
import {TooltipProvider} from '../../src/components/Tooltip'; import {EditorActivityContext} from '../../src/core/editor/EditorActivityContext';
import {DiagramSplitEditor} from '../../src/features/diagram-preview/DiagramSplitEditor'; import {useDocumentStore} from '../../src/stores/documentStore';
import '../../src/styles/globals.css';
const host=document.querySelector('#root');host.style.cssText='width:900px;height:650px;padding:24px;margin:24px';
let root,editor,kind='node',active=true;const render=()=>root.render(<EditorActivityContext.Provider value={active}><TooltipProvider>{kind==='node'?<EditorContent editor={editor}/>:<DiagramSplitEditor docKey='preview.puml'/>}</TooltipProvider></EditorActivityContext.Provider>);
window.previewCheck={mount(next='node'){root?.unmount();editor?.destroy();kind=next;active=true;root=createRoot(host);if(kind==='node')editor=new Editor({extensions:buildExtensions(),content:{type:'doc',content:[{type:'plantumlBlock',attrs:{code:'Alice -> Bob'}}]},editorProps:{attributes:{class:'nb-prose'}}});else useDocumentStore.getState().upsertFromPayload({key:'preview.puml',displayName:'preview.puml',dirPath:'',kind:'code',language:'plantuml',content:'Split -> Diagram',encoding:'utf8',eol:'lf',size:16,mtime:0,readonly:false});render();},code(code){editor.view.dispatch(editor.state.tr.setNodeMarkup(0,undefined,{code}));},active(value){active=value;render();}};
`);
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--no-proxy-server'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
const requests = [], errors = [];
page.on('pageerror', error => errors.push(String(error)));
await page.addInitScript(() => { window.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: 'preview' }, currentWebview: { label: 'preview' } }, invoke: async () => null, transformCallback: () => 0, convertFileSrc: p => p }; });
await page.route('https://www.plantuml.com/**', async route => {
  requests.push(route.request().url());
  await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="80" onload="window.remoteSvgExecuted=true"><script>window.remoteSvgExecuted=true</script><foreignObject><div>unsafe</div></foreignObject><style>@import url(https://evil.test/leak)</style><rect x="1" y="1" width="295" height="75" fill="#f3f6fa" style="stroke:#456;stroke-width:2"/><text x="20" y="40">Safe diagram</text><image href="https://evil.test/leak"/></svg>' });
});
await page.route('https://evil.test/**', () => { throw new Error('Sanitized SVG tried to load an external reference'); });
const frame = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
try {
  await page.goto(`${baseUrl}/.tmp/plantuml-preview/index.html`, { waitUntil: 'commit' });
  await page.waitForFunction(() => window.previewCheck, null, { timeout: 120000 });
  await page.evaluate(() => window.previewCheck.mount()); await page.getByRole('button', { name: '启用在线预览', exact: true }).waitFor(); await frame();
  assert.equal(requests.length, 0);
  await page.getByRole('button', { name: '编辑图表源码', exact: true }).click();
  assert.equal(await page.locator('textarea').inputValue(), 'Alice -> Bob'); assert.equal(requests.length, 0);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '启用在线预览', exact: true }).click();
  await page.locator('.nb-diagram-container svg text').filter({ hasText: 'Safe diagram' }).waitFor();
  assert.equal(requests.length, 1);
  assert.deepEqual(await page.evaluate(() => ({ executed: !!window.remoteSvgExecuted, active: document.querySelectorAll('.nb-diagram-container script,.nb-diagram-container foreignObject,.nb-diagram-container style,.nb-diagram-container [onload],.nb-diagram-container [href^="http"]').length })), { executed: false, active: 0 });
  await page.screenshot({ path: path.join(dir, 'node.png') });
  await page.getByRole('button', { name: '关闭在线预览', exact: true }).click();
  await page.evaluate(() => window.previewCheck.code('offline edit')); await frame(); assert.equal(requests.length, 1);
  await page.evaluate(() => window.previewCheck.mount('split')); await page.getByRole('button', { name: '启用在线预览', exact: true }).waitFor(); await frame(); assert.equal(requests.length, 1);
  await page.getByRole('button', { name: '启用在线预览', exact: true }).click();
  await page.locator('svg text').filter({ hasText: 'Safe diagram' }).waitFor(); assert.equal(requests.length, 2);
  await page.screenshot({ path: path.join(dir, 'split.png') });
  assert.deepEqual(errors, []); console.log(JSON.stringify({ sourceEditingOffline: true, consentInBothViews: true, sanitizedInlineSvg: true, disableStopsUpload: true, mockedRequests: requests.length }, null, 2));
} finally { await browser.close(); }
