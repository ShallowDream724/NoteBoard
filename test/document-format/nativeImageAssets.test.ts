import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { encodeNativeDocument } from '@/core/nativeDocument';
import { useDocumentStore } from '@/stores/documentStore';
const io = vi.hoisted(() => ({ prepare: vi.fn(), save: vi.fn(), project: vi.fn() }));
vi.mock('@/core/ipc/commands', () => ({ pathExists: async () => ({ exists: false }) }));
vi.mock('@/core/nativeDocumentIO', async original => ({ ...await original<typeof import('@/core/nativeDocumentIO')>(), saveNativeBundle: io.save }));
vi.mock('@/features/editor-md/prepareImageAssets', () => ({ prepareDocumentImageAssets: io.prepare }));
vi.mock('@/features/export/documentConversion', () => ({ prepareTextExport: io.project }));
import { persistNativeDocument } from '@/features/document-format/nativePersistence';
import { saveNativeAs } from '@/features/document-format/nativeSaveAs';
const native = (src: string) => encodeNativeDocument({ type: 'doc', content: [{ type: 'image', attrs: { src } }] });
const source = native('data:image/png;base64,AAEC'), path = 'C:\\notes\\a.nb';
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto); vi.clearAllMocks(); useDocumentStore.setState({ documents: new Map() });
  io.save.mockResolvedValue({ ok: true, native: { mtime: 2, size: 100 } });
});
afterEach(() => vi.unstubAllGlobals());
it('materializes the captured NB before saving and retains the original CAS baseline', async () => {
  io.prepare.mockResolvedValue({ content: native('./img/a.png'), changes: [], references: [['data:image/png;base64,AAEC', './img/a.png']] });
  const saved = await persistNativeDocument({ key: path, baselineContent: source, persistedContent: source }, source, 'explicit-expected-hash');
  expect(io.prepare).toHaveBeenCalledWith(source, 'noteboard', path, false);
  expect(io.save.mock.calls[0][0]).toMatchObject({ content: native('./img/a.png'), expectedHash: 'explicit-expected-hash' });
  expect(saved.imageAssets?.captured).toBe(source);
});
it('first Save As writes images at the target and makes only newly published images relative', async () => {
  const target = 'D:\\writing\\note.nb', absolute = 'D:/writing/img/a.png';
  io.prepare.mockResolvedValue({ content: native(absolute), changes: [], references: [['data:image/png;base64,AAEC', absolute]] });
  io.project.mockResolvedValue(native('./img/a.png'));
  useDocumentStore.getState().upsertFromPayload({ key: 'untitled:test', displayName: 'note.nb', dirPath: '', kind: 'noteboard', language: 'plaintext', content: source, encoding: 'utf8', eol: 'lf', readonly: false, mtime: 0, size: source.length });
  await saveNativeAs(useDocumentStore.getState().getDocument('untitled:test')!, target, source);
  expect(io.prepare).toHaveBeenCalledWith(source, 'noteboard', target, true);
  expect(io.project).toHaveBeenCalledWith(native(absolute), 'noteboard', '', undefined, 'noteboard', [[absolute, './img/a.png']]);
  expect(io.save.mock.calls[0][0]).toMatchObject({ path: target, createOnly: true });
  expect(io.save.mock.calls[0][0].content).toContain('"src":"./img/a.png"');
  expect(io.save.mock.calls[0][0].content).not.toContain('data:image/');
});
it('does not write the NB if preparing a recovery resource fails', async () => {
  io.prepare.mockRejectedValue(new Error('Missing recovery image'));
  await expect(persistNativeDocument({ key: path, baselineContent: null, persistedContent: null }, source)).rejects.toThrow('Missing recovery image');
  expect(io.save).not.toHaveBeenCalled();
});
