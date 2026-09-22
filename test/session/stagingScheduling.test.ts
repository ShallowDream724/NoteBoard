import { afterEach, expect, it, vi } from 'vitest';
import { startStagingManager, stashPendingDocuments, discardStagedDocuments, onDocumentSaved, getStagedPath } from '@/features/staging/stagingManager';
import { bumpDocumentRevision } from '@/core/editor/editorRegistry';
import { useDocumentStore } from '@/stores/documentStore';
import { useWindowStore } from '@/stores/windowStore';
import { syncDocumentContent } from '@/features/editor-code/orchestration/syncDocumentContent';
import * as ipc from '@/core/ipc/commands';

vi.mock('@/core/ipc/commands', () => ({
  stashDocuments: vi.fn(async documents => documents.map((document: { key: string }) => ({ key: document.key, targetPath: document.key + '.staged' }))),
  deleteStagedFile: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/features/editor-code/orchestration/syncDocumentContent', () => ({
  syncDocumentContent: vi.fn(async (key: string) => useDocumentStore.getState().getDocument(key)),
}));

let stop: (() => void) | undefined;
const keys = ['C:\\staging-qa\\one.md', 'C:\\staging-qa\\two.md'];
afterEach(async () => {
  stop?.(); stop = undefined;
  await discardStagedDocuments(keys);
  useDocumentStore.getState().clear();
  useWindowStore.setState({ tabs: [], activeKey: null });
  vi.useRealTimers(); vi.clearAllMocks();
});

function seed() {
  for (const key of keys) {
    useDocumentStore.getState().upsertFromPayload({ key, displayName: key, dirPath: '', kind: 'markdown', language: 'markdown', content: 'base', encoding: 'utf8', eol: 'lf', size: 4, mtime: 0, readonly: false });
    useDocumentStore.getState().setContent(key, 'edit');
    useWindowStore.getState().openTab({ key, displayName: key, path: key, kind: 'markdown', language: 'markdown', isDirty: true, isPreview: false, viewMode: 'visual', externalStatus: null, isDetached: false });
  }
}

it('only flushes changed revisions after initial staging; idle fallback and focus do not recopy the document', async () => {
  vi.useFakeTimers(); seed();
  stop = startStagingManager();
  await vi.advanceTimersByTimeAsync(800);
  expect(syncDocumentContent).toHaveBeenCalledTimes(2);
  vi.mocked(syncDocumentContent).mockClear(); vi.mocked(ipc.stashDocuments).mockClear();
  await vi.advanceTimersByTimeAsync(10_000);
  window.dispatchEvent(new Event('blur'));
  await vi.advanceTimersByTimeAsync(0);
  expect(syncDocumentContent).not.toHaveBeenCalled();
  expect(ipc.stashDocuments).not.toHaveBeenCalled();

  const documents = useDocumentStore.getState().documents;
  for (let i = 0; i < 100; i++) {
    bumpDocumentRevision(keys[0]);
    useDocumentStore.getState().setDirty(keys[0], true);
  }
  expect(useDocumentStore.getState().documents).toBe(documents);
  expect(syncDocumentContent).not.toHaveBeenCalled();
  // Equal-length replacement must be included even while isDirty stays true.
  useDocumentStore.getState().setContent(keys[0], 'next');
  await vi.advanceTimersByTimeAsync(800);
  expect(syncDocumentContent).toHaveBeenCalledExactlyOnceWith(keys[0]);
  expect(vi.mocked(ipc.stashDocuments).mock.calls[0][0][0].content).toBe('next');
  // Explicit close/save capture still flushes even if the version is unchanged.
  await stashPendingDocuments({ keys: [keys[0]], retain: true });
  expect(syncDocumentContent).toHaveBeenCalledTimes(2);
});

it('retries a failed automatic write on the fallback pass', async () => {
  vi.useFakeTimers(); seed();
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.mocked(ipc.stashDocuments).mockRejectedValueOnce(new Error('busy'));
  try {
    stop = startStagingManager();
    await vi.advanceTimersByTimeAsync(800);
    vi.mocked(syncDocumentContent).mockClear();
    await vi.advanceTimersByTimeAsync(4200);
    expect(syncDocumentContent).toHaveBeenCalledExactlyOnceWith(keys[0]);
  } finally { error.mockRestore(); }
});

it('retains a newer empty-document recovery copy after an older save completes', async () => {
  seed();
  useDocumentStore.getState().setContent(keys[0], '');
  await stashPendingDocuments({ keys: [keys[0]] });
  await onDocumentSaved(keys[0], 'older saved text');
  expect(getStagedPath(keys[0])).toBe(keys[0] + '.staged');
  expect(ipc.deleteStagedFile).not.toHaveBeenCalled();
});

it('serializes save cleanup before a newer recovery write to the same path', async () => {
  seed();
  await stashPendingDocuments({ keys: [keys[0]] });
  let release!: () => void, started!: () => void;
  const deleting = new Promise<void>(resolve => { started = resolve; });
  vi.mocked(ipc.deleteStagedFile).mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; started(); }));
  const cleaned = onDocumentSaved(keys[0], 'edit');
  await deleting;
  useDocumentStore.getState().setContent(keys[0], 'newer');
  vi.mocked(ipc.stashDocuments).mockClear();
  const saved = stashPendingDocuments({ keys: [keys[0]] });
  await Promise.resolve();
  expect(ipc.stashDocuments).not.toHaveBeenCalled();
  release(); await cleaned; await saved;
  expect(vi.mocked(ipc.stashDocuments).mock.calls[0][0][0].content).toBe('newer');
  expect(getStagedPath(keys[0])).toBe(keys[0] + '.staged');
});

it('retains cleanup ownership after a filesystem failure so it can retry', async () => {
  seed(); await stashPendingDocuments({ keys: [keys[0]] });
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    vi.mocked(ipc.deleteStagedFile).mockRejectedValueOnce(new Error('busy'));
    await onDocumentSaved(keys[0], 'edit');
    expect(getStagedPath(keys[0])).not.toBeNull();
    await onDocumentSaved(keys[0], 'edit');
    expect(getStagedPath(keys[0])).toBeNull();
  } finally { warning.mockRestore(); }
});
