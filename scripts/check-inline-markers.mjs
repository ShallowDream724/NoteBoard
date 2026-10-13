/* global window, document */
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'C:/Users/dell/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const base=process.argv.find(arg=>arg.startsWith('--base-url='))?.slice(11) || 'http://127.0.0.1:26357';
await fs.mkdir('.tmp/inline-markers',{recursive:true});
await fs.writeFile('.tmp/inline-markers/index.html','<html data-theme="chen-guang"><meta charset="utf-8"><body><script type="module" src="./entry.ts"></script></body></html>');
await fs.writeFile('.tmp/inline-markers/entry.ts',`
import {Editor} from '@tiptap/core'; import StarterKit from '@tiptap/starter-kit';
import {DocumentBookmarks} from '../../src/features/bookmarks/extension'; import {addBookmark} from '../../src/features/bookmarks/commands';
import {createAnnotationMarker} from '../../src/features/editor-md/annotations/marker';
import '../../src/styles/globals.css'; import '../../src/features/editor-md/annotations/annotations.css';
const editor=new Editor({extensions:[StarterKit,DocumentBookmarks],content:'<p>让故事发生</p>'});
editor.commands.setTextSelection({from:1,to:3});addBookmark(editor);
const bookmark=editor.view.dom.querySelector('.nb-bookmark-marker').cloneNode(true);editor.destroy();
for(const size of [14,20,32,48,72]){
 const row=document.createElement('div');row.dataset.size=String(size);row.style.cssText='margin:32px 40px; font-size:'+size+'px;line-height:1.6;';
 for(const [kind,marker] of [['note',createAnnotationMarker('example','inline')],['bookmark',bookmark.cloneNode(true)]]){
  const sample=document.createElement('span');sample.dataset.kind=kind; sample.append(document.createTextNode('让故事'),marker,document.createTextNode('发生 '));row.append(sample);
 } document.body.append(row);
}
window.ready=true;
`);
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--no-proxy-server']});
const page=await browser.newPage({viewport:{width:1200,height:1000}});
try{
 await page.goto(base+'/.tmp/inline-markers/index.html');await page.waitForFunction(()=>window.ready);
 const geometry=await page.evaluate(()=>[...document.querySelectorAll('[data-size] [data-kind]')].map(sample=>{
  const range=document.createRange();range.selectNodeContents(sample.firstChild);const text=range.getBoundingClientRect(),button=sample.querySelector('button').getBoundingClientRect();
  return {size:Number(sample.parentElement.dataset.size),kind:sample.dataset.kind,rise:text.top-button.top,gap:button.left-text.right,height:button.height};
 }));
 for(const item of geometry){assert(item.rise>=4 && item.rise<=9,JSON.stringify(item));assert(item.gap>=-3 && item.gap<=4,JSON.stringify(item));assert(item.height<=20,JSON.stringify(item));}
 await page.screenshot({path:'.tmp/inline-markers/scale.png',fullPage:true});
 console.log(JSON.stringify(geometry));
}finally{await browser.close();}
