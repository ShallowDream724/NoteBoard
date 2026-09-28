/** Embedded only into exported files. No application state or desktop APIs. */
export const standaloneEnhancement = `(()=>{
  const root=document.getElementById('document');
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
    const copy=document.documentElement.cloneNode(true);
    copy.querySelectorAll('.export-image-dialog,.export-carousel-controls').forEach(element=>element.remove());
    copy.querySelectorAll('.export-image-carousel').forEach(element=>element.removeAttribute('data-enhanced'));
    copy.querySelectorAll('.export-image-slot').forEach(element=>element.removeAttribute('data-current'));
    const blob=new Blob(['<!doctype html>\\n',copy.outerHTML],{type:'text/html;charset=utf-8'});
    const url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download=document.title.replace(/[<>:"?*|]/g,'_').replaceAll('/','_').replaceAll(String.fromCharCode(92),'_')+'.html';link.hidden=true;
    document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
  });
  const dialog=document.createElement('dialog'),close=document.createElement('button'),image=document.createElement('img');dialog.className='export-image-dialog';dialog.setAttribute('aria-label','图片预览');close.type='button';close.textContent='关闭';dialog.append(close,image);document.body.append(dialog);
  const open=source=>{image.src=source.currentSrc||source.src;image.alt=source.alt;dialog.showModal()};
  close.onclick=()=>dialog.close();dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close()});dialog.addEventListener('close',()=>image.removeAttribute('src'));
  for(const picture of root?.querySelectorAll('img')||[]){if(picture.closest('a[href]'))continue;picture.tabIndex=0;picture.setAttribute('role','button');picture.setAttribute('aria-label',picture.alt?'查看图片：'+picture.alt:'查看图片')}
  root?.addEventListener('click',event=>{if(event.target instanceof HTMLImageElement&&event.target.getAttribute('role')==='button')open(event.target)});
  root?.addEventListener('keydown',event=>{if(event.target instanceof HTMLImageElement&&event.target.getAttribute('role')==='button'&&(event.key==='Enter'||event.key===' ')){event.preventDefault();open(event.target)}});
  const closed=[];addEventListener('beforeprint',()=>{for(const item of document.querySelectorAll('details:not([open])')){closed.push(item);item.open=true}});addEventListener('afterprint',()=>{for(const item of closed.splice(0))item.open=false});
})();`;
