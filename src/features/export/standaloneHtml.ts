import documentCss from './document.css?raw';
import richCss from './richDocument.css?raw';
import tableCss from '../editor-md/tablePresentation.css?raw';

/** Enhancement is optional: without scripts every image remains in the flow. */
const enhancement = `(()=>{
  for(const collection of document.querySelectorAll('.export-image-carousel')){
    const slots=Array.from(collection.children).filter(slot=>slot.matches('.export-image-slot:not([data-empty])'));
    if(slots.length<2)continue;
    let current=0;
    const controls=document.createElement('nav');controls.className='export-carousel-controls';controls.setAttribute('aria-label','图片翻页');
    const previous=document.createElement('button'),next=document.createElement('button'),status=document.createElement('span');
    previous.textContent='上一张';next.textContent='下一张';previous.type=next.type='button';status.setAttribute('aria-live','polite');
    const show=index=>{slots[current].removeAttribute('data-current');current=(index+slots.length)%slots.length;slots[current].setAttribute('data-current','');status.textContent=(current+1)+' / '+slots.length};
    previous.onclick=()=>show(current-1);next.onclick=()=>show(current+1);controls.append(previous,status,next);collection.append(controls);collection.setAttribute('data-enhanced','');show(0);
  }
  const closed=[];addEventListener('beforeprint',()=>{for(const item of document.querySelectorAll('details:not([open])')){closed.push(item);item.open=true}});addEventListener('afterprint',()=>{for(const item of closed.splice(0))item.open=false});
})();`;

export function localFileUrl(path: string) {
  const slash = path.replace(/\\/g, '/');
  return (slash.startsWith('//') ? 'file:' : 'file:///') + slash.split('/').map((part, index) => index === 0 && /^[A-Za-z]:$/.test(part) ? part : encodeURIComponent(part)).join('/');
}

export function standaloneHtml(html: string, title: string) {
  const escapedTitle = title.replace(/[&<>"']/g, value => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[value]!);
  // Native MathML keeps formulas self-contained without remote fonts or scripts.
  const css = tableCss + documentCss.replace(/^@import[^\n]*\n/gm, '') + richCss + '\n:root{--export-font:11pt;--export-line:1.5;--export-width:100%}body{max-width:900px;margin:2em auto;padding:0 1.5em}.katex-html{display:none}.katex-mathml{position:static!important;clip:auto!important;width:auto!important;height:auto!important}.export-math.display math{display:block math;margin:.5em auto}@media print{body{max-width:none;margin:0;padding:0}details::details-content{content-visibility:visible!important}}';
  return `<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapedTitle}</title><style>${css}</style></head><body>${html}<script>${enhancement}</script></body></html>`;
}
