import { afterEach, expect, it, vi } from 'vitest';
import { convertFileSrc } from '@tauri-apps/api/core';
import { portableHtmlAssetUrls } from '../../src/features/export/portableHtmlAssets';

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: vi.fn((path: string) => `http://asset.localhost/${encodeURIComponent(path)}`),
}));

const fetchAsset = vi.fn<typeof fetch>();
vi.stubGlobal('fetch', fetchAsset);
afterEach(() => {
  fetchAsset.mockReset();
  vi.mocked(convertFileSrc).mockClear();
});

function assetResponse(bytes: Uint8Array, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    arrayBuffer: vi.fn(async () => Uint8Array.from(bytes).buffer),
  } as unknown as Response;
}

it('preserves original bytes across base64 chunks, including a staged Unicode path, and reads duplicates once', async () => {
  const bytes = Uint8Array.from({ length: 80_003 }, (_, index) => index % 256);
  fetchAsset.mockResolvedValue(assetResponse(bytes));
  const path = 'C:/Users/测试/AppData/Roaming/NoteBoard/staging/含 空格/.noteboard-assets/图片.png';
  const urls = await portableHtmlAssetUrls([path, path]);
  expect(urls[0]).toBe(urls[1]);
  expect(urls[0]).toBe(`data:image/png;base64,${Buffer.from(bytes).toString('base64')}`);
  expect(convertFileSrc).toHaveBeenCalledExactlyOnceWith(path);
  expect(fetchAsset).toHaveBeenCalledExactlyOnceWith(
    `http://asset.localhost/${encodeURIComponent(path)}`,
    { signal: undefined, credentials: 'omit', referrerPolicy: 'no-referrer' },
  );
});

it('detects MIME from original signatures and preserves saved SVG bytes', async () => {
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><text>中文</text></svg>');
  fetchAsset.mockResolvedValueOnce(assetResponse(new Uint8Array([255, 216, 255, 224])))
    .mockResolvedValueOnce(assetResponse(svg));
  const urls = await portableHtmlAssetUrls(['D:/Notes/saved photo.png', 'D:/Notes/保存 文档/.noteboard-assets/矢量.svg']);
  expect(urls[0]).toBe('data:image/jpeg;base64,/9j/4A==');
  expect(urls[1]).toBe(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
  expect(fetchAsset).toHaveBeenCalledTimes(2);
});

it('finishes each response body before starting the next and honors cancellation during body reading', async () => {
  let startBody!: () => void;
  let finishBody!: (buffer: ArrayBuffer) => void;
  const bodyStarted = new Promise<void>(resolve => { startBody = resolve; });
  const response = assetResponse(new Uint8Array());
  response.arrayBuffer = vi.fn(() => {
    startBody();
    return new Promise<ArrayBuffer>(resolve => { finishBody = resolve; });
  });
  fetchAsset.mockResolvedValue(response);
  const controller = new AbortController();
  const result = portableHtmlAssetUrls(['C:/a.png', 'C:/b.png'], controller.signal);
  await bodyStarted;
  expect(fetchAsset).toHaveBeenCalledOnce();
  expect(fetchAsset.mock.calls[0][1]?.signal).toBe(controller.signal);
  controller.abort();
  finishBody(new Uint8Array([1, 2, 3]).buffer);
  await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  expect(fetchAsset).toHaveBeenCalledOnce();
});

it('rejects HTTP failures before reading the body, and rejects empty assets with their path', async () => {
  const failed = assetResponse(new Uint8Array(), 403);
  fetchAsset.mockResolvedValueOnce(failed).mockResolvedValueOnce(assetResponse(new Uint8Array()));
  await expect(portableHtmlAssetUrls(['C:/restricted.png'])).rejects.toThrow('C:/restricted.png”：资源请求失败（HTTP 403）');
  expect(failed.arrayBuffer).not.toHaveBeenCalled();
  await expect(portableHtmlAssetUrls(['C:/empty.png'])).rejects.toThrow('C:/empty.png”：图片文件为空');
});

it('surfaces asset transport failures with the source path', async () => {
  fetchAsset.mockRejectedValueOnce(new TypeError('Failed to fetch'));
  await expect(portableHtmlAssetUrls(['C:/missing.png'])).rejects.toThrow('C:/missing.png”：Failed to fetch');
});
