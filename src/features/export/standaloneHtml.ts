import contentCss from './documentContent.css?inline';
import pageCss from './standalonePage.css?inline';
import katexCss from 'katex/dist/katex.min.css?raw';
import mathWrappingCss from '../../core/math/wrapping.css?inline';
import { standaloneEnhancement } from './standaloneEnhancement';

// The same KaTeX stylesheet and font files used by the editor are packaged by
// Vite. Fetch them only for an HTML export, then inline WOFF2 into that file so
// its formula geometry survives opening it offline through file://.
const katexFontUrls = import.meta.glob('../../../node_modules/katex/dist/fonts/*.woff2', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>;

async function portableKatexCss(): Promise<string> {
  const fonts = new Map(Object.entries(katexFontUrls).map(([path, url]) => [path.split('/').pop()!, url]));
  const names = [...katexCss.matchAll(/url\(fonts\/([^)]*\.woff2)\)/g)].map(match => match[1]);
  if (names.length === 0) throw new Error('公式字体样式不可用');
  const embedded = new Map(await Promise.all(names.map(async name => {
    const url = fonts.get(name);
    if (!url) throw new Error(`缺少公式字体：${name}`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`无法读取公式字体：${name}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 8192) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    }
    return [name, `data:font/woff2;base64,${btoa(binary)}`] as const;
  })));
  // KaTeX lists woff2/woff/ttf fallbacks in each rule. WOFF2 is supported by
  // the app's browser and keeps the standalone file to one copy per font.
  const css = katexCss.replace(/src:url\(fonts\/([^)]*\.woff2)\) format\("woff2"\),url\(fonts\/[^)]*\.woff\) format\("woff"\),url\(fonts\/[^)]*\.ttf\) format\("truetype"\)/g,
    (_rule, name: string) => `src:url(${embedded.get(name)}) format("woff2")`);
  if (css.includes('url(fonts/')) throw new Error('公式字体未完整内嵌');
  return css;
}

export function localFileUrl(path: string) {
  const slash = path.replace(/\\/g, '/');
  return (slash.startsWith('//') ? 'file:' : 'file:///') + slash.split('/').map((part, index) => index === 0 && /^[A-Za-z]:$/.test(part) ? part : encodeURIComponent(part)).join('/');
}

export async function standaloneHtml(html: string, title: string) {
  const escapedTitle = title.replace(/[&<>"']/g, value => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[value]!);
  // Compile shared content styles through Vite, including their imports.
  const css = contentCss + '\n' + (html.includes('class="katex') ? await portableKatexCss() + '\n' + mathWrappingCss : '') + '\n' + pageCss;
  const actions = '<nav class="export-page-actions" aria-label="文档操作"><button type="button" data-page-print>打印</button><button type="button" data-page-download>保存副本</button></nav>';
  return `<!doctype html>\n<html lang="zh-CN" data-noteboard-export><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapedTitle}</title><style>${css}</style></head><body>${actions}<main class="export-reader"><div id="document">${html}</div></main><script>${standaloneEnhancement}</script></body></html>`;
}
