import { convertFileSrc } from '@tauri-apps/api/core';
import { afterEach, expect, it, vi } from 'vitest';
import { rewriteHtmlPreviewAssets } from '../../src/features/editor-code/htmlPreviewAssets';

const assetUrl = (path: string) => `http://asset.localhost/${encodeURIComponent(path)}`;
vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: vi.fn((path: string) => `http://asset.localhost/${encodeURIComponent(path)}`) }));
afterEach(() => vi.clearAllMocks());

it('resolves Windows images relative to the saved document and preserves the source outside image attributes', () => {
  const source = `<!DOCTYPE html><HTML lang="zh-CN"><HEAD><title>汇报</title></HEAD><BODY>
  <IMG SRC=图/结扎处理.png data-title="原格式">
  <img src="../模型资料/肝 桥%23分区%2523.svg?scale=2&amp;edit=1#part">
  <a href="../附件/page.html">附件</a><script>const msg = '<img src="dont-load.png">';</script>
  </BODY></HTML>`;
  const rewritten = rewriteHtmlPreviewAssets(source, String.raw`C:\测试 #新稿\汇报`, '向同学汇报.html');
  expect(rewritten).toBe(source
    .replace('SRC=图/结扎处理.png', `src="${assetUrl(String.raw`C:\测试 #新稿\汇报\图\结扎处理.png`)}"`)
    .replace('../模型资料/肝 桥%23分区%2523.svg', assetUrl(String.raw`C:\测试 #新稿\模型资料\肝 桥#分区%23.svg`)));
});

it('rewrites picture candidates, SVG images, video posters, and CSS URL tokens', () => {
  const source = String.raw`
    <picture><source srcset="图/低.png, data:image/png;base64,AAA 2x, ../高清%20图.png 3x"><img src="图/低.png"></picture>
    <svg><image xlink:href="贴图.svg#image" /><use href="#image"/></svg>
    <video poster="封面.png"></video>
    <style>/* url(comment.png) */ p::before {content:"url(text.png)"} p{background:URL( '../壁纸/中 图.png' )}</style>
    <div style="background: url(图/有\20 空格.png); mask: url(#glyph)"></div>`;
  const rewritten = rewriteHtmlPreviewAssets(source, 'C:/notes/page', 'index.html');
  expect(rewritten).toContain(`srcset="${assetUrl(String.raw`C:\notes\page\图\低.png`)}, data:image/png;base64,AAA 2x, ${assetUrl(String.raw`C:\notes\高清 图.png`)} 3x"`);
  expect(rewritten).toContain(`xlink:href="${assetUrl(String.raw`C:\notes\page\贴图.svg`)}#image"`);
  expect(rewritten).toContain(`poster="${assetUrl(String.raw`C:\notes\page\封面.png`)}"`);
  expect(rewritten).toContain(`background:url("${assetUrl(String.raw`C:\notes\壁纸\中 图.png`)}")`);
  expect(rewritten).toContain(`background: url(&quot;${assetUrl(String.raw`C:\notes\page\图\有 空格.png`)}&quot;); mask: url(#glyph)`);
  expect(rewritten).toContain('/* url(comment.png) */ p::before {content:"url(text.png)"}');
  expect(rewritten).toContain('<use href="#image"/>');
});

it('uses the first active base and applies normal URL file and directory resolution', () => {
  const source = '<template><base href="no/"><img src="hidden.png"></template>'
    + '<base target="_blank"><base href="../资料/页面.html"><base href="./ignored/"><img src=图.png><img src=/root.png>';
  const rewritten = rewriteHtmlPreviewAssets(source, 'C:/notes/page', 'index.html');
  expect(rewritten).toBe(source
    .replace('src=图.png', `src="${assetUrl(String.raw`C:\notes\资料\图.png`)}"`)
    .replace('src=/root.png', `src="${assetUrl(String.raw`C:\root.png`)}"`));

  const remote = '<base href="https://example.test/"><img src="relative.png">';
  expect(rewriteHtmlPreviewAssets(remote, 'C:/notes/page', 'index.html')).toBe(remote);
});

it('keeps existing absolute sources and does not map network paths or encoded path separators', () => {
  const source = String.raw`
    <img src="//server/share/image.png"><img src="\\server\share\image.png">
    <img src="%5c%5cserver%5cshare%5cimage.png"><img src="file://server/share/image.png">
    <img src="/X:/elsewhere.png"><img src="https://example.test/img.png"><img src="data:image/png;base64,AAA">`;
  expect(rewriteHtmlPreviewAssets(source, 'C:/notes', 'test.html')).toBe(source);
  expect(rewriteHtmlPreviewAssets('<img src="./relative.png">', String.raw`\\server\share\notes`, 'test.html')).toBe('<img src="./relative.png">');
  expect(convertFileSrc).not.toHaveBeenCalled();
});
