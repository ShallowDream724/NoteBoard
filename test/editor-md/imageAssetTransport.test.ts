import { expect, it, vi } from 'vitest';
const call = vi.hoisted(() => vi.fn().mockResolvedValue('asset.png'));
vi.mock('@tauri-apps/api/core', () => ({ invoke: call }));
import { storeImageAsset } from '@/core/ipc/commands';
it('sends image bytes as a raw body and URI-encodes Unicode directory metadata', async () => {
  const bytes = new Uint8Array(1024 * 1024), directory = 'C:\\我的笔记\\图 & 片';
  await storeImageAsset(directory, 'png', bytes);
  expect(call.mock.calls[0][0]).toBe('store_image_asset');
  expect(call.mock.calls[0][1]).toBe(bytes);
  const header = call.mock.calls[0][2].headers['x-noteboard-image'];
  expect(new URLSearchParams(header).get('directory')).toBe(directory);
  expect(new URLSearchParams(header).get('extension')).toBe('png');
});
