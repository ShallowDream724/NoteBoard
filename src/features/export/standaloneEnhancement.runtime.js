/* global document, print, Blob, HTMLImageElement, addEventListener, navigator, innerWidth, innerHeight, clearTimeout */
(()=>{
  const root=document.getElementById('document');
  const notes=new Map(Array.from(root?.querySelectorAll('[data-annotation-body]')||[],body=>[body.dataset.annotationBody,{body,parent:body.parentNode,next:body.nextSibling}]));
  const panel=document.createElement('section'),header=document.createElement('div'),title=document.createElement('span'),dismiss=document.createElement('button'),content=document.createElement('div');
  panel.id='export-annotation-panel';panel.className='export-annotation-panel';panel.hidden=true;panel.setAttribute('role','dialog');panel.setAttribute('aria-label','补充说明');
  header.className='export-annotation-header';title.className='export-annotation-title';title.textContent='补充说明';dismiss.className='export-annotation-close';dismiss.type='button';dismiss.textContent='×';dismiss.setAttribute('aria-label','关闭补充说明');content.className='export-annotation-content';header.append(title,dismiss);panel.append(header,content);document.body.append(panel);
  let active=null,record=null,pinned=false,leaveTimer,restoringFocus=false;
  const placeAnnotation=()=>{if(!active||panel.hidden)return;const rect=active.getBoundingClientRect();panel.style.left=Math.max(8,Math.min(rect.left,innerWidth-panel.offsetWidth-8))+'px';panel.style.top=Math.max(8,Math.min(rect.bottom+8+panel.offsetHeight<=innerHeight?rect.bottom+8:rect.top-panel.offsetHeight-8,innerHeight-panel.offsetHeight-8))+'px'};
  const closeAnnotation=(restore=false)=>{clearTimeout(leaveTimer);const previous=active;if(record){record.parent.insertBefore(record.body,record.next?.parentNode===record.parent?record.next:null)}if(active)active.setAttribute('aria-expanded','false');panel.hidden=true;active=record=null;pinned=false;if(restore&&previous){restoringFocus=true;previous.focus({preventScroll:true});restoringFocus=false}};
  const showAnnotation=(trigger,pin=false,focus=false)=>{const next=notes.get(trigger.dataset.exportAnnotation);if(!next)return;clearTimeout(leaveTimer);if(active!==trigger){closeAnnotation();active=trigger;record=next;content.append(next.body)}pinned=pinned||pin;trigger.setAttribute('aria-expanded','true');panel.hidden=false;placeAnnotation();if(focus)dismiss.focus({preventScroll:true})};
  const scheduleClose=()=>{if(!pinned)leaveTimer=setTimeout(()=>closeAnnotation(),180)};
  dismiss.onclick=()=>closeAnnotation(true);panel.addEventListener('pointerenter',()=>clearTimeout(leaveTimer));panel.addEventListener('pointerleave',scheduleClose);
  root?.addEventListener('pointerover',event=>{const trigger=event.target.closest('[data-export-annotation]');if(trigger&&!trigger.contains(event.relatedTarget))showAnnotation(trigger)});
  root?.addEventListener('pointerout',event=>{const trigger=event.target.closest('[data-export-annotation]');if(trigger&&!trigger.contains(event.relatedTarget))scheduleClose()});
  root?.addEventListener('focusin',event=>{const trigger=event.target.closest('[data-export-annotation]');if(trigger&&!restoringFocus)showAnnotation(trigger)});
  root?.addEventListener('click',event=>{const trigger=event.target.closest('[data-export-annotation]');if(!trigger)return;event.preventDefault();if(active===trigger&&pinned)closeAnnotation();else showAnnotation(trigger,true)});
  root?.addEventListener('keydown',event=>{const trigger=event.target.closest('[data-export-annotation]');if(trigger&&(event.key==='Enter'||event.key===' ')){event.preventDefault();showAnnotation(trigger,true,true)}});
  document.addEventListener('pointerdown',event=>{if(active&&!panel.contains(event.target)&&!active.contains(event.target))closeAnnotation()});
  document.addEventListener('focusin',event=>{if(active&&!panel.contains(event.target)&&!active.contains(event.target))closeAnnotation()});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!panel.hidden){event.preventDefault();closeAnnotation(true)}});
  addEventListener('resize',placeAnnotation);addEventListener('scroll',placeAnnotation,true);
  const copyCode=async text=>{if(navigator.clipboard?.writeText){try{await navigator.clipboard.writeText(text);return}catch{/* file previews may deny clipboard access */}}const field=document.createElement('textarea');field.value=text;field.setAttribute('aria-hidden','true');field.style.cssText='position:fixed;left:-9999px;top:0';document.body.append(field);const previous=document.activeElement;field.select();let copied=false;try{copied=document.execCommand('copy')}finally{field.remove();previous?.focus({preventScroll:true})}if(!copied)throw new Error('copy denied')};
  const codeAction=async event=>{const control=event.target.closest('[data-code-copy],[data-code-wrap],[data-code-collapse]');if(!control)return;const block=control.closest('.export-code-block'),pre=block?.querySelector('pre'),code=pre?.querySelector('code');if(!block||!code)return;if(control.hasAttribute('data-code-wrap')){const wrap=block.toggleAttribute('data-wrap');control.setAttribute('aria-pressed',String(wrap))}else if(control.hasAttribute('data-code-collapse')){const collapsed=block.toggleAttribute('data-collapsed');pre.hidden=collapsed;control.setAttribute('aria-expanded',String(!collapsed));control.setAttribute('aria-label',collapsed?'展开代码块':'折叠代码块');control.textContent=collapsed?'›':'⌄'}else{const status=block.querySelector('[role=status]');try{await copyCode(code.textContent||'');control.textContent='已复制';status.textContent='代码已复制'}catch{control.textContent='复制失败';status.textContent='无法自动复制，请选择代码后复制'}setTimeout(()=>{control.textContent='复制';status.textContent=''},2000)}};
  root?.addEventListener('click',codeAction);panel.addEventListener('click',codeAction);
  const icon=direction=>'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+(direction<0?'m14.5 5-7 7 7 7':'m9.5 5 7 7-7 7')+'"/></svg>';
  for(const collection of document.querySelectorAll('.export-image-carousel')){
    const slots=Array.from(collection.children).filter(slot=>slot.matches('.export-image-slot:not([data-empty])'));
    if(slots.length<2)continue;
    let current=0;
    const controls=document.createElement('nav');controls.className='export-carousel-controls';controls.setAttribute('aria-label','图片翻页');
    const previous=document.createElement('button'),next=document.createElement('button'),status=document.createElement('span'),dots=document.createElement('span');
    previous.innerHTML=icon(-1);next.innerHTML=icon(1);previous.type=next.type='button';previous.setAttribute('aria-label','上一张');next.setAttribute('aria-label','下一张');
    status.className='export-sr-only';status.setAttribute('aria-live','polite');dots.className='export-carousel-dots';
    const buttons=slots.map((slot,index)=>{const button=document.createElement('button');button.type='button';button.setAttribute('aria-label','第 '+(index+1)+' 张');button.onclick=()=>show(index);dots.append(button);return button});
    const show=index=>{slots[current].removeAttribute('data-current');current=Math.max(0,Math.min(slots.length-1,index));slots[current].setAttribute('data-current','');status.textContent=(current+1)+' / '+slots.length;buttons.forEach((button,i)=>button.setAttribute('aria-current',String(i===current)));previous.disabled=current===0;next.disabled=current===slots.length-1};
    previous.onclick=()=>show(current-1);next.onclick=()=>show(current+1);controls.append(previous,dots,next,status);collection.append(controls);collection.setAttribute('data-enhanced','');show(0);
  }
  document.querySelector('[data-page-print]')?.addEventListener('click',()=>print());
  document.querySelector('[data-page-download]')?.addEventListener('click',()=>{
    closeAnnotation();
    const copy=document.documentElement.cloneNode(true);
    copy.querySelectorAll('.export-image-dialog,.export-carousel-controls,.export-annotation-panel').forEach(element=>element.remove());
    copy.querySelectorAll('.export-image-carousel').forEach(element=>element.removeAttribute('data-enhanced'));
    copy.querySelectorAll('.export-image-slot').forEach(element=>element.removeAttribute('data-current'));
    const blob=new Blob(['<!doctype html>\n',copy.outerHTML],{type:'text/html;charset=utf-8'});
    const url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download=document.title.replace(/[<>:"?*|]/g,'_').replaceAll('/','_').replaceAll(String.fromCharCode(92),'_')+'.html';link.hidden=true;
    document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
  });
  const dialog=document.createElement('dialog'),close=document.createElement('button'),image=document.createElement('img');dialog.className='export-image-dialog';dialog.setAttribute('aria-label','图片预览');close.type='button';close.textContent='关闭';dialog.append(close,image);document.body.append(dialog);
  const open=source=>{image.src=source.currentSrc||source.src;image.alt=source.alt;dialog.showModal()};
  close.onclick=()=>dialog.close();dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close()});dialog.addEventListener('close',()=>image.removeAttribute('src'));
  for(const picture of root?.querySelectorAll('img')||[]){if(picture.closest('a[href]'))continue;picture.tabIndex=0;picture.setAttribute('role','button');picture.setAttribute('aria-label',picture.alt?'查看图片：'+picture.alt:'查看图片')}
  for(const surface of [root,panel]){surface?.addEventListener('click',event=>{if(event.target instanceof HTMLImageElement&&event.target.getAttribute('role')==='button')open(event.target)});surface?.addEventListener('keydown',event=>{if(event.target instanceof HTMLImageElement&&event.target.getAttribute('role')==='button'&&(event.key==='Enter'||event.key===' ')){event.preventDefault();open(event.target)}})}
  const closed=[];addEventListener('beforeprint',()=>{closeAnnotation();for(const item of document.querySelectorAll('details:not([open])')){closed.push(item);item.open=true}});addEventListener('afterprint',()=>{for(const item of closed.splice(0))item.open=false});
})();
