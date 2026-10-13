/* global window, document, requestAnimationFrame, getComputedStyle */
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'C:/Users/dell/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const base = process.argv.find(arg => arg.startsWith('--base-url='))?.slice(11) || 'http://127.0.0.1:26357';
await fs.mkdir('.tmp/control-layout', { recursive: true });
await fs.writeFile('.tmp/control-layout/index.html', '<html data-theme="chen-guang"><meta charset="utf-8"><body><div id="root"></div><script type="module" src="./entry.tsx"></script></body></html>');
await fs.writeFile('.tmp/control-layout/entry.tsx', `
import React from 'react';import {createRoot} from 'react-dom/client';import {Editor,EditorContent} from '@tiptap/react';
import {buildExtensions} from '../../src/features/editor-md/extensions';import {BlockDragHandle} from '../../src/features/editor-md/blockDragHandle';
import {BlockContextMenu} from '../../src/features/editor-md/BlockContextMenu';import {TooltipProvider} from '../../src/components/Tooltip';
import {initializeEditorDocument,serializeNativeNode,parseEditorDocument} from '../../src/features/editor-md/editorDocumentCodec';
import '../../src/styles/globals.css';import 'katex/dist/katex.min.css';
const fixtureStyle=document.createElement('style');fixtureStyle.textContent='#scroller .ProseMirror{padding-block:32px}';document.head.append(fixtureStyle);
const p=text=>({type:'paragraph',content:[{type:'text',text}]});
const table=align=>({type:'table',attrs:{tableAlign:align,caption:'保持紧凑的表注'},content:[{type:'tableRow',content:[1,2,3].map(n=>({type:'tableCell',attrs:{colwidth:[120]},content:[p('单元格 '+n)]}))}]});
const editor=new Editor({extensions:buildExtensions(),content:{type:'doc',content:[table('center'),table('right'),p('正文操作菜单') ]}});
initializeEditorDocument(editor,serializeNativeNode(editor.state.doc),'noteboard');
const menuEditor=new Editor({extensions:buildExtensions(),content:{type:'doc',content:[p('正文')]}});initializeEditorDocument(menuEditor,serializeNativeNode(menuEditor.state.doc),'noteboard');
function Fixture(){return <TooltipProvider><div id="scroller" data-editor-scroll="markdown" style={{position:'relative',height:600,overflow:'auto',padding:'28px 80px',margin:20,border:'1px solid #eee'}}><BlockDragHandle editor={editor}/><EditorContent editor={editor}/></div><div id="menu" style={{position:'absolute',top:660,left:60}}><BlockContextMenu editor={menuEditor} pos={0} close={()=>{}}/></div></TooltipProvider>};
createRoot(document.querySelector('#root')).render(<Fixture/>);window.controlQA={editor,table,replace(content){parseEditorDocument(editor,serializeNativeNode(editor.schema.nodeFromJSON({type:'doc',content})));}};
`);
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--no-proxy-server'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 1250 } });
const frame = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const errors = [];page.on('pageerror', error => errors.push(String(error)));
await page.addInitScript(() => { window.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: 'qa' }, currentWebview: { label: 'qa' } }, invoke: async () => null, transformCallback: () => 0, convertFileSrc: p => p }; });
try {
  await page.goto(base + '/.tmp/control-layout/index.html', { waitUntil: 'commit' });
  await page.waitForFunction(() => window.controlQA, null, { timeout: 120000 });await frame();
  const source = await page.evaluate(() => JSON.stringify(window.controlQA.editor.getJSON()));
  const results = [];
  for (const index of [0, 1]) {
    const table = page.locator('#scroller table').nth(index), box = await table.boundingBox();
    await page.mouse.move(box.x + 80, box.y + 18);await frame();
    const handle = page.locator('.nb-block-drag-handle:visible');await handle.waitFor();
    const h = await handle.boundingBox();
    assert(Math.abs(box.x - (h.x + h.width) - 30) < 2, 'Table handle follows real border with room for row rail');
    await page.mouse.move(box.x - 34, box.y - 12);await frame();
    const plus = page.locator('.nb-block-boundary-insert:visible');await plus.waitFor();
    const b = await plus.boundingBox(), svg = await plus.locator('svg').boundingBox();
    assert.equal(b.width, 30);assert.equal(b.height, 30);
    assert(Math.abs(b.x + b.width / 2 - svg.x - svg.width / 2) < .1);
    assert(Math.abs(b.y + b.height / 2 - svg.y - svg.height / 2) < .1);
    assert(Math.abs(box.x - b.x - b.width - 30) < 2);
    results.push({ align: index ? 'right' : 'center', table: box, handle: h, plus: b });
  }
  assert.equal(await page.evaluate(() => JSON.stringify(window.controlQA.editor.getJSON())), source, 'Hover must not change content');
  const metrics = await page.locator('#menu .nb-block-format-actions').evaluate(row => {
    const icons = [...row.querySelectorAll(':scope > button > svg, .nb-numbering-main > svg')].map(icon => {const r=icon.getBoundingClientRect();return {left:r.left,right:r.right,center:r.left+r.width/2};});
    const arrow = row.querySelector('.nb-numbering-arrow').getBoundingClientRect();
    return { icons, arrow: {right:arrow.right}, row:row.getBoundingClientRect().toJSON(), overflow:row.scrollWidth>row.clientWidth, height:getComputedStyle(row).height };
  });
  assert.equal(metrics.icons.length, 7);assert.equal(metrics.overflow, false);
  assert(metrics.icons[2].left - metrics.arrow.right >= 5, 'Task icon needs breathing room after the arrow');
  const ordinaryGaps = metrics.icons.slice(2,-1).map((icon,i)=>metrics.icons[i+3].left-icon.right);
  assert(Math.max(...ordinaryGaps)-Math.min(...ordinaryGaps)<1, 'Following icons should have even spacing');
  await page.screenshot({ path: '.tmp/control-layout/light.png', fullPage: true });
  await page.evaluate(() => document.documentElement.dataset.theme='mo-ye');await frame();
  await page.screenshot({ path: '.tmp/control-layout/dark.png', fullPage: true });
  await page.evaluate(() => document.documentElement.dataset.theme='chen-guang');
  const image = { type:'image',attrs:{src:'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="160" height="100"%3E%3Crect width="160" height="100" fill="%239ac"/%3E%3C/svg%3E',width:'40%',align:'right'} };
  for (const [block,selector] of [
    [image,'[data-image-frame]'],
    [{type:'mathBlock',attrs:{latex:'x^2 + y^2 = z^2',textAlign:'center'}},'.math-node-preview .katex-html > .base'],
    [{type:'imageCollection',attrs:{layout:'carousel',width:'40%',align:'right'},content:[{type:'imageSlot',content:[image]}]},'.nb-image-collection'],
  ]) {
    await page.evaluate(block=>window.controlQA.replace([block,{type:'paragraph',content:[{type:'text',text:'后续正文'}]}]),block);
    await page.locator('#scroller '+selector).first().waitFor();await frame();
    const content=await page.locator('#scroller '+selector).first().boundingBox();
    await page.mouse.move(content.x+15,content.y+12);await frame();
    const control=page.locator('.nb-block-drag-handle:visible');await control.waitFor();
    const h=await control.boundingBox();
    assert(Math.abs(content.x-h.x-h.width-8)<2, block.type+' handle must follow visible content');
    // A slow crossing may exceed the normal hide delay; the control must stay reachable.
    await page.mouse.move(content.x-4,h.y+h.height/2);await page.waitForTimeout(400);
    await page.mouse.move(h.x+h.width-4,h.y+h.height/2);await frame();
    assert(await control.isVisible(), block.type+' control disappeared while crossing its gutter');
    if(block.type==='imageCollection') {
      const feedback=await page.locator('.nb-block-range-feedback:visible').first().boundingBox();
      assert(feedback.width>content.width+100,'Narrow collection feedback keeps full document row');
    }
    results.push({type:block.type,content,handle:h});
    await page.mouse.move(1150,630);await page.keyboard.press('Escape');await page.waitForTimeout(500);
  }
  await page.evaluate(()=>window.controlQA.replace([{type:'paragraph',attrs:{textAlign:'right'},content:[{type:'text',text:'右侧正文'}]}]));await frame();
  const text = await page.locator('#scroller .ProseMirror p').first().evaluate(p=>{const range=document.createRange();range.setStart(p.firstChild,0);range.setEnd(p.firstChild,2);return range.getBoundingClientRect().toJSON();});
  await page.mouse.move(text.x+5,text.y+5);await frame();
  const textHandle=await page.locator('.nb-block-drag-handle:visible').boundingBox();
  assert(Math.abs(text.x-textHandle.x-textHandle.width-8)<2,'Aligned text control follows its first line');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed:true,results,metrics },null,2));
} catch(error) {
  await page.screenshot({path:'.tmp/control-layout/failure.png',fullPage:true});
  console.error(await page.evaluate(()=>({editor:document.querySelector('#scroller .ProseMirror')?.getBoundingClientRect().toJSON(), tables:[...document.querySelectorAll('#scroller table')].map(t=>t.getBoundingClientRect().toJSON()), plus:document.querySelector('.nb-block-boundary-insert')?.outerHTML})));
  throw error;
} finally { await browser.close(); }
