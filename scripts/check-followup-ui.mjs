/* global window, document, requestAnimationFrame */
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'C:/Users/dell/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const base=process.argv.find(x=>x.startsWith('--base-url='))?.slice(11)||'http://127.0.0.1:26357';
await fs.mkdir('.tmp/followup-ui',{recursive:true});
await fs.writeFile('.tmp/followup-ui/index.html','<html data-theme="chen-guang"><meta charset="utf-8"><body><div id="root"></div><script type="module" src="./entry.tsx"></script></body></html>');
await fs.writeFile('.tmp/followup-ui/entry.tsx',String.raw`
import React from 'react';import{createRoot}from'react-dom/client';import{Editor,EditorContent}from'@tiptap/react';
import{buildExtensions}from'../../src/features/editor-md/extensions';import{initializeEditorDocument,serializeNativeNode}from'../../src/features/editor-md/editorDocumentCodec';
import{OutlinePanel}from'../../src/features/outline/OutlinePanel';import{ImageCollectionMenu}from'../../src/features/editor-md/rich-content/ImageCollectionMenu';import{ImageTemplateIcon}from'../../src/components/ImageGridIcon';
import{SaveDocumentButton}from'../../src/components/titlebar/SaveDocumentButton';import{TooltipProvider}from'../../src/components/Tooltip';
import{useLayoutStore}from'../../src/stores/layoutStore';import{useDocumentStore}from'../../src/stores/documentStore';import{useWindowStore}from'../../src/stores/windowStore';import{useSaveActivityStore}from'../../src/stores/saveActivityStore';
import{bindExplorerDrop}from'../../src/features/explorer/explorerDrop';import{useExplorerStore}from'../../src/features/explorer/explorerStore';import{routeNativeFileDrop}from'../../src/core/editor/fileDropTargets';
import'../../src/styles/globals.css';import'../../src/components/appShell.css';import'../../src/components/titlebar/titlebar.css';import'../../src/features/explorer/explorerTree.css';import'../../src/features/editor-md/blockContextMenu.css';
const p=text=>({type:'paragraph',content:[{type:'text',text}]});const editor=new Editor({extensions:buildExtensions(),content:{type:'doc',content:[{type:'imageCollection',attrs:{columns:2,width:'75%'},content:['A','B','C','D'].map(text=>({type:'imageSlot',content:[p(text)]}))},...[1,2,3].map(level=>({type:'heading',attrs:{level},content:[{type:'text',text:level===1?'欢迎使用 NoteBoard':'图片、表格与图文说明'}]}))]}});
initializeEditorDocument(editor,serializeNativeNode(editor.state.doc),'noteboard','','followup.nb');
let renderMenu=()=>{};function Menu(){const[revision,setRevision]=React.useState(0);React.useEffect(()=>{renderMenu=()=>setRevision(r=>r+1);editor.on('update',renderMenu);return()=>editor.off('update',renderMenu)},[]);return <div className="nb-block-context-menu" data-revision={revision}><ImageCollectionMenu editor={editor} node={editor.state.doc.firstChild} pos={0}/></div>}
function Fixture(){return <TooltipProvider><div className="titlebar-document-actions" style={{height:36,background:'var(--window-chrome-bg)',paddingLeft:36}}><SaveDocumentButton/></div><div id="stage" className="nb-document-stage" data-navigation-mode="docked" data-outline="" style={{display:'flex',height:510,width:1000,position:'relative',margin:20,border:'1px solid var(--editor-border)'}}><div id="editor-scroller" data-editor-scroll="markdown" style={{flex:1,minWidth:0,overflow:'auto',padding:24}}><EditorContent editor={editor}/></div><OutlinePanel editor={editor}/></div><div style={{display:'flex',gap:24,margin:20}}><Menu/><div id="tree" className="nb-explorer-tree" style={{width:290,height:200,border:'1px solid var(--editor-border)'}}><div data-explorer-row="C:\\work\\a.md" style={{height:30,padding:6}}>a.md</div><div data-explorer-row="C:\\work\\folder" data-explorer-directory="true" style={{height:30,padding:6}}>folder</div><div data-explorer-row="C:\\work\\folder\\child" data-explorer-directory="true" style={{height:30,padding:'6px 20px'}}>child</div></div><div id="icons">{[2,'vertical2',4,6,9,'carousel'].map(template=><span key={template} style={{display:'inline-flex',padding:8}}><ImageTemplateIcon template={template} size={24}/></span>)}</div></div></TooltipProvider>}
useLayoutStore.setState({outlineWidth:220});const saveDoc={key:'C:\\work\\a.md',kind:'markdown',readonly:false,isDirty:true,savePolicy:'manual',externalStatus:null};useDocumentStore.setState({documents:new Map([[saveDoc.key,saveDoc]])});useWindowStore.setState({activeKey:saveDoc.key,tabs:[]});
createRoot(document.querySelector('#root')).render(<Fixture/>);
window.followup={editor,layout:useLayoutStore,save(state){useDocumentStore.setState({documents:new Map([[saveDoc.key,{...saveDoc,isDirty:state==='unsaved'}]])});useSaveActivityStore.setState({activities:new Map(state==='saving'?[[saveDoc.key,{pending:1,error:null}]]:state==='error'?[[saveDoc.key,{pending:0,error:'写入失败'}]]:[])});},bindTree(){useDocumentStore.setState({documents:new Map()});useWindowStore.setState({activeKey:null,tabs:[]});useExplorerStore.setState({root:'C:\\work'});return bindExplorerDrop(document.querySelector('#tree'),'C:\\work');},native:routeNativeFileDrop};
`);
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--no-proxy-server']});const page=await browser.newPage({viewport:{width:1250,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.stack||String(e)));
await page.addInitScript(()=>{window.calls=[];window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'qa'},currentWebview:{label:'qa'}},invoke:async(command,args)=>{window.calls.push({command,args});return command==='read_dir'?[]:command==='copy_path_into_directory'?'C:\\work\\folder\\external.md':null;},transformCallback:()=>0,convertFileSrc:p=>p};});
const frame=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
try{
  await page.goto(base+'/.tmp/followup-ui/index.html',{waitUntil:'commit'});await page.waitForFunction(()=>window.followup,null,{timeout:120000});await frame();
  const save=page.getByRole('button',{name:'保存当前文档'});assert.equal(await save.getAttribute('data-save-state'),'unsaved');
  for(const state of ['saving','error','saved']){await page.evaluate(state=>window.followup.save(state),state);await frame();assert.equal(await save.getAttribute('data-save-state'),state);assert.equal(await save.isDisabled(),state==='saving');}
  await page.evaluate(()=>window.followup.save('unsaved'));
  const panel=page.getByRole('navigation',{name:'文档导航'}),resize=page.getByRole('separator',{name:'调整导航栏宽度'});
  const before=await panel.boundingBox(),contentBefore=await page.locator('#editor-scroller').boundingBox();const r=await resize.boundingBox();
  await page.mouse.move(r.x+r.width/2,r.y+80);await page.mouse.down();await page.mouse.move(r.x-90,r.y+80,{steps:8});await frame();
  const during=await panel.boundingBox();assert(during.width>before.width+80);assert.equal(await page.evaluate(()=>window.followup.layout.getState().outlineWidth),220,'No preference writes during pointer preview');
  assert((await page.locator('#editor-scroller').boundingBox()).width<contentBefore.width-80,'Docked resize must reflow the document lane');
  await page.mouse.up();await frame();assert(Math.abs(await page.evaluate(()=>window.followup.layout.getState().outlineWidth)-during.width)<2);
  const stored=await page.evaluate(()=>window.followup.layout.getState().outlineWidth);
  const next=await resize.boundingBox();await page.mouse.move(next.x+4,next.y+80);await page.mouse.down();await page.mouse.move(next.x-60,next.y+80);await page.keyboard.press('Escape');await page.mouse.up();await frame();assert.equal(await page.evaluate(()=>window.followup.layout.getState().outlineWidth),stored);
  await page.evaluate(()=>document.querySelector('#stage').dataset.navigationMode='floating');await frame();const floating=await panel.boundingBox();
  await resize.focus();await page.keyboard.press('ArrowLeft');await frame();assert((await panel.boundingBox()).width>floating.width);
  await page.evaluate(()=>document.querySelector('#stage').style.width='300px');await frame();assert((await panel.boundingBox()).width<=252);await page.evaluate(()=>document.querySelector('#stage').style.width='1000px');await frame();assert((await panel.boundingBox()).width>=stored);
  await page.getByRole('button',{name:'删除最右一列',exact:true}).click();await frame();assert.deepEqual(await page.evaluate(()=>({columns:window.followup.editor.state.doc.firstChild.attrs.columns,text:window.followup.editor.state.doc.firstChild.textContent})),{columns:1,text:'AC'});
  await page.getByRole('button',{name:'在右侧加一列',exact:true}).first().click();await frame();assert.equal(await page.evaluate(()=>window.followup.editor.state.doc.firstChild.childCount),4);
  await page.getByRole('button',{name:'在下方加一行',exact:true}).first().click();await frame();assert.equal(await page.evaluate(()=>window.followup.editor.state.doc.firstChild.childCount),6);
  const iconPaths=await page.locator('#icons svg').evaluateAll(icons=>icons.map(icon=>icon.innerHTML));assert.equal(new Set(iconPaths).size,6);
  await page.screenshot({path:'.tmp/followup-ui/light.png',fullPage:true});
  await page.evaluate(()=>{document.documentElement.dataset.theme='mo-ye';window.followup.bindTree();});await frame();
  const file=await page.locator('[data-explorer-row="C:\\\\work\\\\a.md"]').boundingBox().catch(()=>null);
  const rows=page.locator('#tree [data-explorer-row]');const source=file??await rows.nth(0).boundingBox(),folder=await rows.nth(1).boundingBox();
  await page.mouse.move(source.x+55,source.y+15);await page.mouse.down();await page.mouse.move(folder.x+55,folder.y+15,{steps:8});await frame();assert.equal(await rows.nth(1).getAttribute('data-drop-target'),'move');
  await page.mouse.up();await page.waitForFunction(()=>window.calls.some(c=>c.command==='rename_path'));
  assert.equal(await page.evaluate(()=>window.calls.find(c=>c.command==='rename_path').args.to),'C:\\work\\folder\\a.md');
  await page.evaluate(({x,y})=>window.followup.native({type:'enter',paths:['D:\\external.md'],position:{x,y}}),{x:folder.x+50,y:folder.y+15});await frame();assert.equal(await rows.nth(1).getAttribute('data-drop-target'),'copy');
  await page.evaluate(({x,y})=>window.followup.native({type:'drop',paths:['D:\\external.md'],position:{x,y}}),{x:folder.x+50,y:folder.y+15});await page.waitForFunction(()=>window.calls.some(c=>c.command==='copy_path_into_directory'));
  await page.screenshot({path:'.tmp/followup-ui/dark.png',fullPage:true});assert.deepEqual(errors,[]);console.log('Passed: save states, docked/floating resize commit/cancel/keyboard/clamp, editable grids, distinct icons, workspace move and external copy feedback.');
}catch(error){await page.screenshot({path:'.tmp/followup-ui/failure.png',fullPage:true});throw error;}finally{await browser.close();}
