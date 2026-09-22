import { beforeEach, expect, it, vi } from 'vitest';
import { Text } from '@codemirror/state';
import * as ipc from '@/core/ipc/commands';
import { renameOpenPath } from '@/features/explorer/renameOpenPath';
import { useDocumentStore } from '@/stores/documentStore';
import { useWindowStore } from '@/stores/windowStore';
import { enqueueDocumentWrite, getSessionGeneration } from '@/features/session/documentSession';
import { bumpDocumentRevision, getDocumentRevision, resetEditorRegistryForTest } from '@/core/editor/editorRegistry';
import { stagePendingSourceSnapshot } from '@/features/editor-md/visualSnapshot';
import { initializeDocumentHistory, getCurrentDocumentHistoryContent } from '@/features/history/documentHistory';
import { getBaseline } from '@/features/editor-md/serialize';
import { getStagedPath, registerRestoredStagedPath } from '@/features/staging/stagingManager';

vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ label: 'rename-test' }) }));
vi.mock('@/features/explorer/directoryWatcher', () => ({ noteSelfWrite: vi.fn() }));
vi.mock('@/features/editor-md/imageAssetLifecycle', () => ({ prepareImageAssetsForIdentity: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/core/ipc/commands', () => ({
  renamePath: vi.fn(), writeDocument: vi.fn(), setDocumentDirty: vi.fn().mockResolvedValue(undefined),
  unregisterDocument: vi.fn().mockResolvedValue(undefined), registerDocument: vi.fn(),
  stashDocuments: vi.fn(), deleteStagedFile: vi.fn().mockResolvedValue(undefined),
}));

function seed(key: string): void {
  useDocumentStore.getState().upsertFromPayload({ key, displayName: key.split(/[\\/]/).pop()!, dirPath: 'C:\\notes', kind: 'markdown', language: 'markdown', content: 'base', encoding: 'utf8', eol: 'lf', size: 4, mtime: 1, readonly: false });
  useWindowStore.getState().openTab({ key, path: key, displayName: 'note.md', kind: 'markdown', language: 'markdown', isDirty: false, isPreview: false, viewMode: 'source', externalStatus: null, isDetached: false });
  initializeDocumentHistory(key, 'base', 'source');
  getBaseline(key).setBaseline('base');
}
function edit(key: string, content: string): void {
  stagePendingSourceSnapshot(key, { text: Text.of([content]), revision: bumpDocumentRevision(key), isNewGroup: true });
}
async function ticks(): Promise<void> { for (let i = 0; i < 30; i++) await Promise.resolve(); }

beforeEach(() => {
  vi.clearAllMocks();
  useWindowStore.setState({ tabs: [], activeKey: null, transferringKeys: [], pendingCloseKeys: [], isWindowClosing: false });
  useDocumentStore.getState().clear();
  resetEditorRegistryForTest();
  vi.mocked(ipc.renamePath).mockResolvedValue(undefined);
});

it('moves pending input, history, revision and staging after draining writes without saving', async () => {
  const old = 'C:\\notes\\old.md', next = 'C:\\notes\\new.md';
  seed(old); registerRestoredStagedPath(old, 'C:\\staged\\recovery.md'); edit(old, 'before rename');
  let releaseWrite!: () => void, releaseRename!: () => void;
  const queued = enqueueDocumentWrite(old, () => new Promise<void>(resolve => { releaseWrite = resolve; }));
  await ticks();
  vi.mocked(ipc.renamePath).mockImplementation(() => new Promise<void>(resolve => { releaseRename = resolve; }));
  const moving = renameOpenPath(old, next, false);
  await ticks();
  expect(ipc.renamePath).not.toHaveBeenCalled();
  useWindowStore.getState().closeTab(old);
  useWindowStore.getState().closeAllTabs();
  expect(useWindowStore.getState().getTab(old)).not.toBeNull();
  edit(old, 'during drain'); releaseWrite(); await queued; await ticks();
  expect(ipc.renamePath).toHaveBeenCalledWith('rename-test', old, next, [old]);
  edit(old, 'during native rename'); releaseRename(); await moving;
  const doc = useDocumentStore.getState().getDocument(next);
  expect(doc).toMatchObject({ content: 'during native rename', baselineContent: 'base', isDirty: true });
  expect(getCurrentDocumentHistoryContent(next)).toBe('during native rename');
  expect(getDocumentRevision(next)).toBe(3);
  expect(getDocumentRevision(old)).toBe(0);
  expect(getStagedPath(next)).toBe('C:\\staged\\recovery.md');
  expect(getStagedPath(old)).toBeNull();
  expect(useWindowStore.getState().getTab(next)?.isDirty).toBe(true);
  expect(useWindowStore.getState().transferringKeys).toEqual([]);
  expect(ipc.writeDocument).not.toHaveBeenCalled();
});

it('keeps dirty content and the original session when native rename fails', async () => {
  const key = 'C:\\notes\\failure.md'; seed(key); edit(key, 'unsaved');
  const generation = getSessionGeneration(key);
  vi.mocked(ipc.renamePath).mockRejectedValueOnce(new Error('target exists'));
  await expect(renameOpenPath(key, 'C:\\notes\\target.md', false)).rejects.toThrow('target exists');
  expect(useDocumentStore.getState().getDocument(key)).toMatchObject({ content: 'unsaved', baselineContent: 'base', isDirty: true });
  expect(getSessionGeneration(key)).toBe(generation);
  expect(useWindowStore.getState().transferringKeys).toEqual([]);
  expect(ipc.writeDocument).not.toHaveBeenCalled();
});

it('renames only directory descendants using normalized identities', async () => {
  seed('C:/notes/sub/a.md'); seed('C:\\NOTES\\b.md'); seed('C:\\notes-other\\c.md');
  await renameOpenPath('c:\\notes', 'C:\\renamed', true);
  expect(useDocumentStore.getState().hasDocument('C:\\renamed\\sub\\a.md')).toBe(true);
  expect(useDocumentStore.getState().hasDocument('C:\\renamed\\b.md')).toBe(true);
  expect(useDocumentStore.getState().hasDocument('C:\\notes-other\\c.md')).toBe(true);
});

it('reclassifies the tab after an extension change', async () => {
  const old = 'C:\\notes\\syntax.md', next = 'C:\\notes\\syntax.sql'; seed(old); edit(old, 'SELECT 1');
  await renameOpenPath(old, next, false);
  expect(useDocumentStore.getState().getDocument(next)).toMatchObject({ kind: 'code', language: 'sql', content: 'SELECT 1', isDirty: true });
  expect(useWindowStore.getState().getTab(next)).toMatchObject({ kind: 'code', language: 'sql', viewMode: null, isDirty: true });
});
