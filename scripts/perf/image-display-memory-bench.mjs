/* global document */
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
// Use an existing Playwright runtime; no dependency is added to the application.
const {chromium}=createRequire(import.meta.url)(process.env.NOTEBOARD_PLAYWRIGHT_MODULE || 'playwright');
const python=process.env.NOTEBOARD_PYTHON || 'python';
const origin=process.argv[2] || 'http://127.0.0.1:5199';
const fixtures=JSON.parse(await readFile('.tmp/image-memory-fixture/manifest.json','utf8')), rounds=[];
const median=values=>{const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.floor(sorted.length/2)];};
for(let round=1;round<=3;round++)for(const mode of ['original','preview']){
  const server=await chromium.launchServer({channel:'msedge',headless:true});
  const browser=await chromium.connect(server.wsEndpoint());
  try{
    const page=await browser.newPage({viewport:{width:1280,height:900},deviceScaleFactor:1});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`${origin}/scripts/perf/image-display-memory-bench.html?mode=${mode}`);
    await page.waitForFunction(()=>/^(READY|FAIL)/.test(document.querySelector('#status').textContent),{timeout:30000});
    const status=await page.locator('#status').textContent();if(!status.startsWith('READY')||errors.length)throw new Error(JSON.stringify({status,errors}));
    await new Promise(resolve=>setTimeout(resolve,10000));
    const group=JSON.parse(execFileSync(python,['scripts/perf/process-group-memory.py',String(server.process().pid)],{encoding:'utf8'}));
    const cdp=await page.context().newCDPSession(page), heap=await cdp.send('Runtime.getHeapUsage'),dom=await cdp.send('Memory.getDOMCounters');
    const metrics={round,mode,status,browserVersion:browser.version(),group,heap,dom,medianMiB:Object.fromEntries(['privateCommit','privateWorkingSet','workingSet'].map(field=>[field,Math.round(median(group.samples.map(sample=>sample[field]))/1048576*100)/100]))};
    rounds.push(metrics);await writeFile('.tmp/image-memory-ab.json',JSON.stringify({method:{viewport:[1280,900],dpr:1,cssImage:[600,337.5],settleSeconds:10,samples:7,intervalSeconds:.4,forceGc:false,cacheTrim:false},fixtures,rounds},null,2));
    console.log(JSON.stringify({round,mode,medianMiB:metrics.medianMiB,heap,dom}));
  }finally{await browser.close();await server.close().catch(()=>{});}
}
const summary=Object.fromEntries(['privateCommit','privateWorkingSet','workingSet'].map(field=>{const before=median(rounds.filter(r=>r.mode==='original').map(r=>r.medianMiB[field])),after=median(rounds.filter(r=>r.mode==='preview').map(r=>r.medianMiB[field]));return[field,{before,after,delta:Math.round((before-after)*100)/100}];}));
await writeFile('.tmp/image-memory-ab-summary.json',JSON.stringify(summary,null,2));console.log(JSON.stringify({summary}));
