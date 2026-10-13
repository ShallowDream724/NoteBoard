/* global window, document, requestAnimationFrame */
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'C:/Users/dell/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const base = process.argv.find(arg => arg.startsWith('--base-url='))?.slice(11) || 'http://127.0.0.1:26357';
await fs.mkdir('.tmp/table-reachability', { recursive: true });
await fs.writeFile('.tmp/table-reachability/index.html', '<html data-theme="chen-guang"><meta charset="utf-8"><body><div id="root"></div><script type="module" src="./entry.tsx"></script></body></html>');
await fs.writeFile('.tmp/table-reachability/entry.tsx', `
import React from 'react';import {createRoot} from 'react-dom/client';import {Editor,EditorContent} from '@tiptap/react';
import {CellSelection} from '@tiptap/pm/tables';import {buildExtensions} from '../../src/features/editor-md/extensions';
import {tableReadingBounds} from '../../src/features/editor-md/tableReadingViewport';
import {BlockDragHandle} from '../../src/features/editor-md/blockDragHandle';import {TooltipProvider} from '../../src/components/Tooltip';
import {initializeEditorDocument,serializeNativeNode,parseEditorDocument} from '../../src/features/editor-md/editorDocumentCodec';
import '../../src/styles/globals.css';
const p=text=>({type:'paragraph',content:[{type:'text',text}]});
const table=(align,width)=>({type:'table',attrs:{tableAlign:align,caption:'表注保持原位'},content:Array.from({length:4},(_,r)=>({type:'tableRow',content:[1,2,3].map(n=>({type:'tableCell',attrs:{colwidth:[width]},content:[p(r+' / '+n)]}))}))});
const editor=new Editor({extensions:buildExtensions(),content:{type:'doc',content:[table('left',270),table('left',270)]}});
initializeEditorDocument(editor,serializeNativeNode(editor.state.doc),'noteboard');
function Fixture(){return <TooltipProvider><div id="scroller" data-editor-scroll="markdown" style={{position:'relative',height:450,overflow:'auto',margin:20,border:'1px solid #eee'}}><BlockDragHandle editor={editor}/><EditorContent editor={editor}/></div></TooltipProvider>};
createRoot(document.querySelector('#root')).render(<Fixture/>);
window.reachabilityQA={editor,bounds(){return tableReadingBounds(document.querySelector('#scroller table'),document.querySelector('#scroller'));},replace(align,width,gutter=80){document.querySelector('#scroller').style.setProperty('--document-gutter',gutter+'px');parseEditorDocument(editor,serializeNativeNode(editor.schema.nodeFromJSON({type:'doc',content:[table(align,width),table(align,width)]})));document.querySelector('#scroller').scrollTop=0;},selection(){const s=editor.state.selection;return {cell:s instanceof CellSelection,row:s instanceof CellSelection&&s.isRowSelection(),column:s instanceof CellSelection&&s.isColSelection()};}};
`);
const browser = await chromium.launch({ channel:'msedge',headless:true,args:['--no-proxy-server'] });
const page = await browser.newPage({viewport:{width:1000,height:760}}), errors=[];
// Parallel UI work must not reload a running pointer gesture through Vite HMR.
await page.routeWebSocket('**', socket => socket.close());
page.on('pageerror',error=>errors.push(error.stack||String(error)));
await page.addInitScript(()=>{window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'qa'},currentWebview:{label:'qa'}},invoke:async()=>null,transformCallback:()=>0,convertFileSrc:p=>p};});
const frame=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const leave=async()=>{await page.mouse.move(980,650);await page.waitForTimeout(500);};
const results=[];
try {
  await page.goto(base+'/.tmp/table-reachability/index.html',{waitUntil:'commit'});await page.waitForFunction(()=>window.reachabilityQA,null,{timeout:120000});await frame();
  for(const [name,align,width,gutter] of [['left','left',170,80],['full-width','left',270,80],['center','center',120,80],['right','right',120,80],['narrow-gutter','left',270,24]]){
    await leave();await page.evaluate(([align,width,gutter])=>window.reachabilityQA.replace(align,width,gutter),[align,width,gutter]);await frame();
    const table=page.locator('#scroller table').first();
    const rows=await table.locator('tbody > tr').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().toJSON()));
    const bounds=await page.evaluate(()=>window.reachabilityQA.bounds());
    const row=rows[0], source=await page.evaluate(()=>JSON.stringify(window.reachabilityQA.editor.getJSON()));
    for(const side of ['top','left','right','bottom']){
      await leave();
      const horizontal=side==='left'||side==='right';
      const point=horizontal?{x:side==='left'?row.left-14:Math.min(row.right,bounds.right)+14,y:row.top+row.height/2}
        :{x:row.left+40,y:side==='top'?row.top-14:rows.at(-1).bottom+10};
      await page.mouse.move(point.x,point.y);await frame();
      const rail=page.locator(horizontal?'.nb-table-select-row:not([hidden])':'.nb-table-select-column:not([hidden])');
      if(!await rail.isVisible()) console.error({name,side,point,bounds,probes:await page.evaluate(({x,y})=>[[0,0],[22,0],[-22,0],[0,22],[0,-22]].map(([dx,dy])=>document.elementFromPoint(x+dx,y+dy)?.outerHTML.slice(0,250)),point)});
      assert(await rail.isVisible(),name+' '+side+': rail discoverable from outside without visiting cell');
      assert(await page.evaluate(({x,y})=>!!document.elementFromPoint(x,y)?.closest('.nb-table-select-handle'),point),name+' '+side+': literal pointer hits rail');
      await page.waitForTimeout(650);await page.mouse.click(point.x,point.y);await frame();
      const selection=await page.evaluate(()=>window.reachabilityQA.selection());
      assert(horizontal?selection.row:selection.column,name+' '+side+': click selects intended axis');
      assert.equal(await page.evaluate(()=>JSON.stringify(window.reachabilityQA.editor.getJSON())),source);
    }
    // Begin on actual whitespace and approach the external plus slowly, passing
    // over the column rail and then the document gutter.
    await leave();await page.mouse.move(row.left+45,row.top-12);await frame();
    const plus=page.locator('.nb-block-boundary-insert:visible');assert(await plus.isVisible(),name+': plus visible at document start');
    const b=await plus.boundingBox(),target={x:b.x+b.width/2,y:b.y+b.height/2};
    for(let step=1;step<=8;step++){await page.mouse.move(row.left+45+(target.x-row.left-45)*step/8,target.y);await page.waitForTimeout(100);assert(await plus.isVisible(),name+': plus remains reachable at step '+step);}
    assert(await page.evaluate(({x,y})=>!!document.elementFromPoint(x,y)?.closest('.nb-block-boundary-insert'),target),name+': plus receives real hit');
    await page.mouse.click(target.x,target.y);await frame();
    assert.equal(await page.evaluate(()=>window.reachabilityQA.editor.state.doc.firstChild.type.name),'paragraph',name+': one click inserts before first table');
    assert.equal(await page.evaluate(()=>window.reachabilityQA.editor.state.doc.childCount),3);
    results.push({name,railPoint:row,plus:b});
  }
  await page.evaluate(()=>window.reachabilityQA.replace('left',270));await frame();
  const second=await page.locator('#scroller .tableWrapper').nth(1).boundingBox();
  await page.evaluate(y=>{document.querySelector('#scroller').scrollTop=y;},second.y-220);await frame();await leave();
  const between=await page.locator('#scroller .tableWrapper').nth(1).boundingBox();
  await page.mouse.move(between.x+40,between.y-12);await frame();
  const plus=page.locator('.nb-block-boundary-insert:visible');assert(await plus.isVisible(),'between tables after scrolling: plus visible');
  const b=await plus.boundingBox();await page.mouse.move(b.x+b.width+3,b.y+b.height/2);await page.waitForTimeout(700);
  assert(await plus.isVisible(),'between tables: slow crossing remains reachable');await plus.click();await frame();
  assert.equal(await page.evaluate(()=>window.reachabilityQA.editor.state.doc.child(1).type.name),'paragraph');
  await page.screenshot({path:'.tmp/table-reachability/passed.png'});
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,results},null,2));
}catch(error){await page.screenshot({path:'.tmp/table-reachability/failure.png'});console.error(errors,await page.evaluate(()=>({plus:document.querySelector('.nb-block-boundary-insert')?.outerHTML,rails:[...document.querySelectorAll('.nb-table-select-handle')].map(e=>e.outerHTML)})));throw error;}
finally{await browser.close();}
