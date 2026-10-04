/* global window, performance, ClipboardEvent, DataTransfer */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {build, preview} from 'vite';
import react from '@vitejs/plugin-react';

const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const directory='.tmp/cjk-formatting', outDir=directory+'/dist';
await fs.mkdir(directory,{recursive:true});
await fs.writeFile(directory+'/index.html','<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/test/browser/cjkFormatting.tsx"></script></body></html>');
if(!process.argv.includes('--reuse')) await build({configFile:false,plugins:[react()],worker:{format:'es'},build:{outDir,emptyOutDir:true,rollupOptions:{input:directory+'/index.html'}},logLevel:'error'});
const server=await preview({configFile:false,build:{outDir},preview:{host:'127.0.0.1',port:0},logLevel:'error'});
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1400,height:1000}}),cdp=await page.context().newCDPSession(page);
const browserCdp=await browser.newBrowserCDPSession();
const runFile=promisify(execFile);
const errors=[],result={formats:[],cycles:[],errors};
page.on('pageerror',error=>errors.push(error.message));
await page.route('**/*',route=>/^https?:\/\/127\.0\.0\.1(:|\/)/.test(route.request().url())?route.continue():route.abort());
const load=async text=>{await page.evaluate(text=>window.cjkQA.load(text),text);await page.waitForTimeout(250);};
const state=()=>page.evaluate(()=>window.cjkQA.editor().getJSON());
const snapshot=async()=>{
 await cdp.send('HeapProfiler.collectGarbage');const {usedSize}=await cdp.send('Runtime.getHeapUsage');
 const memory={heapMiB:usedSize/1048576,...await cdp.send('Memory.getDOMCounters')};
 if(process.env.PYTHON){
  const {processInfo}=await browserCdp.send('SystemInfo.getProcessInfo');
  const {stdout}=await runFile(process.env.PYTHON,['-c','import json,psutil,sys\nvalues=[]\nfor pid in json.loads(sys.argv[1]):\n try: values.append(psutil.Process(pid).memory_full_info().uss)\n except psutil.NoSuchProcess: pass\nprint(sum(values)/1048576)',JSON.stringify([...new Set(processInfo.map(p=>p.id))])],{encoding:'utf8',windowsHide:true});
  memory.browserPrivateMiB=Number(stdout.trim());
 }
 return memory;
};
try{
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/${directory}/index.html`);
 await page.waitForFunction(()=>window.cjkQA?.ready());await page.waitForTimeout(500);
 for(const delimiter of ['**','*','***','__','_','___','~~','++']){
  await load('所以，');await page.evaluate(()=>window.cjkQA.editor().commands.focus('end'));
  await page.keyboard.type(delimiter);await page.keyboard.insertText('得到两种分子。');await page.keyboard.type(delimiter);await page.keyboard.insertText('这就是来源。');
  const json=await state(),paragraph=json.content[0];
  assert.equal(paragraph.content.map(n=>n.text||'').join(''),'所以，得到两种分子。这就是来源。');
  assert(paragraph.content.find(n=>n.text==='得到两种分子。')?.marks?.length);
  assert(!paragraph.content.at(-1).marks?.length);
  await page.evaluate(()=>window.cjkQA.mode('source'));await page.locator('.cm-editor:visible').waitFor();
  const syntax=await page.evaluate(()=>window.cjkQA.syntax());assert(/StrongEmphasis|Emphasis|NBStrikethrough|NBUnderline/.test(syntax));
  await page.evaluate(()=>window.cjkQA.mode('visual'));await page.locator('.ProseMirror:visible').waitFor();
  assert.deepEqual(await state(),json);result.formats.push({delimiter,syntax});
 }
 // Chromium composition events, including a live candidate then commit.
 await load('所以，**');await page.evaluate(()=>window.cjkQA.editor().commands.focus('end'));
 await cdp.send('Input.imeSetComposition',{text:'得到两种分子。',selectionStart:8,selectionEnd:8});
 await cdp.send('Input.insertText',{text:'得到两种分子。'});await page.keyboard.type('**');
 assert((await state()).content[0].content.some(n=>n.text==='得到两种分子。'&&n.marks?.some(m=>m.type==='bold')));result.ime=true;
 await load('');await page.locator('.ProseMirror').focus();
 await page.locator('.ProseMirror').evaluate(element=>{const data=new DataTransfer();data.setData('text/plain','前**粗体。**后 ~~删掉。~~后 ++下划线。++后');element.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));});
 assert.equal((await state()).content[0].content.map(n=>n.text||'').join(''),'前粗体。后 删掉。后 下划线。后');result.paste=true;
 await load('');await page.evaluate(()=>window.cjkQA.editor().commands.focus('end'));
 await page.keyboard.type('==');await page.keyboard.insertText('中文。');await page.keyboard.type('==');
 assert.equal((await state()).content[0].content.map(n=>n.text||'').join(''),'==中文。==');result.restrictedInputPreserved=true;
 await page.screenshot({path:directory+'/visual.png'});
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/${directory}/index.html?stress`);
 await page.waitForFunction(()=>window.cjkQA?.ready());await page.waitForTimeout(500);
 assert.equal((await state()).content.length,1000);
 for(let cycle=0;cycle<6;cycle++){
  const begin=performance.now();
  await page.evaluate(()=>window.cjkQA.mode('source'));await page.locator('.cm-editor:visible').waitFor();
  await page.evaluate(()=>window.cjkQA.mode('visual'));await page.locator('.ProseMirror:visible').waitFor();
  await page.evaluate(()=>window.cjkQA.editor().commands.focus('end'));
  await page.keyboard.type(' **');await page.keyboard.insertText('中文。');await page.keyboard.type('**');
  await page.waitForTimeout(600);
  assert.equal((await state()).content.length,1000,'All paragraphs must survive each real mode switch');
  result.cycles.push({cycle,milliseconds:performance.now()-begin,...await snapshot()});
 }
 assert.equal(errors.length,0,JSON.stringify(errors));
 const first=result.cycles[1],last=result.cycles.at(-1);
 assert(last.heapMiB-first.heapMiB<12,'Repeated source/visual switching must retain bounded memory');
 assert(last.nodes-first.nodes<600,'Repeated switching must not retain whole editor trees');
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/${directory}/index.html?native`);
 await page.waitForFunction(()=>window.cjkQA?.ready());await page.waitForTimeout(500);
 await load('所以，');await page.evaluate(()=>window.cjkQA.editor().commands.focus('end'));
 await page.keyboard.type('==');await page.keyboard.insertText('中文。');await page.keyboard.type('==');
 assert((await state()).content[0].content.some(n=>n.text==='中文。'&&n.marks?.some(m=>m.type==='highlight')));result.nativeHighlight=true;
 assert.equal(errors.length,0,JSON.stringify(errors));
 console.log(JSON.stringify(result));
}finally{await fs.writeFile(directory+'/results.json',JSON.stringify(result,null,2));await browser.close();await server.close();}
