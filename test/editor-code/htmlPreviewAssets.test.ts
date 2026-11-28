import { convertFileSrc } from '@tauri-apps/api/core';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { loadHtmlPreviewAssets, planHtmlPreview } from '../../src/features/editor-code/htmlPreviewAssets';

vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: vi.fn((path: string) => `http://asset.localhost/${encodeURIComponent(path)}`) }));
const image = 'data:image/png;base64,AA==';
const svg = 'data:image/svg+xml;base64,AA==';
const fetchAsset = vi.fn<typeof fetch>();
function fixtureResponse(mime: string): Response {
  const response = new Response(null, { headers: { 'Content-Type': mime } });
  vi.spyOn(response, 'blob').mockResolvedValue(new Blob([new Uint8Array([0])], { type: mime }));
  return response;
}
beforeEach(() => {
  vi.stubGlobal('fetch', fetchAsset);
  fetchAsset.mockImplementation(async url => {
    const extension = String(url).split('.').pop();
    const mime = extension === 'svg' ? 'image/svg+xml' : extension === 'woff2' ? 'application/font-woff' : 'image/png';
    return fixtureResponse(mime);
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function preview(source: string, directory: string, name: string): Promise<string> {
  const plan = planHtmlPreview(source, directory, name).assets;
  return plan ? loadHtmlPreviewAssets(plan, new AbortController().signal) : source;
}

it('loads Windows images from the document directory and preserves HTML outside image attributes', async () => {
  const source = `<!DOCTYPE html><HTML lang="zh-CN"><HEAD><title>汇报</title></HEAD><BODY>
  <IMG SRC=图/结扎处理.png data-title="原格式">
  <img src="../模型资料/肝 桥%23分区%2523.svg?scale=2&amp;edit=1#part">
  <a href="../附件/page.html">附件</a><script>const msg = '<img src="dont-load.png">';</script>
  </BODY></HTML>`;
  const rewritten = await preview(source, String.raw`C:\测试 #新稿\汇报`, '向同学汇报.html');
  expect(rewritten).toBe(source
    .replace('SRC=图/结扎处理.png', `src="${image}"`)
    .replace('../模型资料/肝 桥%23分区%2523.svg?scale=2&amp;edit=1#part', `${svg}#part`));
  expect(convertFileSrc).toHaveBeenCalledWith(String.raw`C:\测试 #新稿\汇报\图\结扎处理.png`);
  expect(convertFileSrc).toHaveBeenCalledWith(String.raw`C:\测试 #新稿\模型资料\肝 桥#分区%23.svg`);
});

it('embeds picture candidates, SVG images, video posters, and CSS resources with one read per file', async () => {
  const source = String.raw`
    <picture><source srcset="图/低.png, data:image/png;base64,AAA 2x, ../高清%20图.png 3x"><img src="图/低.png?v=2"></picture>
    <svg><image xlink:href="贴图.svg#image" /><use href="#image"/></svg>
    <video poster="封面.png"></video>
    <style>/* url(comment.png) */ p::before {content:"url(text.png)"} p{background:URL( '../壁纸/中 图.png' )}
    @font-face { font-family: sample; src: url(type.woff2) format('woff2') }</style>
    <div style="background: url(图/有\20 空格.png); mask: url(#glyph)"></div>`;
  const rewritten = await preview(source, 'C:/notes/page', 'index.html');
  expect(rewritten).toContain(`srcset="${image}, data:image/png;base64,AAA 2x, ${image} 3x"`);
  expect(rewritten).toContain(`xlink:href="${svg}#image"`);
  expect(rewritten).toContain(`poster="${image}"`);
  expect(rewritten).toContain(`background:url("${image}")`);
  expect(rewritten).toContain(`background: url(&quot;${image}&quot;); mask: url(#glyph)`);
  expect(rewritten).toContain(`url("data:font/woff2;base64,AA==") format('woff2')`);
  expect(rewritten).toContain('/* url(comment.png) */ p::before {content:"url(text.png)"}');
  expect(rewritten).toContain('<use href="#image"/>');
  expect(fetchAsset).toHaveBeenCalledTimes(7);
  expect(convertFileSrc).toHaveBeenCalledWith(String.raw`C:\notes\page\图\有 空格.png`);
});

it('uses the first active base and applies normal URL file and directory resolution', async () => {
  const source = '<template><base href="no/"><img src="hidden.png"></template>'
    + '<base target="_blank"><base href="../资料/页面.html"><base href="./ignored/"><img src=图.png><img src=/root.png>';
  const rewritten = await preview(source, 'C:/notes/page', 'index.html');
  expect(rewritten).toBe(source
    .replace('src=图.png', `src="${image}"`)
    .replace('src=/root.png', `src="${image}"`));
  expect(convertFileSrc).toHaveBeenCalledWith(String.raw`C:\notes\资料\图.png`);
  expect(convertFileSrc).toHaveBeenCalledWith(String.raw`C:\root.png`);

  const remote = '<base href="https://example.test/"><img src="relative.png">';
  expect(await preview(remote, 'C:/notes/page', 'index.html')).toBe(remote);
});

it('does not read absolute sources, network paths, encoded separators, or unsupported files', async () => {
  const source = String.raw`
    <img src="//server/share/image.png"><img src="\\server\share\image.png">
    <img src="%5c%5cserver%5cshare%5cimage.png"><img src="file://server/share/image.png">
    <img src="/X:/elsewhere.png"><img src="https://example.test/img.png"><img src="data:image/png;base64,AAA">
    <img src="../private.txt"><img src="font.woff2"><p style="background:url(./page.html)"></p>`;
  expect(await preview(source, 'C:/notes', 'test.html')).toBe(source);
  expect(await preview('<img src="./relative.png">', String.raw`\\server\share\notes`, 'test.html')).toBe('<img src="./relative.png">');
  expect(convertFileSrc).not.toHaveBeenCalled();
});

it('keeps failed image references while rendering the remaining assets', async () => {
  fetchAsset.mockResolvedValueOnce(fixtureResponse('text/html')).mockRejectedValueOnce(new TypeError('failed to fetch'));
  const source = '<img src="non-image.png"><img src="missing.png"><img src="good.png">';
  expect(await preview(source, 'C:/notes', 'test.html')).toBe(source.replace('good.png', image));
});

it('bounds concurrent reads and stops starting resources when preview is cancelled', async () => {
  const controller = new AbortController();
  fetchAsset.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
    options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true });
  }));
  const source = Array.from({ length: 8 }, (_, index) => `<img src="${index}.png">`).join('');
  const plan = planHtmlPreview(source, 'C:/notes', 'test.html').assets!;
  const result = loadHtmlPreviewAssets(plan, controller.signal);
  expect(fetchAsset).toHaveBeenCalledTimes(4);
  controller.abort();
  await expect(result).rejects.toHaveProperty('name', 'AbortError');
  expect(fetchAsset).toHaveBeenCalledTimes(4);
});
