/* global window, getComputedStyle -- page.evaluate callbacks execute in the browser. */
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
async function handleDrag(handle,dx,dy){const b=await page.locator('[data-handle="'+handle+'"]').boundingBox();await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2+dx,b.y+b.height/2+dy,{steps:8});await page.mouse.up();await page.waitForTimeout(50);}
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
 await fresh('arrow');await btn('箭头').click();await drag([.2,.3],[.7,.4]);assert.equal(await page.locator('[data-handle]').count(),3);assert.equal(await page.locator('.nb-ie-selection-frame').count(),0);
 const arrowStart=(await ops())[0];await handleDrag('vertex-1',40,-35);let arrow=(await ops())[0];assert.deepEqual(arrow.points[0],arrowStart.points[0]);assert.notDeepEqual(arrow.points[1],arrowStart.points[1]);assert.equal(arrow.style.width,arrowStart.style.width);
 const beforeMove=arrow;await handleDrag('path-move',25,30);arrow=(await ops())[0];assert(Math.abs((arrow.points[1].x-arrow.points[0].x)-(beforeMove.points[1].x-beforeMove.points[0].x))<.01);checks.push('arrow-three-point-controls');
 await page.screenshot({path:'.tmp/image-ux-arrow.png'});
 for(const [tool,label] of [['line','箭头'],['rectangle','矩形'],['ellipse','椭圆'],['marker','序号']]){
   await fresh('outside-'+tool);await btn(label).click();if(tool==='marker')await click(.2,.2);else await drag([.2,.2],[.5,.5]);const confirmed=JSON.stringify(await ops());await outside();assert.equal(await page.locator('[data-handle]').count(),0);assert.equal(JSON.stringify(await ops()),confirmed);await click(tool==='ellipse'?.35:.2,.2);assert((await page.locator('[data-handle]').count())>0);
 }
 checks.push('outside-confirms-and-allows-reselect');
 await fresh('remember-one');await btn('序号').click();await click(.4,.4);const writesBefore=await page.evaluate(()=>window.qa.preferenceWrites.length);await page.getByLabel('大小 (px)',{exact:true}).fill('96');assert.equal(await page.evaluate(()=>window.qa.preferenceWrites.length),writesBefore);await outside();assert.equal(await page.evaluate(()=>window.qa.preferenceWrites.length),writesBefore+1);
 await click(.4,.4);const markerPoint=await point(.4,.4);await page.mouse.move(markerPoint.x,markerPoint.y);await page.mouse.wheel(0,-60);await page.waitForTimeout(260);const rememberedSize=(await ops())[0].size;assert(rememberedSize>96);await outside();await btn('箭头').click();await page.getByLabel('线条粗细 (px)',{exact:true}).fill('8');await outside();await page.evaluate(()=>window.qa.suspend());key='remember-two';await page.evaluate(k=>window.qa.open(k,true),key);await ready();await btn('序号').click();await click(.25,.25);assert.equal((await ops())[0].size,rememberedSize);assert.equal((await ops())[0].value,1);await btn('箭头').click();await drag([.3,.6],[.6,.7]);assert.equal((await ops())[1].style.width,8);checks.push('tool-preferences-survive-image-reopen-without-copying-number');
 await fresh('vertices');await btn('折线').click();await click(.2,.2);await click(.45,.5);await click(.8,.3);await page.keyboard.press('Escape');await page.waitForTimeout(60);assert.equal(await page.locator('[data-handle]').count(),3);assert.equal(await page.locator('.nb-ie-selection-frame').count(),0);
 const nodes=(await ops())[0].points;await handleDrag('vertex-1',30,-20);const editedNodes=(await ops())[0].points;assert.deepEqual(editedNodes[0],nodes[0]);assert.deepEqual(editedNodes[2],nodes[2]);assert.notDeepEqual(editedNodes[1],nodes[1]);checks.push('polyline-vertex-controls');
 await fresh('erasers');await btn('箭头').click();await drag([.3,.2],[.3,.8]);await btn('序号').click();await click(.6,.5);await click(.8,.8);
 assert.equal(await page.getByRole('group',{name:'线型',exact:true}).count(),0);assert.equal(await page.getByLabel('边框粗细滑块',{exact:true}).count(),0);assert.equal(await page.getByLabel('大小滑块',{exact:true}).getAttribute('max'),'128');await btn('样式：空心').click();assert.equal(await page.getByLabel('边框粗细滑块',{exact:true}).getAttribute('max'),'8');
 await btn('椭圆').click();assert.equal(await page.getByLabel('描边粗细滑块',{exact:true}).getAttribute('max'),'16');checks.push('tool-specific-size-and-stroke-controls');
 await btn('对象擦除').click();const hover=await point(.6,.5);await page.mouse.move(hover.x,hover.y);await page.waitForTimeout(100);assert.equal(await page.locator('.nb-ie-erase-overlay').getAttribute('data-erase-radius'),'20');assert.equal(await page.locator('[data-erase-target]').count(),1);await page.screenshot({path:'.tmp/image-ux-eraser.png'});
 const eraseBefore=await history();await drag([.1,.5],[.9,.5]);assert.equal((await ops()).length,1);assert.equal((await history()).past.length,eraseBefore.past.length+1);await btn('撤销图片编辑').click();assert.equal((await ops()).length,3);checks.push('object-eraser-visible-area-preview-sweep');
 await btn('笔迹擦除').click();const inkPoint=await point(.6,.5);await page.mouse.move(inkPoint.x,inkPoint.y);await page.waitForTimeout(80);assert.equal(await page.locator('.nb-ie-erase-overlay').getAttribute('data-erase-radius'),'10');await drag([.6,.5],[.68,.55]);assert.equal((await ops()).at(-1).type,'eraser');checks.push('ink-eraser-visible-circle');
 await fresh('immediate-mirror');const pixels=()=>page.getByLabel('图片编辑画布',{exact:true}).evaluate(c=>c.toDataURL());const unflipped=await pixels();await btn('水平镜像').click({delay:180});await page.waitForTimeout(120);const horizontal=await pixels();assert.notEqual(horizontal,unflipped);await btn('垂直镜像').click({delay:180});await page.waitForTimeout(120);assert.notEqual(await pixels(),horizontal);await btn('撤销图片编辑').click({delay:180});await page.waitForTimeout(120);assert.equal(await pixels(),horizontal);checks.push('mirror-and-undo-repaint-without-canvas-click');
 await btn('关闭图片编辑').click();const discardColor=await btn('放弃改动').evaluate(e=>getComputedStyle(e).backgroundColor);assert.equal(discardColor,'rgb(220, 38, 38)');await btn('继续编辑').click();checks.push('discard-red-action');
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
