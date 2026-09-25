import { createHash, webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const io = vi.hoisted(() => ({ files: new Map<string, Uint8Array>(), writes: vi.fn(), read: vi.fn() }));
vi.mock('@/core/ipc/commands', () => ({
  ensureStagingDirectory: async () => 'C:\\recovery',
  storeImageAsset: (directory: string, extension: string, bytes: Uint8Array) => io.writes(directory, extension, bytes),
  publishRecoveryImage: async (source: string, directory: string) => {
    const bytes = await io.read(source);
    return io.writes(directory, source.split('.').pop(), bytes);
  },
}));
vi.mock('@tauri-apps/plugin-fs', () => ({ readFile: (path: string) => io.read(path) }));
vi.mock('@/stores/settingsStore', () => ({ useSettingsStore: { getState: () => ({ settings: { file: { imageDirName: 'img' } } }) } }));
import { publishImageAsset, storeTransientImage } from '@/features/editor-md/imageAssetStorage';
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto); io.files.clear(); io.writes.mockReset(); io.read.mockReset();
  io.writes.mockImplementation(async (directory, extension, bytes) => { const filename = `${createHash('sha256').update(bytes).digest('hex')}.${extension}`; io.files.set(`${directory}\\${filename}`, bytes); return filename; });
  io.read.mockImplementation(async path => { const bytes = io.files.get(path.replace(/\//g, '\\')); if (!bytes) throw new Error('Missing image'); return bytes; });
});
afterEach(() => vi.unstubAllGlobals());
it('stores untitled bytes once and publishes the same asset once at first save', async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const source = await storeTransientImage(bytes, 'photo.png');
  expect(source).toMatch(/^C:\/recovery\/\.noteboard-assets\/[a-f0-9]{64}\.png$/);
  expect(await storeTransientImage(bytes, 'other-name.png')).toBe(source);
  expect(io.files.size).toBe(1);
  const reference = await publishImageAsset(source, undefined, 'png', 'C:\\notes\\note.nb');
  expect(reference).toMatch(/^\.\/img\/[a-f0-9]{64}\.png$/);
  expect(await publishImageAsset(source, undefined, 'png', 'C:\\notes\\note.nb')).toBe(reference);
  expect(io.files.size).toBe(2);
  expect(io.files.get(`C:\\notes\\${reference.slice(2).replace(/\//g, '\\')}`)).toEqual(bytes);
  expect(io.files.has(source.replace(/\//g, '\\'))).toBe(true);
});
it('propagates write/read failures without returning a data URI or deleting recovery files', async () => {
  io.writes.mockRejectedValue(new Error('disk full'));
  await expect(storeTransientImage(new Uint8Array([9]), 'photo.png')).rejects.toThrow('disk full');
  await expect(publishImageAsset(`C:/recovery/.noteboard-assets/${'a'.repeat(64)}.png`, undefined, 'png', 'C:\\notes\\note.nb')).rejects.toThrow('Missing image');
});
