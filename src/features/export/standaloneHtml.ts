import contentCss from './documentContent.css?inline';
import pageCss from './standalonePage.css?inline';
import { standaloneEnhancement } from './standaloneEnhancement';

const pageIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z M14 2v6h6 M9 12l-3 3 3 3 M15 12l3 3-3 3"/></svg>';

export function localFileUrl(path: string) {
  const slash = path.replace(/\\/g, '/');
  return (slash.startsWith('//') ? 'file:' : 'file:///') + slash.split('/').map((part, index) => index === 0 && /^[A-Za-z]:$/.test(part) ? part : encodeURIComponent(part)).join('/');
}

export function standaloneHtml(html: string, title: string) {
  const escapedTitle = title.replace(/[&<>"']/g, value => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[value]!);
  // Compile shared content styles through Vite, including their imports. Only
  // the math engine differs: native MathML needs no external fonts or scripts.
  // An inline math box follows the block's alignment while displaystyle remains
  // controlled by MathML's display attribute (large operators/fractions).
  const css = contentCss + '\n' + pageCss;
  const favicon = 'data:image/svg+xml,' + encodeURIComponent(pageIcon.replace('currentColor', '#3b82f6'));
  const toolbar = `<header class="export-page-bar"><span class="export-page-icon" aria-hidden="true">${pageIcon}</span><span class="export-page-title">${escapedTitle}</span><nav class="export-page-actions" aria-label="文档操作"><button type="button" data-page-print>打印</button><a data-page-download>保存副本</a></nav></header>`;
  return `<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapedTitle}</title><link rel="icon" href="${favicon}"><style>${css}</style></head><body>${toolbar}<main class="export-reader"><div id="document">${html}</div></main><script>${standaloneEnhancement}</script></body></html>`;
}
