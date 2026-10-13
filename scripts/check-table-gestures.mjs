/* global window, document, requestAnimationFrame, performance, PointerEvent, Event */
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/dell/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = process.cwd(), dir = path.join(root, '.tmp/table-gestures');
await fs.mkdir(dir, { recursive: true });
await fs.cp(path.join(root, 'src'), path.join(dir, 'src'), { recursive: true });
await fs.writeFile(path.join(dir, 'index.html'), '<html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="./entry.tsx"></script></body></html>');
await fs.writeFile(path.join(dir, 'entry.tsx'), `
import React from 'react'; import {createRoot} from 'react-dom/client';
import {Editor,EditorContent} from '@tiptap/react';
import {buildExtensions} from './src/features/editor-md/extensions';
import {parseMarkdown,serializeMarkdown} from './src/features/editor-md/serialize';
import {initializeEditorDocument,serializeNativeNode} from './src/features/editor-md/editorDocumentCodec';
import {TooltipProvider} from './src/components/Tooltip';
import {useSettingsStore} from './src/stores/settingsStore';
import './src/styles/globals.css'; import 'katex/dist/katex.min.css';
const host=document.querySelector('#root'); host.style.cssText='width:1000px;height:850px;overflow:auto;padding:24px;margin:0';host.dataset.editorScroll='true';
let editor,root; window.tableCheck={async mount(md){root?.unmount();editor?.destroy();editor=new Editor({extensions:buildExtensions(),content:'',editorProps:{attributes:{class:'nb-prose'}}});parseMarkdown(editor,md);initializeEditorDocument(editor,serializeNativeNode(editor.state.doc),'noteboard');root=createRoot(host);root.render(<TooltipProvider><EditorContent editor={editor}/></TooltipProvider>);window.ed=editor;window.changes=[];editor.on('transaction',({transaction})=>{if(transaction.docChanged)window.changes.push(transaction.steps.length)});},resizeMode(mode){useSettingsStore.setState(state=>({settings:{...state.settings,editor:{...state.settings.editor,tableColumnResizeMode:mode}}}));},source:()=>serializeMarkdown(editor),undo:()=>editor.commands.undo()};
`);
if (!process.argv.includes('--reuse-build')) await build({ configFile: false, root: dir, base: './', worker: { format: 'es' }, plugins: [react(), tailwindcss()], build: { outDir: path.join(dir, 'dist'), emptyOutDir: false, minify: true }, logLevel: 'warn' });
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => { try { const p = new URL(req.url, 'http://localhost').pathname; res.setHeader('Content-Type', mime[path.extname(p==='/'?'index.html':p)] ?? 'application/octet-stream'); res.end(await fs.readFile(path.join(dir, 'dist', p === '/' ? 'index.html' : p))); } catch { res.statusCode = 404; res.end(); } });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1300, height: 950 } });
const errors = []; page.on('pageerror', error => errors.push(String(error)));
await page.addInitScript(() => { window.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: 'measure' }, currentWebview: { label: 'measure' } }, invoke: async () => null, transformCallback: () => 0, convertFileSrc: p => p }; });
const frame = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const results = {};
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.tableCheck);
  const formula = 'F=' + Array.from({ length: 22 }, (_, i) => `\\frac{a_{${i + 1}}}{1+b_{${i + 1}}}`).join('+');
  await page.evaluate(md => window.tableCheck.mount(md), `<!-- noteboard-table {"widths":[80,650,120],"heights":{}} -->\n| 项目 | 推导 | 来源 |\n| --- | --- | --- |\n| 甲 | $a^2+b^2=c^2$ | [KaTeX](https://katex.org) |\n| 乙 | $${formula}$ | [Pandoc](https://pandoc.org) |`);
  await page.waitForFunction(() => document.querySelectorAll('.math-preview .katex').length === 2);
  await page.evaluate(() => document.fonts.ready); await frame();
  const geometry = () => page.evaluate(() => { const table = document.querySelector('.ProseMirror table'), cell=table.rows[2].cells[1]; return { columns:[...table.rows[0].cells].map(c=>c.getBoundingClientRect().width), formulaHeight:cell.querySelector('.math-preview').getBoundingClientRect().height, formulaWidth:cell.querySelector('.math-preview').getBoundingClientRect().width, changes:[...window.changes], steps:window.changes.reduce((a,b)=>a+b,0) }; });
  const before = await geometry();
  await page.evaluate(() => window.mathIdentity=document.querySelectorAll('.math-preview .katex')[1]);
  const edge = await page.locator('.ProseMirror th').nth(1).boundingBox();
  await page.mouse.move(edge.x + edge.width - 1, edge.y + 12); await page.mouse.down();
  for(let i=1;i<=20;i++){ await page.mouse.move(edge.x + edge.width - 1 - i * 10, edge.y + 12); await frame(); }
  const during=await geometry(); assert.equal(during.changes.length,0);
  await page.mouse.up(); await frame(); const after=await geometry();
  assert.deepEqual(after.changes,[1]); assert.ok(Math.abs(after.columns[2]-before.columns[2])<2); assert.ok(after.formulaHeight>before.formulaHeight);
  assert.equal(await page.evaluate(() => document.querySelectorAll('.math-preview .katex')[1]===window.mathIdentity),true);
  await page.evaluate(() => window.tableCheck.undo()); await frame(); const undo=await geometry();
  assert.ok(Math.abs(undo.columns[1]-before.columns[1])<2); results.columns={before,during,after,undo};
  const row=await page.locator('.ProseMirror tr').nth(1).boundingBox();
  await page.evaluate(() => window.changes=[]);
  await page.mouse.move(row.x+25,row.y+row.height-1); await page.mouse.down(); await page.mouse.move(row.x+25,row.y+row.height+39); await frame();
  assert.equal(await page.evaluate(()=>window.changes.length),0); await page.mouse.up(); await frame();
  const rowAfter=await page.locator('.ProseMirror tr').nth(1).boundingBox(); assert.ok(rowAfter.height>row.height+30); assert.deepEqual(await page.evaluate(()=>window.changes),[1]);
  results.row={before:row.height,after:rowAfter.height};
  await page.screenshot({path:path.join(dir,'editor.png')});
  const large='|'+Array.from({length:10},(_,i)=>' H'+i+' |').join('')+'\n|'+Array(10).fill(' --- |').join('')+'\n'+Array.from({length:1000},(_,r)=>'|'+Array.from({length:10},(_,c)=>` R${r}C${c} |`).join('')).join('\n');
  await page.evaluate(md=>window.tableCheck.mount(md),large); await frame();
  await page.locator('.ProseMirror th').nth(1).scrollIntoViewIfNeeded(); await frame();
  const largeEdge=await page.locator('.ProseMirror th').nth(1).boundingBox();
  results.largeHit=await page.evaluate(({x,y})=>({x,y,tag:document.elementFromPoint(x,y)?.outerHTML.slice(0,200)}),{x:largeEdge.x+largeEdge.width-1,y:largeEdge.y+10});
  await page.mouse.move(largeEdge.x+largeEdge.width-1,largeEdge.y+10); await page.mouse.down();
  results.largeStart=await page.evaluate(()=>({classes:document.querySelector('.ProseMirror').className,table:document.querySelector('table').className,columns:[...document.querySelectorAll('col')].map(c=>c.getBoundingClientRect().width)}));
  results.large=await page.evaluate(async ({x,y})=>{const gaps=[];let previous=performance.now();for(let i=0;i<40;i++){document.querySelector('.ProseMirror').dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:1,buttons:1,clientX:x+Math.sin(i/10)*20,clientY:y}));await new Promise(r=>requestAnimationFrame(r));const now=performance.now();gaps.push(now-previous);previous=now;}gaps.sort((a,b)=>a-b);return {max:gaps.at(-1),p95:gaps[38],documentChanges:window.changes.length};},{x:largeEdge.x+largeEdge.width-1,y:largeEdge.y+10});
  await page.mouse.up(); await frame(); results.large.commitSteps=await page.evaluate(()=>window.changes);
  assert.equal(results.large.documentChanges,0); assert.deepEqual(results.large.commitSteps,[1]);
  const dimensions = () => page.evaluate(() => {
    const table=document.querySelector('.ProseMirror table'), wrapper=table.parentElement;
    return { columns:[...table.querySelectorAll(':scope > colgroup > col')].map(col=>col.getBoundingClientRect().width),
      width:table.getBoundingClientRect().width, wrapper:wrapper.getBoundingClientRect().width,
      left:table.getBoundingClientRect().left,
      changes:[...window.changes], preview:table.className.includes('nb-table-preview-'),
      capture:window.ed.view.dom.hasPointerCapture(1), source:window.tableCheck.source() };
  });
  const resize = async (column, delta, row=0, end='commit') => {
    await page.evaluate(({column,row})=>{
      const cell=document.querySelectorAll('.ProseMirror tr')[row].cells[column],host=document.querySelector('#root');
      const bounds=cell.getBoundingClientRect(),viewport=host.getBoundingClientRect();
      if(bounds.right>viewport.right-20)host.scrollLeft+=bounds.right-viewport.right+20;
      else if(bounds.right<viewport.left+20)host.scrollLeft+=bounds.right-viewport.left-20;
    },{column,row}); await frame();
    const edge=await page.locator('.ProseMirror tr').nth(row).locator('th,td').nth(column).boundingBox();
    await page.mouse.move(edge.x+edge.width-1,edge.y+10); await page.mouse.down();
    await page.mouse.move(edge.x+edge.width-1+delta,edge.y+10); await frame();
    const preview=await dimensions(); assert.deepEqual(preview.changes,[]);
    const boundary=await page.evaluate(({column,row})=>({
      edge:document.querySelectorAll('.ProseMirror tr')[row].cells[column].getBoundingClientRect().right,
      guide:parseFloat(document.querySelector('.nb-row-resize-guide').style.left)+2,
    }),{column,row});
    assert.ok(Math.abs(boundary.edge-(edge.x+edge.width+delta))<2,'dragged edge must follow the pointer');
    assert.ok(Math.abs(boundary.guide-boundary.edge)<2,'guide must follow the dragged edge');
    if(end==='blur') await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
    if(end==='cancel') await page.evaluate(()=>window.ed.view.dom.dispatchEvent(new PointerEvent('pointercancel',{bubbles:true,pointerId:1})));
    if(end==='escape') await page.keyboard.press('Escape');
    await page.mouse.up(); await frame(); return {preview,after:await dimensions()};
  };
  const stableNeighbours = (before,after,column,delta) => {
    before.columns.forEach((width,i)=>assert.ok(Math.abs(after.columns[i]-width-(i===column?delta:0))<2,`column ${i}: ${width} -> ${after.columns[i]}`));
    assert.ok(Math.abs(after.width-before.width-delta)<2,`table ${before.width} -> ${after.width}`);
  };
  results.widthModel=[];
  for(const widths of [[80,120,100],[300,400,300],[600,700,500]]) {
    await page.evaluate(md=>window.tableCheck.mount(md),`<!-- noteboard-table {"widths":${JSON.stringify(widths)},"heights":{}} -->\n| A | B | C |\n| --- | --- | --- |\n| one | two | three |`); await frame();
    const initial=await dimensions(); widths.forEach((width,i)=>assert.ok(Math.abs(initial.columns[i]-width)<2));
    const shrunk=await resize(1,-50);
    stableNeighbours(initial,shrunk.preview,1,-50); stableNeighbours(initial,shrunk.after,1,-50);
    assert.deepEqual(shrunk.after.changes,[1]); assert.equal(shrunk.after.preview,false); assert.equal(shrunk.after.capture,false);
    await page.evaluate(()=>window.changes=[]); const grown=await resize(1,90);
    stableNeighbours(shrunk.after,grown.preview,1,90); stableNeighbours(shrunk.after,grown.after,1,90);
    const saved=grown.after.source; await page.evaluate(md=>window.tableCheck.mount(md),saved); await frame();
    const restored=await dimensions(); stableNeighbours(grown.after,restored,1,0);
    results.widthModel.push({initial:initial.columns,shrunk:shrunk.after.columns,grown:grown.after.columns,restored:restored.columns});
  }
  // Automatic large tables start at the available document width. The first
  // resize fixes the measured widths, and later viewport changes retain them.
  const full='| A | B | C |\n| --- | --- | --- |\n'+Array(100).fill('| x | y | z |').join('\n');
  await page.evaluate(md=>window.tableCheck.mount(md),full); await frame(); const fullBefore=await dimensions();
  assert.ok(Math.abs(fullBefore.width-fullBefore.wrapper)<2);
  const fullAfter=await resize(0,70); stableNeighbours(fullBefore,fullAfter.after,0,70);
  await page.evaluate(()=>document.querySelector('#root').style.width='500px'); await frame();
  stableNeighbours(fullAfter.after,await dimensions(),0,0);
  await page.evaluate(()=>document.querySelector('#root').style.width='1000px'); await frame();
  results.fullWidth={before:fullBefore.columns,after:fullAfter.after.columns};
  results.alignments=[];
  for(const alignment of ['left','center','right']) {
    await page.evaluate(md=>window.tableCheck.mount(md),'<!-- noteboard-table {"widths":[80,120,100],"heights":{}} -->\n| A | B | C |\n| --- | --- | --- |\n| x | y | z |'); await frame();
    await page.evaluate(alignment=>{window.ed.view.dispatch(window.ed.state.tr.setNodeAttribute(0,'tableAlign',alignment));window.changes=[]},alignment); await frame();
    const before=await dimensions(),{after}=await resize(1,60); stableNeighbours(before,after,1,60);
    const settled=await page.evaluate(()=>{const table=document.querySelector('.ProseMirror table'),wrapper=table.parentElement;return {
      alignment:window.ed.state.doc.firstChild.attrs.tableAlign,
      left:table.getBoundingClientRect().left-wrapper.getBoundingClientRect().left,
      right:wrapper.getBoundingClientRect().right-table.getBoundingClientRect().right,
    }});
    assert.equal(settled.alignment,alignment);
    if(alignment==='left')assert.ok(Math.abs(settled.left)<2);
    if(alignment==='center')assert.ok(Math.abs(settled.left-settled.right)<2);
    if(alignment==='right')assert.ok(Math.abs(settled.right)<2);
    results.alignments.push(settled);
  }
  await page.evaluate(md=>window.tableCheck.mount(md),'<!-- noteboard-table {"widths":[80,120,100],"heights":{}} -->\n| A | B | C |\n| --- | --- | --- |\n| x | y | z |'); await frame();
  await page.evaluate(()=>window.tableCheck.resizeMode('adjacent'));
  const adjacentBefore=await dimensions(),{after:adjacentAfter}=await resize(1,60);
  assert.ok(Math.abs(adjacentAfter.width-adjacentBefore.width)<2);assert.ok(Math.abs(adjacentAfter.columns[0]-adjacentBefore.columns[0])<2);
  assert.ok(Math.abs(adjacentAfter.columns[1]-adjacentBefore.columns[1]-60)<2);assert.ok(Math.abs(adjacentAfter.columns[2]-adjacentBefore.columns[2]+60)<2);assert.deepEqual(adjacentAfter.changes,[1]);
  await page.evaluate(()=>window.tableCheck.undo()); await frame();const adjacentUndo=await dimensions();
  assert.ok(adjacentUndo.columns.every((width,index)=>Math.abs(width-adjacentBefore.columns[index])<2));
  await page.evaluate(()=>window.changes=[]);
  const {after:outerAfter}=await resize(2,40);stableNeighbours(adjacentUndo,outerAfter,2,40);
  results.adjacent={before:adjacentBefore.columns,after:adjacentAfter.columns,undo:adjacentUndo.columns,outer:outerAfter.columns};
  await page.evaluate(()=>window.tableCheck.resizeMode('grow'));
  for(const end of ['blur','cancel','escape']) {
    await page.evaluate(md=>window.tableCheck.mount(md),'<!-- noteboard-table {"widths":[80,120,100],"heights":{}} -->\n| A | B | C |\n| --- | --- | --- |\n| x | y | z |'); await frame();
    const before=await dimensions(), {after}=await resize(1,60,0,end);
    stableNeighbours(before,after,1,0); assert.equal(after.source,before.source); assert.ok(Math.abs(after.left-before.left)<2);
    assert.deepEqual(after.changes,[]); assert.equal(after.preview,false); assert.equal(after.capture,false);
  }
  results.cancelled=['blur','cancel','escape'];
  await page.evaluate(md=>window.tableCheck.mount(md),'<table><tr><th colspan="2" colwidth="80,120">Merged</th><th colwidth="100">C</th></tr><tr><td colwidth="80">A</td><td colwidth="120">B</td><td colwidth="100">C</td></tr></table>'); await frame();
  const mergedBefore=await dimensions(), mergedAfter=await resize(0,60,1); stableNeighbours(mergedBefore,mergedAfter.after,0,60);
  assert.ok(mergedAfter.after.source.includes('"colspan":2')); results.merged=mergedAfter.after.columns;
  await page.evaluate(md=>window.tableCheck.mount(md),`<!-- noteboard-table {"widths":[160,120,100],"heights":{}} -->\n| A | B | C |\n| --- | --- | --- |\n| ${'Unbreakable'.repeat(30)} | y | z |`); await frame();
  const longBefore=await dimensions(),longAfter=await resize(0,-80); stableNeighbours(longBefore,longAfter.after,0,-80);
  assert.equal(await page.evaluate(()=>{const text=document.querySelectorAll('.ProseMirror tr')[1].cells[0].querySelector('p');return text.scrollWidth<=text.clientWidth+1}),true);
  results.longText=longAfter.after.columns;
  await page.evaluate(md=>window.tableCheck.mount(md),`| A | B | C |\n| --- | --- | --- |\n| ${'Unbreakable'.repeat(3000)} | y | z |`); await frame();
  const automaticLong=await dimensions(); assert.ok(automaticLong.width<=automaticLong.wrapper+2,'automatic long tokens should wrap inside the document width');
  const automaticLongAfter=await resize(0,-60); stableNeighbours(automaticLong,automaticLongAfter.after,0,-60);
  results.automaticLongText=automaticLongAfter.after.columns;
  await page.evaluate(()=>window.tableCheck.mount('| A | B |\n| --- | --- |\n|  |  |')); await frame();
  const emptyBefore=await dimensions(),emptyAfter=await resize(0,60); stableNeighbours(emptyBefore,emptyAfter.after,0,60);
  results.empty=emptyAfter.after.columns;
  results.errors=errors; assert.deepEqual(errors,[]); console.log(JSON.stringify(results,null,2));
} finally { results.errors=errors; await fs.writeFile(path.join(dir,'results.json'),JSON.stringify(results,null,2)); await browser.close();server.close(); }
