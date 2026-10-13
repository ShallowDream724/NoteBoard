/* global window, document, getComputedStyle */
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'C:/Users/dell/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const base = process.argv.find(arg => arg.startsWith('--base-url='))?.slice(11) || 'http://127.0.0.1:26357';
await fs.mkdir('.tmp/readable-ink', { recursive: true });
await fs.writeFile('.tmp/readable-ink/index.html', '<html data-theme="mo-ye"><meta charset="utf-8"><body><div id="root"></div><script type="module" src="./entry.tsx"></script></body></html>');
await fs.writeFile('.tmp/readable-ink/entry.tsx', `
import React from 'react'; import {createRoot} from 'react-dom/client'; import {Editor,EditorContent} from '@tiptap/react';
import {buildDocumentExtensions} from '../../src/features/editor-md/documentExtensions';
import {HighlightControl} from '../../src/features/toolbar/HighlightControl';
import {ColorSwatches} from '../../src/features/document-style/ColorSwatches';
import {renderFigureCaption} from '../../src/features/editor-md/figureCaption';
import {rememberTextStyle} from '../../src/features/document-style/stylePreference';
import {BACKGROUND_COLORS,TEXT_COLORS} from '../../src/features/document-style/colors';
import {contrastRatio} from '../../src/core/theme/contrast';
import '../../src/styles/globals.css';
const text=(text,marks=[])=>({type:'text',text,marks}),p=(text,marks=[])=>({type:'paragraph',content:[{type:'text',text,marks}]});
const highlight=color=>({type:'highlight',attrs:{color}}),ink=color=>({type:'textColor',attrs:{color}});
const content=[p('文字颜色与高亮，明暗主题都清楚可读。'),p('生成 ATP；commitment',[highlight('#fef08a')]),p('保留红字原色，浅底上仍清楚',[highlight('#fecaca'),ink('#dc2626')]),p('白字高亮自动补偿',[highlight('#fb923c'),ink('#ffffff')]),p('inline code',[highlight('#fef08a'),{type:'code'}]),{type:'table',content:[{type:'tableRow',content:[{type:'tableCell',content:[p('table highlighted',[highlight('#fef08a')])]}]}]}];
const editor=new Editor({extensions:buildDocumentExtensions(),content:{type:'doc',content}}),original=JSON.stringify(editor.getJSON());
rememberTextStyle({color:null,background:'#fef08a'});
createRoot(document.querySelector('#root')).render(<div style={{padding:32,maxWidth:950,height:'100%',overflow:'auto',background:'var(--editor-bg)'}}><div style={{width:280}}><HighlightControl active currentColor="#fef08a" open={false} onOpenChange={()=>{}} onApply={()=>{}} onRemove={()=>{}} onReturnToEditor={()=>{}}/><ColorSwatches kind="text" label="文字颜色" onChange={()=>{}}/></div><EditorContent editor={editor}/><div className="ProseMirror" id="caption"/><div id="matrix"/></div>);
setTimeout(()=>{renderFigureCaption(document.querySelector('#caption'),'图注',[text('图注高亮与正文一致',[highlight('#fef08a'),ink('#ffffff')])]);
const matrix=BACKGROUND_COLORS.filter(v=>v.color).map(background=>({type:'paragraph',content:TEXT_COLORS.map(color=>text('正文 ',[highlight(background.color),...(color.color?[ink(color.color)]:[])]))}));
const palette=new Editor({element:document.querySelector('#matrix'),extensions:buildDocumentExtensions(),content:{type:'doc',content:matrix}});
window.fixture={editor,palette,original,contrastRatio};},30);
`);
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--no-proxy-server'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 1400 } }), errors = [];
page.on('pageerror', error => errors.push(String(error)));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
try {
  await page.goto(base + '/.tmp/readable-ink/index.html');
  await page.waitForFunction(() => window.fixture);
  const results = [];
  for (const theme of ['chen-guang', 'mo-ye', 'hu-po']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    const result = await page.evaluate(() => {
      const { contrastRatio }=window.fixture;
      const background = element => { for(let node=element;node;node=node.parentElement){const fill=getComputedStyle(node).backgroundColor;if(fill!=='rgba(0, 0, 0, 0)'&&fill!=='transparent')return fill;}return '#ffffff'; };
      const marks=[],walker=document.createTreeWalker(document.body,4);let text;
      while((text=walker.nextNode())){const element=text.parentElement;if(element.closest('mark')&&text.textContent.trim())marks.push({text:text.textContent,ratio:contrastRatio(getComputedStyle(element).color,background(element))});}
      const preview=document.querySelector('.nb-text-style-preview'),style=getComputedStyle(preview);
      return {theme:document.documentElement.dataset.theme,minimum:Math.min(...marks.map(v=>v.ratio)),count:marks.length,preview:contrastRatio(style.color,style.backgroundColor),low:marks.filter(v=>v.ratio<4.5)};
    });
    assert(result.count >= 125); assert(result.minimum >= 4.5,JSON.stringify(result)); assert(result.preview >= 4.5,JSON.stringify(result)); results.push(result);
    await page.screenshot({ path: '.tmp/readable-ink/'+theme+'.png',fullPage:true });
  }
  assert.equal(await page.evaluate(()=>JSON.stringify(window.fixture.editor.getJSON())===window.fixture.original),true);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify(results,null,2));
} catch (error) { console.error(errors); throw error; } finally { await browser.close(); }
