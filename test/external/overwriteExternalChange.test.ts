import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { registerEditorCapabilities, resetEditorRegistryForTest } from '@/core/editor/editorRegistry';
import type { CapturedContent, EditorCapabilities } from '@/core/editor/editorTypes';
import * as ipc from '@/core/ipc/commands';
import type { DocumentPayload, WriteResult } from '@/core/ipc/types';
import { encodeNativeDocument } from '@/core/nativeDocument';
import { documentTextHash, saveNativeBundle } from '@/core/nativeDocumentIO';
import { getBaseline } from '@/features/editor-md/serialize';
import { overwriteFromEditor } from '@/features/external/externalChangeActions';
import { useDocumentStore } from '@/stores/documentStore';
import { showToast } from '@/stores/toastStore';
import { useWindowStore } from '@/stores/windowStore';

vi.mock('@/core/ipc/commands', () => ({
  readDocument: vi.fn(),
  writeDocument: vi.fn(),
  setDocumentDirty: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/core/nativeDocumentIO', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/core/nativeDocumentIO')>(),
  saveNativeBundle: vi.fn(),
}));
vi.mock('@/features/editor-md/imageAssetLifecycle', () => ({ restoreImageAssetsForContent: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/features/explorer/directoryWatcher', () => ({ noteSelfWrite: vi.fn() }));
vi.mock('@/features/staging/stagingManager', () => ({
  discardStagedDocuments: vi.fn().mockResolvedValue(undefined),
  releaseStagedDocument: vi.fn(),
  onDocumentSaved: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/stores/toastStore', () => ({ showToast: vi.fn() }));

const KEY = 'C:/Notes/memo.md';
const NATIVE_KEY = 'C:/Notes/memo.nb';
const BASELINE = '原磁盘正文';
const MIRROR = '已同步的编辑';
const EDIT = '尚未同步的编辑';

function payload(key: string, kind: 'markdown' | 'noteboard', content: string): DocumentPayload {
  return { key, displayName: key.split('/').at(-1)!, dirPath: 'C:/Notes', kind,
    language: 'markdown', content, encoding: 'utf8', eol: 'lf', readonly: false,
    mtime: 1, size: content.length };
}

function seedConflict(key = KEY, kind: 'markdown' | 'noteboard' = 'markdown', baseline = BASELINE, content = MIRROR): void {
  const disk = payload(key, kind, baseline);
  const documents = useDocumentStore.getState();
  documents.upsertFromPayload(disk);
  documents.setContent(key, content);
  documents.setExternalStatus(key, 'modified');
  getBaseline(key).updateBaseline(baseline);
  useWindowStore.getState().openTab({ key, displayName: disk.displayName, path: key, kind,
    language: 'markdown', isDirty: true, isPreview: false, viewMode: 'source', externalStatus: 'modified', isDetached: false });
}

function registerEditor(flush: EditorCapabilities['flush']): void {
  registerEditorCapabilities({ docKey: KEY, instanceId: 'editor', getRevision: () => 1,
    flush, focus() {}, getSelectedText: () => '', canSuspend: () => false });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetEditorRegistryForTest();
  useDocumentStore.setState({ documents: new Map() });
  useWindowStore.setState({ tabs: [], activeKey: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('写入编辑器的最新快照，等写盘成功后才清除文档和标签上的冲突', async () => {
  seedConflict();
  registerEditor(async () => {
    useDocumentStore.getState().setContent(KEY, EDIT);
    return { docKey: KEY, instanceId: 'editor', revision: 1, content: EDIT };
  });
  let finishWrite!: (result: WriteResult) => void;
  vi.mocked(ipc.writeDocument).mockImplementationOnce(() => new Promise(resolve => { finishWrite = resolve; }));

  const writing = overwriteFromEditor(KEY);
  await vi.waitFor(() => expect(ipc.writeDocument).toHaveBeenCalledWith(KEY, EDIT, 'utf8', 'lf'));
  expect(useDocumentStore.getState().getDocument(KEY)).toMatchObject({ baselineContent: BASELINE, externalStatus: 'modified' });
  expect(useWindowStore.getState().getTab(KEY)?.externalStatus).toBe('modified');

  finishWrite({ ok: true, mtime: 2, size: 10, error: null });
  await expect(writing).resolves.toBe(true);
  expect(useDocumentStore.getState().getDocument(KEY)).toMatchObject({ content: EDIT, baselineContent: EDIT, persistedContent: EDIT, isDirty: false, externalStatus: 'clean' });
  expect(useWindowStore.getState().getTab(KEY)).toMatchObject({ isDirty: false, externalStatus: 'clean' });
  expect(showToast).toHaveBeenCalledWith('已用当前内容覆盖磁盘文件', 'success');
});

it('获取编辑器快照失败时保留当前内容和冲突，并提示失败原因', async () => {
  seedConflict();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  registerEditor(async () => { throw new Error('源码序列化失败'); });

  await expect(overwriteFromEditor(KEY)).resolves.toBe(false);
  expect(ipc.writeDocument).not.toHaveBeenCalled();
  expect(useDocumentStore.getState().getDocument(KEY)).toMatchObject({ content: MIRROR, baselineContent: BASELINE, isDirty: true, externalStatus: 'modified' });
  expect(useWindowStore.getState().getTab(KEY)?.externalStatus).toBe('modified');
  expect(showToast).toHaveBeenCalledWith(expect.stringContaining('源码序列化失败'), 'error');
});

it('写盘失败时保留脏态和基线，再试成功时清除冲突', async () => {
  seedConflict();
  vi.mocked(ipc.writeDocument).mockResolvedValueOnce({ ok: false, mtime: 0, size: 0, error: { kind: 'disk-full' } });
  await expect(overwriteFromEditor(KEY)).resolves.toBe(false);
  expect(useDocumentStore.getState().getDocument(KEY)).toMatchObject({ content: MIRROR, baselineContent: BASELINE, persistedContent: BASELINE, isDirty: true, externalStatus: 'modified' });
  expect(useWindowStore.getState().getTab(KEY)?.externalStatus).toBe('modified');
  expect(showToast).toHaveBeenCalledWith(expect.stringContaining('覆盖磁盘失败'), 'error');

  vi.mocked(ipc.writeDocument).mockResolvedValueOnce({ ok: true, mtime: 2, size: 8, error: null });
  await expect(overwriteFromEditor(KEY)).resolves.toBe(true);
  expect(useDocumentStore.getState().getDocument(KEY)).toMatchObject({ baselineContent: MIRROR, persistedContent: MIRROR, externalStatus: 'clean' });
});

it('同路径重开后忽略旧编辑器的迟到快照', async () => {
  seedConflict();
  let finishCapture!: (snapshot: CapturedContent) => void;
  const flush = vi.fn(() => new Promise<CapturedContent>(resolve => { finishCapture = resolve; }));
  registerEditor(flush);
  const writing = overwriteFromEditor(KEY);
  await vi.waitFor(() => expect(flush).toHaveBeenCalledWith('save'));

  useDocumentStore.getState().remove(KEY);
  seedConflict(KEY, 'markdown', '新会话基线', '新会话正文');
  finishCapture({ docKey: KEY, instanceId: 'editor', revision: 1, content: EDIT });

  await expect(writing).resolves.toBe(false);
  expect(ipc.writeDocument).not.toHaveBeenCalled();
  expect(useDocumentStore.getState().getDocument(KEY)).toMatchObject({ content: '新会话正文', baselineContent: '新会话基线', externalStatus: 'modified' });
});

it('原生文档以当前磁盘文件的版本为条件，避免写掉核对后出现的外部修改', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const native = (text: string) => encodeNativeDocument({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }, {});
  const baseline = native(BASELINE);
  const edited = native(EDIT);
  const external = native('外部改动');
  seedConflict(NATIVE_KEY, 'noteboard', baseline, edited);
  vi.mocked(ipc.readDocument).mockResolvedValueOnce(payload(NATIVE_KEY, 'noteboard', external));
  vi.mocked(saveNativeBundle).mockResolvedValueOnce({ ok: false });

  await expect(overwriteFromEditor(NATIVE_KEY)).resolves.toBe(false);
  expect(saveNativeBundle).toHaveBeenCalledWith(expect.objectContaining({ path: NATIVE_KEY, content: edited, createOnly: false, expectedHash: await documentTextHash(external) }));
  expect(useDocumentStore.getState().getDocument(NATIVE_KEY)).toMatchObject({ baselineContent: baseline, persistedContent: baseline, externalStatus: 'modified' });
});
