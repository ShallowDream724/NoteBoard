import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentPayload } from '../../src/core/ipc/types';
import * as ipc from '../../src/core/ipc/commands';
import { decodeNativeDocument, encodeNativeDocument, readNativeMetadata, type NativeMetadata } from '../../src/core/nativeDocument';
import { documentTextHash, saveNativeBundle, type NativeSaveResult } from '../../src/core/nativeDocumentIO';
import { useDocumentStore } from '../../src/stores/documentStore';
import { useWindowStore } from '../../src/stores/windowStore';
import { getBaseline } from '../../src/features/editor-md/serialize';
import { prepareTextExport } from '../../src/features/export/documentConversion';
import { persistNativeDocument, prepareNativeSave } from '../../src/features/document-format/nativePersistence';
import { commitNativeSaveMetadata } from '../../src/features/document-format/nativeSaveCommit';
import { writeDocumentWithBarrier } from '../../src/features/session/documentSession';
import { Text } from '@codemirror/state';
import { stagePendingSourceSnapshot } from '../../src/features/editor-md/visualSnapshot';

vi.mock('../../src/core/nativeDocumentIO', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/core/nativeDocumentIO')>(), saveNativeBundle: vi.fn(),
}));
vi.mock('../../src/core/ipc/commands', () => ({ readDocument: vi.fn(), writeDocument: vi.fn(), setDocumentDirty: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../src/features/export/documentConversion', () => ({ prepareTextExport: vi.fn() }));
vi.mock('../../src/features/document-format/linkedMarkdownUpdates', () => ({ getAcceptedLinkedMarkdownHash: vi.fn(), checkLinkedMarkdownUpdates: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../src/features/editor-md/imageAssetLifecycle', () => ({ restoreImageAssetsForContent: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../src/features/staging/stagingManager', () => ({ onDocumentSaved: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../src/features/explorer/directoryWatcher', () => ({ noteSelfWrite: vi.fn() }));
vi.mock('../../src/features/editor-code/orchestration/saveDocument', () => ({ showWriteError: vi.fn() }));
vi.mock('../../src/features/editor-md/editorInstances', () => ({ getMdTipTapEditor: () => null, getMdSourceView: () => null }));
vi.mock('../../src/features/editor-md/editorDocumentCodec', () => ({ setEditorNativeMetadata: vi.fn() }));
vi.mock('../../src/features/editor-md/sourceDocumentSync', () => ({ setSourceNativeMetadata: vi.fn() }));

const NB = 'C:\\notes\\memo.nb', MD = 'C:\\notes\\memo.md';
const native = (text: string, metadata: NativeMetadata) => encodeNativeDocument({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }, metadata);
function payload(key: string, content: string, kind: DocumentPayload['kind'] = 'noteboard'): DocumentPayload {
  return { key, displayName: key.split('\\').pop()!, dirPath: 'C:\\notes', kind, language: kind === 'markdown' ? 'markdown' : 'plaintext', content, encoding: 'utf8', eol: 'lf', readonly: false, mtime: 1, size: content.length };
}
async function seed() {
  const markdown = 'Original body\n';
  const metadata = { markdown: { path: 'memo.md', baselineHash: await documentTextHash(markdown), projectionVersion: 1 }, custom: { value: 'original' } };
  const baseline = native('Original body', metadata);
  useDocumentStore.getState().upsertFromPayload(payload(NB, baseline));
  useDocumentStore.getState().upsertFromPayload(payload(MD, markdown, 'markdown'));
  getBaseline(NB).updateBaseline(baseline); getBaseline(MD).updateBaseline(markdown);
  vi.mocked(ipc.readDocument).mockResolvedValue(payload(MD, markdown, 'markdown'));
  vi.mocked(prepareTextExport).mockResolvedValue('Saved body\n');
  return { baseline, markdown, metadata, source: native('Saved body', metadata), doc: useDocumentStore.getState().getDocument(NB)! };
}

beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal('crypto', webcrypto);
  useDocumentStore.setState({ documents: new Map() });
  useWindowStore.setState({ tabs: [], activeKey: null });
});
afterEach(() => vi.unstubAllGlobals());

describe('native linked-save boundary', () => {
  it('does not manufacture metadata or dirty state when an unlinked NB save has no receipt to apply', () => {
    const content = native('Unlinked source', {});
    useDocumentStore.getState().upsertFromPayload(payload(NB, content));
    commitNativeSaveMetadata(NB, { request: { path: NB, content }, content, metadata: {}, result: { ok: true, native: { mtime: 2, size: content.length } } });
    expect(useDocumentStore.getState().getDocument(NB)).toMatchObject({ content, baselineContent: content, isDirty: false });
    expect(useDocumentStore.getState().getDocument(NB)?.content).not.toContain('@meta');
  });

  it('captures a single source revision and carries both expected hashes without advancing either baseline', async () => {
    const { doc, source, baseline, markdown } = await seed();
    const prepared = await prepareNativeSave(doc, source);
    expect(prepareTextExport).toHaveBeenCalledWith(source, 'md', '', undefined, 'noteboard');
    expect(prepared.request).toMatchObject({ path: NB, expectedHash: await documentTextHash(baseline), createOnly: false,
      markdown: { path: MD, content: 'Saved body\n', expectedHash: await documentTextHash(markdown), encoding: 'utf8', eol: 'lf' } });
    expect(readNativeMetadata(prepared.content).markdown?.baselineHash).toBe(await documentTextHash('Saved body\n'));
    expect(decodeNativeDocument(prepared.content).content?.[0].content?.[0].text).toBe('Saved body');
    expect(useDocumentStore.getState().getDocument(NB)?.baselineContent).toBe(baseline);
    expect(useDocumentStore.getState().getDocument(MD)?.baselineContent).toBe(markdown);
    expect(saveNativeBundle).not.toHaveBeenCalled();
  });

  it.each(['dirty linked editor', 'external hash conflict'])('refuses %s before projecting or writing', async kind => {
    const { doc, source } = await seed();
    if (kind === 'dirty linked editor') useDocumentStore.getState().setContent(MD, 'Unsaved linked edit');
    else vi.mocked(ipc.readDocument).mockResolvedValue(payload(MD, 'External update', 'markdown'));
    await expect(persistNativeDocument(doc, source)).rejects.toThrow(kind === 'dirty linked editor' ? '未保存' : '外部修改');
    expect(prepareTextExport).not.toHaveBeenCalled(); expect(saveNativeBundle).not.toHaveBeenCalled();
  });

  it.each(['readonly', 'conflict', 'commit-failed'])('does not advance either baseline after the bundle reports %s', async code => {
    const { baseline, markdown, source } = await seed();
    useDocumentStore.getState().setContent(NB, source);
    vi.mocked(saveNativeBundle).mockResolvedValue({ ok: false, error: { code, message: 'Pair was not committed' } });
    expect(await writeDocumentWithBarrier(NB, source)).toBe(false);
    expect(useDocumentStore.getState().getDocument(NB)).toMatchObject({ content: source, baselineContent: baseline, isDirty: true });
    expect(useDocumentStore.getState().getDocument(MD)).toMatchObject({ content: markdown, baselineContent: markdown, isDirty: false });
    expect(getBaseline(NB).getBaseline()).toBe(baseline);
    expect(getBaseline(MD).getBaseline()).toBe(markdown);
    expect(ipc.writeDocument).not.toHaveBeenCalled();
  });

  it('commits only the link receipt when native and linked text both change during I/O', async () => {
    const { doc, source, metadata, baseline } = await seed();
    let complete!: (result: NativeSaveResult) => void;
    vi.mocked(saveNativeBundle).mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    const saving = persistNativeDocument(doc, source);
    await vi.waitFor(() => expect(saveNativeBundle).toHaveBeenCalledOnce());
    const newer = native('Input received during save', { ...metadata, custom: { value: 'new metadata' } });
    useDocumentStore.getState().setContent(NB, newer);
    useDocumentStore.getState().setContent(MD, 'Linked input received during save');
    complete({ ok: true, native: { mtime: 2, size: 50 }, markdown: { mtime: 2, size: 11 } });
    const prepared = await saving;
    commitNativeSaveMetadata(NB, prepared);
    const current = useDocumentStore.getState().getDocument(NB)!;
    expect(decodeNativeDocument(current.content!).content?.[0].content?.[0].text).toBe('Input received during save');
    expect(readNativeMetadata(current.content!)).toMatchObject({ custom: { value: 'new metadata' }, markdown: { baselineHash: await documentTextHash('Saved body\n') } });
    expect(current.baselineContent).toBe(baseline); // outer save barrier owns this baseline
    expect(useDocumentStore.getState().getDocument(MD)).toMatchObject({ content: 'Linked input received during save', baselineContent: 'Saved body\n', isDirty: true });
  });
  it('materializes source input arriving after an async save gap before applying a metadata-only receipt', async () => {
    const { doc, source, metadata } = await seed();
    useWindowStore.getState().openTab({ key: NB, displayName: 'memo.nb', path: NB, kind: 'noteboard', language: 'plaintext', isDirty: true, isPreview: false, viewMode: 'source', externalStatus: null, isDetached: false });
    useDocumentStore.getState().setContent(NB, source);
    vi.mocked(saveNativeBundle).mockResolvedValue({ ok: true, native: { mtime: 2, size: source.length }, markdown: { mtime: 2, size: 11 } });
    const prepared = await persistNativeDocument(doc, source);
    await Promise.resolve();
    const newer = native('Typed after flush', { ...metadata, custom: { value: 'later header' } });
    stagePendingSourceSnapshot(NB, { text: Text.of(newer.split('\n')), revision: 5, isNewGroup: true });
    expect(useDocumentStore.getState().getDocument(NB)?.content).toBe(source);
    commitNativeSaveMetadata(NB, prepared);
    const current = useDocumentStore.getState().getDocument(NB)!.content!;
    expect(decodeNativeDocument(current).content?.[0].content?.[0].text).toBe('Typed after flush');
    expect(readNativeMetadata(current).custom).toEqual({ value: 'later header' });
  });
});
