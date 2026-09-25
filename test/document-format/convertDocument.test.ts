import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { save } from '@tauri-apps/plugin-dialog';
import * as ipc from '../../src/core/ipc/commands';
import type { DocumentPayload } from '../../src/core/ipc/types';
import { decodeNativeDocument, encodeNativeDocument, readNativeMetadata, type NativeMetadata } from '../../src/core/nativeDocument';
import { documentTextHash, saveNativeBundle } from '../../src/core/nativeDocumentIO';
import { rebaseDocumentReferences } from '../../src/core/documentReferences';
import { registerEditorCapabilities, resetEditorRegistryForTest, bumpDocumentRevision } from '../../src/core/editor/editorRegistry';
import { registerPendingSnapshotMaterializers } from '../../src/core/editor/pendingSnapshots';
import { useDocumentStore } from '../../src/stores/documentStore';
import { useWindowStore } from '../../src/stores/windowStore';
import { getBaseline } from '../../src/features/editor-md/serialize';
import { prepareTextExport } from '../../src/features/export/documentConversion';
import { convertMarkdownToNative } from '../../src/features/document-format/convertDocument';
import { saveAs, saveDocument } from '../../src/features/editor-code/orchestration/saveDocument';

vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn() }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ label: 'test-main' }) }));
vi.mock('../../src/core/nativeDocumentIO', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/core/nativeDocumentIO')>(), saveNativeBundle: vi.fn(),
}));
vi.mock('../../src/core/ipc/commands', () => ({
  readDocument: vi.fn(), pathExists: vi.fn(), writeDocument: vi.fn(),
  registerDocument: vi.fn(), unregisterDocument: vi.fn(), setDocumentDirty: vi.fn(),
}));
vi.mock('../../src/features/export/documentConversion', () => ({ prepareTextExport: vi.fn() }));
vi.mock('../../src/features/document-format/linkedMarkdownUpdates', () => ({ getAcceptedLinkedMarkdownHash: vi.fn(), checkLinkedMarkdownUpdates: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../src/features/editor-md/imageAssetLifecycle', () => ({ restoreImageAssetsForContent: vi.fn().mockResolvedValue(undefined), prepareImageAssetsForIdentity: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../src/features/explorer/directoryWatcher', () => ({ noteSelfWrite: vi.fn() }));
vi.mock('../../src/features/staging/stagingManager', () => ({ onDocumentSaved: vi.fn().mockResolvedValue(undefined), drainStagingWrites: vi.fn().mockResolvedValue(undefined), migrateStagedDocumentKey: vi.fn() }));

const MD = 'C:\\notes\\memo.md', NB = 'C:\\notes\\memo.nb';
const native = (text: string, metadata: NativeMetadata = {}, image = false) => encodeNativeDocument({ type: 'doc', content: [
  { type: 'paragraph', content: [{ type: 'text', text }] }, ...(image ? [{ type: 'image', attrs: { src: 'picture.png', alt: 'Picture' } }] : []),
] }, metadata);
function payload(key: string, content: string, kind: DocumentPayload['kind'] = 'markdown'): DocumentPayload {
  return { key, displayName: key.split('\\').pop()!, dirPath: key.startsWith('untitled:') ? '' : 'C:\\notes', kind, language: kind === 'markdown' ? 'markdown' : 'plaintext', content, encoding: 'utf8', eol: 'lf', readonly: false, mtime: 1, size: content.length };
}
function seed(key: string, content: string, kind: DocumentPayload['kind'] = 'markdown') {
  useDocumentStore.getState().upsertFromPayload(payload(key, content, kind));
  getBaseline(key).updateBaseline(content);
  useWindowStore.getState().openTab({ key, path: key, displayName: key.split('\\').pop()!, kind, language: kind === 'markdown' ? 'markdown' : 'plaintext', isDirty: false, isPreview: false, viewMode: 'source', externalStatus: null, isDetached: false });
}
const disposals: (() => void)[] = [];
function authority(key: string, initial: string) {
  let text = initial, revision = 0;
  disposals.push(registerEditorCapabilities({ docKey: key, instanceId: `test:${key}`, getRevision: () => revision,
    flush: async () => ({ docKey: key, instanceId: `test:${key}`, revision, content: text }), focus() {}, getSelectedText: () => '', canSuspend: () => false }));
  return { edit(value: string) { text = value; revision = bumpDocumentRevision(key); } };
}

beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal('crypto', webcrypto);
  useDocumentStore.setState({ documents: new Map() });
  useWindowStore.setState({ tabs: [], activeKey: null, transferringKeys: [], isWindowClosing: false });
  resetEditorRegistryForTest();
  vi.mocked(ipc.registerDocument).mockResolvedValue({ type: 'ok' });
  vi.mocked(ipc.unregisterDocument).mockResolvedValue(undefined);
  vi.mocked(ipc.setDocumentDirty).mockResolvedValue(undefined);
  vi.mocked(ipc.pathExists).mockResolvedValue({ exists: false, isDir: false });
  vi.mocked(saveNativeBundle).mockResolvedValue({ ok: true, native: { mtime: 2, size: 100 }, markdown: { mtime: 2, size: 20 } });
  vi.mocked(prepareTextExport).mockImplementation(async (content, format, directory, _signal, inputFormat) => {
    const json = typeof content === 'string' ? inputFormat === 'noteboard' ? decodeNativeDocument(content)
      : { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: content }] }] } : structuredClone(content);
    rebaseDocumentReferences(json, directory);
    if (format === 'md') return (json.content?.[0].content?.[0].text ?? '') + '\n';
    return encodeNativeDocument(json, inputFormat === 'noteboard' && typeof content === 'string' ? readNativeMetadata(content) : {});
  });
});
afterEach(() => { for (const dispose of disposals.splice(0)) dispose(); registerPendingSnapshotMaterializers({ source: () => null, visual: () => null }); vi.unstubAllGlobals(); });

describe('conversion and native Save As', () => {
  it('cancels an untitled conversion without registering, writing or changing identity', async () => {
    const key = 'untitled:markdown:cancel'; seed(key, 'Unsaved draft');
    vi.mocked(save).mockResolvedValue(null);
    expect(await convertMarkdownToNative(key, { removeMarkdown: false })).toBeNull();
    expect(ipc.registerDocument).not.toHaveBeenCalled(); expect(saveNativeBundle).not.toHaveBeenCalled();
    expect(useDocumentStore.getState().getDocument(key)?.content).toBe('Unsaved draft');
  });

  it('uses the editor authority and create-only write; existing-target failure preserves the source identity and baseline', async () => {
    seed(MD, 'Disk baseline'); const editor = authority(MD, 'Disk baseline'); editor.edit('Authoritative unsaved text');
    vi.mocked(ipc.readDocument).mockResolvedValue(payload(MD, 'Disk baseline'));
    vi.mocked(saveNativeBundle).mockResolvedValue({ ok: false, error: { code: 'already-exists', message: 'Target already exists' } });
    await expect(convertMarkdownToNative(MD, { removeMarkdown: false })).rejects.toThrow('Target already exists');
    const request = vi.mocked(saveNativeBundle).mock.calls[0][0];
    expect(request).toMatchObject({ path: NB, createOnly: true, markdown: { path: MD, content: 'Authoritative unsaved text\n' } });
    expect(decodeNativeDocument(request.content).content?.[0].content?.[0].text).toBe('Authoritative unsaved text');
    expect(useDocumentStore.getState().getDocument(MD)).toMatchObject({ content: 'Authoritative unsaved text', baselineContent: 'Disk baseline', isDirty: true });
    expect(useDocumentStore.getState().hasDocument(NB)).toBe(false);
    expect(ipc.unregisterDocument).toHaveBeenCalledWith('test-main', NB);
    expect(ipc.unregisterDocument).not.toHaveBeenCalledWith('test-main', MD);
  });

  it('only removes the source Markdown when explicitly selected, in the same protected bundle', async () => {
    seed(MD, 'Disk baseline'); authority(MD, 'Disk baseline');
    vi.mocked(ipc.readDocument).mockResolvedValue(payload(MD, 'Disk baseline'));
    expect(await convertMarkdownToNative(MD, { removeMarkdown: true })).toBe(NB);
    const request = vi.mocked(saveNativeBundle).mock.calls[0][0];
    expect(request).toMatchObject({ createOnly: true, removeMarkdown: { path: MD, expectedHash: await documentTextHash('Disk baseline') } });
    expect(request.markdown).toBeUndefined(); expect(readNativeMetadata(request.content).markdown).toBeUndefined();
    expect(useDocumentStore.getState().hasDocument(MD)).toBe(false);
    expect(useDocumentStore.getState().getDocument(NB)?.kind).toBe('noteboard');
  });

  it('converts the last pending Markdown input without treating it as already saved', async () => {
    seed(MD, 'Written revision'); authority(MD, 'Written revision');
    vi.mocked(ipc.readDocument).mockResolvedValue(payload(MD, 'Written revision'));
    let pending: string | null = null;
    registerPendingSnapshotMaterializers({ source: key => {
      if (key !== MD || pending == null) return null;
      const captured = pending; pending = null;
      useDocumentStore.getState().setContent(key, captured);
      return captured;
    }, visual: () => null });
    vi.mocked(ipc.unregisterDocument).mockImplementation(async (_label, key) => {
      if (key === MD) pending = 'Late Markdown input\n\n$z^2$';
    });
    expect(await convertMarkdownToNative(MD, { removeMarkdown: false })).toBe(NB);
    const written = vi.mocked(saveNativeBundle).mock.calls[0][0];
    const current = useDocumentStore.getState().getDocument(NB)!;
    expect(current.baselineContent).toBe(written.content);
    expect(written.markdown?.content).toBe('Written revision\n');
    expect(JSON.stringify(decodeNativeDocument(current.content!))).toContain('Late Markdown input');
    expect(JSON.stringify(decodeNativeDocument(current.content!))).toContain('z^2');
    expect(current.isDirty).toBe(true);
    expect(useWindowStore.getState().getTab(NB)?.isDirty).toBe(true);
  });

  it('saves a new untitled NB through Save As using the latest authoritative source and no guessed Markdown link', async () => {
    const key = 'untitled:noteboard:new', target = 'C:\\notes\\created.nb';
    seed(key, native('Initial'), 'noteboard'); const editor = authority(key, native('Initial')); editor.edit(native('Latest native source'));
    vi.mocked(save).mockResolvedValue(target);
    expect(await saveDocument(key)).toBe(true);
    const request = vi.mocked(saveNativeBundle).mock.calls[0][0];
    expect(request).toMatchObject({ path: target, createOnly: true });
    expect(request.expectedHash).toBeUndefined(); expect(request.markdown).toBeUndefined();
    expect(decodeNativeDocument(request.content).content?.[0].content?.[0].text).toBe('Latest native source');
    expect(useDocumentStore.getState().hasDocument(key)).toBe(false);
    expect(useDocumentStore.getState().getDocument(target)).toMatchObject({ kind: 'noteboard', content: request.content, baselineContent: request.content, isDirty: false });
    expect(ipc.writeDocument).not.toHaveBeenCalled();
  });

  it('rebases a linked NB Save As while retaining the Markdown target and updating its open clean tab', async () => {
    const markdown = 'Disk baseline\n', target = 'C:\\archive\\memo.nb';
    const metadata = { markdown: { path: 'memo.md', baselineHash: await documentTextHash(markdown), projectionVersion: 1 } };
    const baseline = native('Disk baseline', metadata, true);
    seed(NB, baseline, 'noteboard'); seed(MD, markdown); const editor = authority(NB, baseline);
    vi.mocked(ipc.readDocument).mockResolvedValue(payload(MD, markdown));
    vi.mocked(save).mockImplementation(async () => { editor.edit(native('Edited while choosing location', metadata, true)); return target; });
    expect(await saveAs(NB, baseline)).toBe(true);
    const request = vi.mocked(saveNativeBundle).mock.calls[0][0];
    expect(request.markdown).toMatchObject({ path: MD, content: 'Edited while choosing location\n' });
    expect(readNativeMetadata(request.content).markdown?.path).toBe('../notes/memo.md');
    expect(decodeNativeDocument(request.content).content?.[1].attrs?.src).toBe('C:/notes/picture.png');
    expect(useDocumentStore.getState().getDocument(MD)).toMatchObject({ content: request.markdown!.content, baselineContent: request.markdown!.content, isDirty: false });
    expect(useDocumentStore.getState().getDocument(target)).toMatchObject({ content: request.content, baselineContent: request.content, isDirty: false });
  });

  it('preserves source pending and unrelated metadata arriving at the final Save As await', async () => {
    const target = 'C:\\archive\\pending.nb';
    const baseline = native('Captured for disk', { custom: { label: 'before save' } }, true);
    seed(NB, baseline, 'noteboard'); authority(NB, baseline);
    vi.mocked(save).mockResolvedValue(target);
    let pending: string | null = null;
    registerPendingSnapshotMaterializers({ source: key => {
      if (key !== NB || pending == null) return null;
      const captured = pending; pending = null;
      useDocumentStore.getState().setContent(key, captured);
      return captured;
    }, visual: () => null });
    vi.mocked(ipc.unregisterDocument).mockImplementation(async (_label, key) => {
      if (key === NB) pending = native('Input at the last await', { custom: { label: 'edited during save' } }, true);
    });
    expect(await saveAs(NB, baseline)).toBe(true);
    const written = vi.mocked(saveNativeBundle).mock.calls[0][0].content;
    const current = useDocumentStore.getState().getDocument(target)!;
    expect(current.baselineContent).toBe(written);
    expect(decodeNativeDocument(current.content!).content?.[0].content?.[0].text).toBe('Input at the last await');
    expect(decodeNativeDocument(current.content!).content?.[1].attrs?.src).toBe('C:/notes/picture.png');
    expect(readNativeMetadata(current.content!).custom).toEqual({ label: 'edited during save' });
    expect(current.isDirty).toBe(true);
    expect(prepareTextExport).toHaveBeenCalledOnce();
  });
});
