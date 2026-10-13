/* global window, document, getComputedStyle */
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'C:/Users/dell/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const base = process.argv.find(arg => arg.startsWith('--base-url='))?.slice(11) || 'http://127.0.0.1:26357';
await fs.mkdir('.tmp/dark-containers', { recursive: true });
await fs.writeFile('.tmp/dark-containers/index.html', '<html data-theme="chen-guang"><meta charset="utf-8"><body><div id="root"></div><script type="module" src="./entry.tsx"></script></body></html>');
await fs.writeFile('.tmp/dark-containers/entry.tsx', `
import React from 'react'; import {createRoot} from 'react-dom/client'; import {Editor,EditorContent} from '@tiptap/react';
import {buildExtensions} from '../../src/features/editor-md/extensions'; import {TooltipProvider} from '../../src/components/Tooltip';
import {contrastRatio,relativeLuminance} from '../../src/core/theme/contrast'; import {renderMermaidSvg} from '../../src/features/diagram-preview/mermaidRenderer';
import '../../src/styles/globals.css';
const p=(text,attrs={},marks=[])=>({type:'paragraph',attrs,content:[{type:'text',text,marks}]});
const colors=['#f1f5f9','#fff1f2','#fff7ed','#fefce8','#f0fdf4','#eff6ff','#faf5ff'];
const content=[p('三种主题，共享内容与颜色。'),...['note','tip','important','warning','caution'].map(kind=>({type:'githubAlert',attrs:{kind},content:[p('醒目块正文，标题、图标与文字应当清楚。')]})),
...colors.map((backgroundColor,index)=>({type:'githubAlert',attrs:{kind:'note',title:'自定义底色 '+(index+1),backgroundColor,textColor:index%2?'#c2410c':null,borderColor:index===0?'#111111':null},content:[p('自定义底色保持色相，墨夜呈现柔和深底。')]})),
...colors.map(blockBackground=>p('整段底色与嵌套文字保持可读。',{blockBackground},[{type:'textColor',attrs:{color:'#dc2626'}}])),
p('浅黄高亮、行内代码也要跟随主题。',{},[{type:'highlight',attrs:{color:'#fef08a'}},{type:'code'}]),
{type:'table',content:[{type:'tableRow',content:colors.slice(0,3).map(background=>({type:'tableCell',attrs:{background},content:[p('单元格底色')]}))}]},
{type:'mermaidBlock',attrs:{code:'flowchart LR\\n subgraph 记录\\n A[想法] -->|整理| B{是否完成}\\n B -->|是| C[归档]\\n B -.->|否| A\\n end'}},
{type:'mermaidBlock',attrs:{code:'sequenceDiagram\\n participant A as 作者\\n participant B as 文档\\n A->>B: 保存内容\\n B-->>A: 完成'}}];
const editor=new Editor({extensions:buildExtensions(),content:{type:'doc',content}}),original=JSON.stringify(editor.getJSON()),root=createRoot(document.querySelector('#root'));
root.render(<TooltipProvider><div style={{height:'100vh',overflow:'auto',padding:'20px 40px',background:'var(--editor-bg)'}} data-scroll><EditorContent editor={editor}/></div></TooltipProvider>);
window.fixture={editor,original,contrastRatio,relativeLuminance,exportSvg:()=>renderMermaidSvg('flowchart LR;A-->B','default'),destroy:()=>{root.unmount();editor.destroy();}};
`);
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--no-proxy-server'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } }), errors = [];
page.on('pageerror', error => errors.push(String(error)));
try {
  await page.goto(base + '/.tmp/dark-containers/index.html', {waitUntil:'commit'});
  await page.waitForFunction(() => window.fixture, null, {timeout:120000});
  const reports = [];
  for (const theme of ['chen-guang','mo-ye','hu-po','mo-ye']) {
    const previous = await page.locator('[data-diagram-viewport="inline"] svg').evaluateAll(elements => elements.map(element => element.id));
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await page.locator('.github-alert').last().scrollIntoViewIfNeeded();
    await page.locator('.ProseMirror > div').last().scrollIntoViewIfNeeded();
    await page.waitForFunction(previous => { const diagrams=[...document.querySelectorAll('[data-diagram-viewport="inline"] svg')];return diagrams.length===2&&diagrams.every(element=>!previous.includes(element.id)); }, previous, {timeout:120000});
    const result = await page.evaluate(() => {
      const normalize = value => { const match=/^color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)\)/.exec(value); return match?'rgb('+match.slice(1).map(channel=>Math.round(Number(channel)*255)).join(',')+')':value; };
      const background = element => {for(let node=element;node;node=node.parentElement){const fill=getComputedStyle(node).backgroundColor;if(fill!=='rgba(0, 0, 0, 0)'&&fill!=='transparent')return normalize(fill);}return '#ffffff';};
      const ratios=[]; for(const container of document.querySelectorAll('.github-alert,.ProseMirror [data-block-background],.ProseMirror [data-cell-background]')) {
        for(const target of [...(container.matches('p')?[container]:[]),...container.querySelectorAll('.alert-title,p')]) { const walker=document.createTreeWalker(target,4);let text;while((text=walker.nextNode())) if(text.textContent.trim()){const element=text.parentElement;ratios.push({text:text.textContent,ratio:window.fixture.contrastRatio(normalize(getComputedStyle(element).color),background(element))});} }
      }
      const edges=[...document.querySelectorAll('[data-diagram-viewport="inline"] svg .flowchart-link,[data-diagram-viewport="inline"] svg .messageLine0,[data-diagram-viewport="inline"] svg .messageLine1')].map(element=>window.fixture.contrastRatio(normalize(getComputedStyle(element).stroke),background(element)));
      const markers=[...document.querySelectorAll('[data-diagram-viewport="inline"] svg marker path')].filter(element=>getComputedStyle(element).fill!=='none').map(element=>({fill:getComputedStyle(element).fill,ratio:window.fixture.contrastRatio(normalize(getComputedStyle(element).fill),background(element))}));
      const fills=[...document.querySelectorAll('.github-alert[data-callout-background-color]')].map(element=>({color:normalize(getComputedStyle(element).backgroundColor),luminance:window.fixture.relativeLuminance(normalize(getComputedStyle(element).backgroundColor))}));
      return {theme:document.documentElement.dataset.theme,minimumText:Math.min(...ratios.map(r=>r.ratio)),low:ratios.filter(r=>r.ratio<4.5),edgeRatios:edges,markers,fills,hosts:document.querySelectorAll('[data-mermaid-render-host]').length};
    });
    assert.equal(result.hosts,0); assert(result.edgeRatios.length>=4); assert(result.edgeRatios.every(r=>r>=3),JSON.stringify(result)); assert(result.markers.every(marker=>marker.ratio>=3),JSON.stringify(result)); assert(result.minimumText>=4.5,JSON.stringify(result));
    if(theme==='mo-ye') assert(result.fills.every(fill=>fill.luminance<.13),JSON.stringify(result));
    reports.push(result);
    await page.screenshot({path:'.tmp/dark-containers/'+theme+'-diagrams.png'});
    await page.evaluate(()=>document.querySelector('[data-scroll]').scrollTop=0);
    await page.screenshot({path:'.tmp/dark-containers/'+theme+'-presets.png'});
    await page.locator('.github-alert[data-callout-background-color]').first().scrollIntoViewIfNeeded();
    await page.screenshot({path:'.tmp/dark-containers/'+theme+'-fills.png'});
  }
  assert.equal(await page.evaluate(()=>JSON.stringify(window.fixture.editor.getJSON())===window.fixture.original),true);
  assert.equal(await page.evaluate(()=>window.fixture.editor.getHTML().includes('nb-screen-fill')),false);
  assert.equal(await page.evaluate(()=>window.fixture.editor.view.serializeForClipboard(window.fixture.editor.state.doc.slice(0)).dom.innerHTML.includes('--nb-fill-dark')),false);
  const exported=await page.evaluate(()=>window.fixture.exportSvg()); assert(exported.includes('#333'));
  await page.evaluate(()=>window.fixture.destroy());
  assert.equal(await page.locator('[data-mermaid-render-host]').count(),0);
  assert.deepEqual(errors,[]); console.log(JSON.stringify(reports,null,2));
} catch(error) {console.error(errors);throw error;} finally {await browser.close();}
