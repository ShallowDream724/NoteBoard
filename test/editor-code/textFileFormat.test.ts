import { beforeEach, describe, expect, it, vi } from 'vitest';
import { confirm, save } from '@tauri-apps/plugin-dialog';
import { bumpDocumentRevision } from '@/core/editor/editorRegistry';
import * as ipc from '@/core/ipc/commands';
import type { DocumentPayload, WriteResult } from '@/core/ipc/types';
import { saveDocument } from '@/features/editor-code/orchestration/saveDocument';
import { changeFileEol, reopenFileWithEncoding, saveFileWithEncoding } from '@/features/editor-code/orchestration/textFileFormat';
import { getBaseline } from '@/features/editor-md/serialize';
import { __debugSessionState, queuedAutoSave } from '@/features/session/documentSession';
import { useDocumentStore } from '@/stores/documentStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useWindowStore } from '@/stores/windowStore';

vi.mock('@tauri-apps/plugin-dialog', () => ({ confirm: vi.fn(), save: vi.fn() }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ label: 'nb-1' }) }));
vi.mock('@/core/ipc/commands', () => ({
  readDocument: vi.fn(), writeDocument: vi.fn(), setDocumentDirty: vi.fn(async () => undefined),
  registerDocument: vi.fn(async () => ({ type: 'ok' })), unregisterDocument: vi.fn(async () => undefined),
}));
vi.mock('@/features/explorer/directoryWatcher', () => ({ noteSelfWrite: vi.fn() }));

const key = 'C:\\work\\file.txt';
const initial: DocumentPayload = {
  key, kind: 'code', language: 'plaintext', displayName: 'file.txt', dirPath: 'C:\\work',
  encoding: 'utf8', eol: 'lf', content: 'first\nsecond', mtime: 3, size: 12, readonly: false,
};
const saved: WriteResult = { ok: true, size: 15, mtime: 4, error: null };
const documents = useDocumentStore.getState();
const tabs = useWindowStore.getState();

function open(payload = initial) {
  documents.upsertFromPayload(payload);
  getBaseline(payload.key).setBaseline(payload.content ?? '');
  tabs.openTab({
    key: payload.key, displayName: payload.displayName, path: payload.key.startsWith('untitled:') ? null : payload.key,
    kind: payload.kind, language: payload.language, isDirty: false, isPreview: false, viewMode: null,
    externalStatus: 'clean', isDetached: false,
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(apply => { resolve = apply; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  useDocumentStore.setState({ documents: new Map() });
  useWindowStore.setState({ tabs: [], activeKey: null, transferringKeys: [], isWindowClosing: false });
  vi.mocked(ipc.writeDocument).mockResolvedValue(saved);
  vi.mocked(ipc.readDocument).mockResolvedValue({ ...initial, encoding: 'windows-1252', content: 'café', mtime: 4, size: 4 });
  vi.mocked(confirm).mockResolvedValue(true);
  vi.mocked(save).mockResolvedValue(null);
});

describe('text-file format actions', () => {
  it('keeps a newline-only edit dirty independently of the editor text and saves the exact disk format', async () => {
    open();
    expect(await changeFileEol(key, 'crlf')).toBe(true);
    documents.setContent(key, 'changed');
    documents.setContent(key, initial.content!);
    expect(documents.getDocument(key)).toMatchObject({ eol: 'crlf', persistedEol: 'lf', isDirty: true });
    expect(tabs.getTab(key)?.isDirty).toBe(true);
    expect(await saveDocument(key)).toBe(true);
    expect(ipc.writeDocument).toHaveBeenCalledWith(key, initial.content, 'utf8', 'crlf', undefined, {
      encoding: 'utf8', content: initial.content, size: initial.size, mtime: initial.mtime,
    });
    expect(documents.getDocument(key)).toMatchObject({ persistedContent: 'first\r\nsecond', persistedEol: 'crlf', isDirty: false });
  });

  it('commits the chosen encoding only after the guarded write succeeds', async () => {
    open();
    vi.mocked(ipc.writeDocument).mockResolvedValueOnce({
      ok: false, size: 0, mtime: 0, error: { kind: 'encoding', message: '文本中含有当前编码无法表示的字符' },
    });
    expect(await saveFileWithEncoding(key, 'windows-1252')).toBe(false);
    expect(documents.getDocument(key)).toMatchObject({ encoding: 'utf8', encodingOverride: null });
    expect(await saveFileWithEncoding(key, 'windows-1252')).toBe(true);
    expect(documents.getDocument(key)).toMatchObject({ encoding: 'windows-1252', encodingOverride: 'windows-1252' });
    expect(await saveDocument(key)).toBe(true);
    expect(ipc.writeDocument).toHaveBeenLastCalledWith(key, initial.content, 'windows-1252', 'lf');
  });

  it('keeps a newer line-ending choice pending when an older write completes', async () => {
    open();
    await changeFileEol(key, 'crlf');
    const started = deferred<void>();
    const result = deferred<WriteResult>();
    vi.mocked(ipc.writeDocument).mockImplementationOnce(() => {
      started.resolve(undefined);
      return result.promise;
    });
    const saving = saveDocument(key);
    await started.promise;
    await changeFileEol(key, 'lf');
    result.resolve(saved);

    expect(await saving).toBe(true);
    expect(documents.getDocument(key)).toMatchObject({ eol: 'lf', persistedEol: 'crlf', isDirty: true });
    expect(tabs.getTab(key)?.isDirty).toBe(true);
    expect(await saveDocument(key)).toBe(true);
    expect(ipc.writeDocument).toHaveBeenLastCalledWith(key, initial.content, 'utf8', 'lf', undefined, {
      encoding: 'utf8', content: 'first\r\nsecond', size: saved.size, mtime: saved.mtime,
    });
  });

  it('preserves edits and marks the conflict when the disk changes before publication', async () => {
    open();
    documents.setContent(key, 'unsaved');
    vi.mocked(ipc.writeDocument).mockResolvedValueOnce({
      ok: false, size: 0, mtime: 0, error: { kind: 'conflict', message: '文件已在磁盘上修改' },
    });
    expect(await saveFileWithEncoding(key, 'utf16-le')).toBe(false);
    expect(documents.getDocument(key)).toMatchObject({ encoding: 'utf8', content: 'unsaved', isDirty: true, externalStatus: 'modified' });
    expect(tabs.getTab(key)?.externalStatus).toBe('modified');
  });

  it('uses the committed encoding for autosaves queued while conversion is writing', async () => {
    const settings = useSettingsStore.getState().settings;
    useSettingsStore.setState({ settings: { ...settings, file: { ...settings.file, autoSaveOther: true } } });
    try {
      open();
      const started = deferred<void>();
      const result = deferred<WriteResult>();
      vi.mocked(ipc.writeDocument).mockImplementationOnce(() => {
        started.resolve(undefined);
        return result.promise;
      });
      const converting = saveFileWithEncoding(key, 'windows-1252');
      await started.promise;
      documents.setContent(key, 'latest');
      bumpDocumentRevision(key);
      const autosaving = queuedAutoSave(key, 'latest');
      result.resolve(saved);
      expect(await converting).toBe(true);
      await autosaving;
      expect(ipc.writeDocument).toHaveBeenLastCalledWith(key, 'latest', 'windows-1252', 'lf');
    } finally { useSettingsStore.setState({ settings }); }
  });

  it('honors cancel and never writes disk when reopening with an encoding', async () => {
    open({ ...initial, kind: 'markdown', language: 'markdown' });
    documents.setContent(key, 'unsaved');
    vi.mocked(confirm).mockResolvedValueOnce(false);
    expect(await reopenFileWithEncoding(key, 'windows-1252')).toBe(false);
    expect(ipc.readDocument).not.toHaveBeenCalled();
    expect(documents.getDocument(key)?.content).toBe('unsaved');
    vi.mocked(ipc.readDocument).mockResolvedValueOnce({ ...initial, kind: 'markdown', encoding: 'windows-1252', content: 'café' });
    expect(await reopenFileWithEncoding(key, 'windows-1252')).toBe(true);
    expect(ipc.readDocument).toHaveBeenCalledWith(key, expect.any(Number), 'windows-1252');
    expect(documents.getDocument(key)).toMatchObject({ content: 'café', encoding: 'windows-1252', encodingOverride: 'windows-1252', isDirty: false });
    expect(ipc.writeDocument).not.toHaveBeenCalled();
  });

  it('retains newer edits arriving while the selected decoder is reading', async () => {
    open();
    const started = deferred<void>();
    const reading = deferred<DocumentPayload>();
    vi.mocked(ipc.readDocument).mockImplementationOnce(() => {
      started.resolve(undefined);
      return reading.promise;
    });
    const reopening = reopenFileWithEncoding(key, 'windows-1252');
    await started.promise;
    documents.setContent(key, 'new edit');
    bumpDocumentRevision(key);
    reading.resolve({ ...initial, encoding: 'windows-1252', content: 'café' });
    expect(await reopening).toBe(false);
    expect(documents.getDocument(key)).toMatchObject({ content: 'new edit', encoding: 'utf8', isDirty: true });
  });

  it('invalidates queued write snapshots captured before a successful reopen', async () => {
    open();
    const started = deferred<void>();
    const reading = deferred<DocumentPayload>();
    vi.mocked(ipc.readDocument).mockImplementationOnce(() => {
      started.resolve(undefined);
      return reading.promise;
    });
    const reopening = reopenFileWithEncoding(key, 'windows-1252');
    await started.promise;
    const readBarrier = __debugSessionState().queues.get(key);
    const saving = saveDocument(key);
    await vi.waitFor(() => expect(__debugSessionState().queues.get(key)).not.toBe(readBarrier));
    reading.resolve({ ...initial, encoding: 'windows-1252', content: 'café' });
    expect(await reopening).toBe(true);
    expect(await saving).toBe(false);
    expect(ipc.writeDocument).not.toHaveBeenCalled();
    expect(documents.getDocument(key)?.content).toBe('café');
  });

  it('routes untitled text to Save As with its chosen encoding and line endings', async () => {
    const untitled = 'untitled:text-format';
    open({ ...initial, key: untitled });
    await changeFileEol(untitled, 'crlf');
    vi.mocked(save).mockResolvedValueOnce(key);
    expect(await saveFileWithEncoding(untitled, 'utf16-le')).toBe(true);
    expect(ipc.writeDocument).toHaveBeenCalledWith(key, initial.content, 'utf16-le', 'crlf');
    expect(documents.getDocument(key)).toMatchObject({ encoding: 'utf16-le', eol: 'crlf', persistedEol: 'crlf', isDirty: false });
    expect(documents.getDocument(untitled)).toBeUndefined();
  });
});
