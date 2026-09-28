import { afterEach, expect, it, vi } from 'vitest';
import { readFile } from '@tauri-apps/plugin-fs';
import { portableHtmlAssetUrls } from '../../src/features/export/portableHtmlAssets';

vi.mock('@tauri-apps/plugin-fs', () => ({ readFile: vi.fn() }));
afterEach(() => vi.mocked(readFile).mockReset());

it('preserves original bytes across base64 chunk boundaries and reads duplicates only once', async () => {
  const bytes = Uint8Array.from({ length: 80_003 }, (_, index) => index % 256);
  vi.mocked(readFile).mockResolvedValue(bytes);
  const urls = await portableHtmlAssetUrls(['C:/图片.png', 'C:/图片.png']);
  expect(urls[0]).toBe(urls[1]);
  expect(urls[0]).toBe(`data:image/png;base64,${Buffer.from(bytes).toString('base64')}`);
  expect(readFile).toHaveBeenCalledOnce();
});

it('detects MIME from original file signatures and preserves SVG bytes', async () => {
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><text>中文</text></svg>');
  vi.mocked(readFile).mockResolvedValueOnce(new Uint8Array([255, 216, 255, 224])).mockResolvedValueOnce(svg);
  const urls = await portableHtmlAssetUrls(['C:/wrong.png', 'C:/vector.svg']);
  expect(urls[0]).toBe('data:image/jpeg;base64,/9j/4A==');
  expect(urls[1]).toBe(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
});

it('finishes each read before starting the next and honors cancellation between them', async () => {
  let finish!: (bytes: Uint8Array) => void;
  vi.mocked(readFile).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const controller = new AbortController();
  const result = portableHtmlAssetUrls(['C:/a.png', 'C:/b.png'], controller.signal);
  await vi.waitFor(() => expect(readFile).toHaveBeenCalledOnce());
  controller.abort();
  finish(new Uint8Array([1, 2, 3]));
  await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  expect(readFile).toHaveBeenCalledOnce();
});

it('rejects an unreadable or empty original with its path instead of leaving a local URL', async () => {
  vi.mocked(readFile).mockRejectedValueOnce('permission denied').mockResolvedValueOnce(new Uint8Array());
  await expect(portableHtmlAssetUrls(['C:/a.png'])).rejects.toThrow('C:/a.png”：permission denied');
  await expect(portableHtmlAssetUrls(['C:/empty.png'])).rejects.toThrow('C:/empty.png”：图片文件为空');
});
