import contentCss from './documentContent.css?inline';
import pageCss from './standalonePage.css?inline';
import { standaloneEnhancement } from './standaloneEnhancement';

export function localFileUrl(path: string) {
  const slash = path.replace(/\\/g, '/');
  return (slash.startsWith('//') ? 'file:' : 'file:///') + slash.split('/').map((part, index) => index === 0 && /^[A-Za-z]:$/.test(part) ? part : encodeURIComponent(part)).join('/');
}

export function standaloneHtml(html: string, title: string) {
  const escapedTitle = title.replace(/[&<>"']/g, value => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[value]!);
  // Compile shared content styles through Vite, including their imports.
  // Native MathML keeps the exported file independent of network fonts/scripts.
  const css = contentCss + '\n' + pageCss;
  const actions = '<nav class="export-page-actions" aria-label="文档操作"><button type="button" data-page-print>打印</button><button type="button" data-page-download>保存副本</button></nav>';
  return `<!doctype html>\n<html lang="zh-CN" data-noteboard-export><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapedTitle}</title><style>${css}</style></head><body>${actions}<main class="export-reader"><div id="document">${html}</div></main><script>${standaloneEnhancement}</script></body></html>`;
}
