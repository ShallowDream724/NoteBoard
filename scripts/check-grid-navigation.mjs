/* global window, document, requestAnimationFrame */
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'C:/Users/dell/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const base = process.argv.find(arg => arg.startsWith('--base-url='))?.slice(11) || 'http://127.0.0.1:26357';
await fs.mkdir('.tmp/grid-navigation', { recursive: true });
await fs.writeFile('.tmp/grid-navigation/index.html', '<html data-theme="chen-guang"><meta charset="utf-8"><body><div id="root"></div><script type="module" src="./entry.tsx"></script></body></html>');
await fs.writeFile('.tmp/grid-navigation/entry.tsx', `
import React from 'react';import {createRoot} from 'react-dom/client';import {Editor,EditorContent} from '@tiptap/react';
import {NodeSelection,TextSelection} from '@tiptap/pm/state';import {buildExtensions} from '../../src/features/editor-md/extensions';
import {TooltipProvider} from '../../src/components/Tooltip';import {initializeEditorDocument,serializeNativeNode} from '../../src/features/editor-md/editorDocumentCodec';
import '../../src/styles/globals.css';
const p=text=>({type:'paragraph',content:text?[{type:'text',text}]:[]});
const picture=name=>({type:'image',attrs:{alt:name,src:'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="300" height="130"%3E%3Crect width="300" height="130" fill="%239ac"/%3E%3C/svg%3E'}});
const slot=(name,caption)=>({type:'imageSlot',content:name?[picture(name),...(caption===undefined?[]:[p(caption)])]:[]});
const editor=new Editor({extensions:buildExtensions(),content:{type:'doc',content:[p('之前正文'),{type:'imageCollection',attrs:{columns:2},content:[slot('A','这是一条多行图注。'.repeat(30)),slot('B'),slot('C','C 图注'),slot('D','D 图注')]},p('之后正文')]}});
initializeEditorDocument(editor,serializeNativeNode(editor.state.doc),'noteboard');
createRoot(document.querySelector('#root')).render(<TooltipProvider><div style={{width:760,margin:'40px auto'}}><EditorContent editor={editor}/></div></TooltipProvider>);
const slots=()=>{let values=[];editor.state.doc.descendants((node,pos)=>{if(node.type.name==='imageSlot')values.push(pos);});return values;};
window.gridQA={editor,select(index){editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc,slots()[index]+1)));editor.view.focus();},caption(index,offset){let pos=slots()[index]+2;editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc,pos+1+offset)));editor.view.focus();},state(){const s=editor.state.selection;return {type:s instanceof NodeSelection?s.node.type.name:'text',image:s instanceof NodeSelection?s.node.attrs.alt:null,from:s.from,parent:s.$from.parent.textContent,offset:s.$from.parentOffset,focus:document.activeElement?.getAttribute('aria-label')};}};
`);
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--no-proxy-server'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 1250 } });
const errors = [];page.on('pageerror', error => errors.push(error.stack || String(error)));
await page.addInitScript(() => { window.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: 'qa' }, currentWebview: { label: 'qa' } }, invoke: async () => null, transformCallback: () => 0, convertFileSrc: p => p }; });
const state = () => page.evaluate(() => window.gridQA.state());
const key = async value => { await page.keyboard.press(value);await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve))); };
try {
  await page.goto(base + '/.tmp/grid-navigation/index.html', { waitUntil: 'commit' });
  await page.waitForFunction(() => window.gridQA && document.querySelector('.nb-image-collection'), null, { timeout: 120000 });
  const source = await page.evaluate(() => JSON.stringify(window.gridQA.editor.getJSON()));
  await page.evaluate(() => window.gridQA.select(0));
  for (const image of ['B', 'C', 'D']) { await key('ArrowRight');assert.equal((await state()).image, image); }
  await page.evaluate(() => window.gridQA.select(0));await key('ArrowDown');
  assert.equal((await state()).type, 'text');assert.equal((await state()).offset, 0);
  await key('ArrowDown');assert.equal((await state()).type, 'text');assert((await state()).offset > 0, 'A wrapped caption retains native vertical text navigation');
  await page.evaluate(() => window.gridQA.caption(0, 270));await key('ArrowDown');assert.equal((await state()).image, 'C');
  await key('ArrowUp');assert.equal((await state()).type, 'text');assert.equal((await state()).offset, 270);
  await page.evaluate(() => window.gridQA.select(1));await key('ArrowDown');assert.equal((await state()).focus, '添加图注');
  await key('ArrowDown');assert.equal((await state()).image, 'D');
  await key('ArrowUp');assert.equal((await state()).focus, '添加图注');
  await key('ArrowUp');assert.equal((await state()).image, 'B');
  assert.equal(await page.evaluate(() => JSON.stringify(window.gridQA.editor.getJSON())), source, 'Every arrow transition preserves the document');
  await page.screenshot({ path: '.tmp/grid-navigation/keyboard.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, checks: ['row-major images', 'wrapped caption native caret', 'same-column image/caption stops', 'missing-caption control', 'zero content changes'] }, null, 2));
} catch (error) { await page.screenshot({ path: '.tmp/grid-navigation/failure.png', fullPage: true });throw error; }
finally { await browser.close(); }
