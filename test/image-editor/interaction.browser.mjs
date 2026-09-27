/* global window -- page.evaluate callbacks execute in the browser. */
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
await mkdir('.tmp', {recursive:true});
const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL || 'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1280,height:860}}), errors=[];
page.on('pageerror',e=>errors.push(e.message));
const btn=name=>page.getByRole('button',{name,exact:true});
let key='a'; const history=()=>page.evaluate(k=>window.qa.draft(k),key); const ops=async()=>(await history()).present.recipe.operations;
async function ready(){await page.getByLabel('图片编辑画布',{exact:true}).waitFor();await page.waitForTimeout(100);}
async function fresh(name){key=name;await page.evaluate(k=>window.qa.open(k),key);await ready();}
async function point(x,y){const b=await page.getByLabel('图片编辑画布',{exact:true}).boundingBox();return {x:b.x+x*b.width,y:b.y+y*b.height};}
async function click(x,y){const p=await point(x,y);await page.mouse.click(p.x,p.y);await page.waitForTimeout(50);}
async function drag(a,b){const p=await point(...a),q=await point(...b);await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(q.x,q.y,{steps:10});await page.mouse.up();await page.waitForTimeout(50);}
async function outside(){const b=await page.locator('.nb-ie-stage').boundingBox();await page.mouse.click(b.x+8,b.y+8);await page.waitForTimeout(60);}
async function handleDrag(handle,dx,dy){const b=await page.getByLabel('缩放标注 '+handle,{exact:true}).boundingBox();await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2+dx,b.y+b.height/2+dy,{steps:8});await page.mouse.up();await page.waitForTimeout(50);}
const checks=[];
try {
 await page.goto((process.env.NOTEBOARD_TEST_URL || 'http://127.0.0.1:5199') + '/test/image-editor/interaction.browser.html');await ready();
 for(const end of ['right','Escape','outside']){
   await fresh('poly-'+end);await btn('折线').click();await click(.2,.2);await click(.4,.4);const p=await point(.7,.25);await page.mouse.move(p.x,p.y);await page.waitForTimeout(60);
   if(end==='right')await page.mouse.click(p.x,p.y,{button:'right'});else if(end==='outside')await outside();else await page.keyboard.press('Escape');
   await page.waitForTimeout(60);const path=(await ops())[0];assert.equal(path.type,'polyline');assert.equal(path.points.length,2);assert(Math.abs(path.points[1].x-480)<3);assert.equal(await page.getByLabel('图片编辑画布',{exact:true}).count(),1);checks.push('polyline-'+end);
 }
 await fresh('objects');await btn('序号').click();await click(.35,.3);assert.equal(await page.locator('[data-handle]').count(),8);
 await drag([.35,.3],[.45,.4]);assert(Math.abs((await ops())[0].center.x-540)<3);
 const before=await history();const p=await point(.45,.4);await page.mouse.move(p.x,p.y);await page.mouse.wheel(0,-60);await page.mouse.wheel(0,-60);await page.waitForTimeout(260);
 const scaled=await history();assert.equal(scaled.past.length,before.past.length+1);assert(scaled.present.recipe.operations[0].size>before.present.recipe.operations[0].size);
 await btn('撤销图片编辑').click();assert.equal((await ops())[0].size,before.present.recipe.operations[0].size);await click(.45,.4);await handleDrag('se',30,20);assert((await ops())[0].size>before.present.recipe.operations[0].size);checks.push('marker-direct-drag-wheel-handles-undo');
 await btn('蓝色').click();assert.equal((await ops())[0].style.color,'#3b82f6');
 const slider=page.getByLabel('大小滑块',{exact:true});await slider.scrollIntoViewIfNeeded();const sb=await slider.boundingBox(),hist=await history();await page.mouse.move(sb.x+sb.width*.4,sb.y+sb.height/2);await page.mouse.down();await page.mouse.move(sb.x+sb.width*.8,sb.y+sb.height/2,{steps:12});await page.mouse.up();await page.waitForTimeout(80);assert.equal((await history()).past.length,hist.past.length+1);checks.push('palette-slider-one-undo');
 await page.screenshot({path:'.tmp/image-ux-properties.png'});
 await fresh('touch');await btn('序号').click();await click(.45,.45);const touchBefore=await history(),center=await point(.45,.45);const cdp=await page.context().newCDPSession(page);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:center.x,y:center.y,id:1}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:center.x,y:center.y,id:1},{x:center.x+60,y:center.y,id:2}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:center.x-20,y:center.y,id:1},{x:center.x+80,y:center.y,id:2}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(260);await cdp.detach();const touchAfter=await history();assert.equal(touchAfter.past.length,touchBefore.past.length+1);assert(touchAfter.present.recipe.operations[0].size>touchBefore.present.recipe.operations[0].size);checks.push('two-finger-object-pinch');
 await page.getByLabel('缩放标注 e',{exact:true}).focus();const keyBefore=(await ops())[0].size;await page.keyboard.press('ArrowRight');await page.waitForTimeout(60);assert((await ops())[0].size>keyBefore);checks.push('keyboard-resize-handle');
 await fresh('text');await btn('文字').click();await click(.25,.3);const text=page.getByLabel('画布文字',{exact:true});await text.fill('图上输入文字\n第二行');await page.screenshot({path:'.tmp/image-ux-text.png'});await outside();assert.equal((await ops())[0].text,'图上输入文字\n第二行');
 await click(.28,.32);await text.waitFor();await text.fill('可以再次编辑');await btn('文字加粗').click();assert.equal(await text.count(),1);await outside();assert.equal((await ops())[0].bold,true);assert.equal((await ops())[0].text,'可以再次编辑');
 await drag([.28,.32],[.48,.52]);assert((await ops())[0].position.x>500);await btn('撤销图片编辑').click();assert(Math.abs((await ops())[0].position.x-300)<3);checks.push('inline-text-reedit-style-move-undo');
 await fresh('shapes');await btn('矩形').click();await drag([.2,.2],[.45,.4]);const r=(await ops())[0].rect;await handleDrag('e',55,0);const r2=(await ops())[0].rect;assert(r2.width>r.width);assert.equal(r2.height,r.height);checks.push('rectangle-free-resize');
 await btn('马赛克').click();await btn('绘制方式：画笔').click();await drag([.65,.2],[.75,.5]);assert.equal((await ops()).at(-1).type,'mosaic-brush');assert.equal(await page.locator('[data-handle]').count(),0);await btn('绘制方式：矩形').click();await drag([.2,.65],[.4,.8]);assert.equal((await ops()).at(-1).type,'mosaic');await drag([.3,.7],[.4,.75]);assert((await ops()).at(-1).rect.x>350);checks.push('mosaic-modes');
 await btn('放大镜').click();await drag([.65,.65],[.9,.78]);const mag=(await ops()).at(-1);assert.equal(mag.type,'magnifier');assert(mag.rect.width>mag.rect.height*2);assert.equal(await page.locator('[data-handle]').count(),8);checks.push('elliptical-magnifier');
 await fresh('crop');await btn('裁剪').click();assert.equal(await page.locator('[data-handle]').count(),8);const initial=(await history()).present.recipe.crop;await handleDrag('se',-100,-70);assert.deepEqual((await history()).present.recipe.crop,initial);await btn('应用裁剪').click();assert((await history()).present.recipe.crop.width<initial.width);
 const applied=(await history()).present.recipe.crop;await btn('裁剪').click();await handleDrag('nw',35,30);await page.keyboard.press('Escape');assert.deepEqual((await history()).present.recipe.crop,applied);assert.equal(await page.locator('.nb-ie-crop-frame').count(),0);
 await btn('裁剪').click();await page.getByLabel('裁剪比例',{exact:true}).selectOption('1');await page.getByLabel('图片编辑画布',{exact:true}).focus();await page.keyboard.press('Enter');const square=(await history()).present.recipe.crop;assert(Math.abs(square.width-square.height)<1);checks.push('crop-initial-frame-apply-cancel-enter');
 await page.getByLabel('导出比例',{exact:true}).fill('200');assert.equal(await page.getByLabel('导出比例',{exact:true}).inputValue(),'100');checks.push('no-export-upscale');
 const persisted=JSON.stringify((await history()).present);await page.evaluate(()=>window.qa.suspend());await page.evaluate(k=>window.qa.open(k),key);await ready();assert.equal(JSON.stringify((await history()).present),persisted);checks.push('draft-resume');
 await page.setViewportSize({width:760,height:680});await page.screenshot({path:'.tmp/image-ux-narrow.png'});const layout=await page.locator('.nb-ie-dialog').evaluate(e=>({client:e.clientWidth,scroll:e.scrollWidth}));assert(layout.scroll<=layout.client+1);
 await page.getByLabel('导出格式',{exact:true}).selectOption('image/webp');await page.getByLabel('导出比例',{exact:true}).fill('50');await btn('保存图片').click();await page.waitForFunction(()=>window.qa.saved.length===1);const saved=await page.evaluate(()=>window.qa.saved);assert.equal(saved[0].metadata.mimeType,'image/webp');assert.deepEqual(errors,[]);checks.push('narrow-layout-export');
 await writeFile('.tmp/image-ux-browser.json',JSON.stringify({passed:true,checks,saved,errors},null,2));console.log(JSON.stringify({passed:true,checks,saved}));
} catch(e){await page.screenshot({path:'.tmp/image-ux-failure.png'});console.error(e);console.error('Passed:',checks);console.error(await page.locator('body').innerText());console.error(errors);process.exitCode=1;}
finally{await browser.close();}
