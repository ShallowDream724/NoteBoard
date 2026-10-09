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
import { kindFromPath, languageFromPath } from '@/core/docKind';
import { useExplorerStore } from '@/features/explorer/explorerStore';

vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ label: 'rename-test' }) }));
vi.mock('@/features/explorer/directoryWatcher', () => ({ noteSelfWrite: vi.fn() }));
vi.mock('@/features/editor-md/imageAssetLifecycle', () => ({ prepareImageAssetsForIdentity: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/core/ipc/commands', () => ({
  renamePath: vi.fn(), writeDocument: vi.fn(), setDocumentDirty: vi.fn().mockResolvedValue(undefined),
  unregisterDocument: vi.fn().mockResolvedValue(undefined), registerDocument: vi.fn(),
  stashDocuments: vi.fn(), deleteStagedFile: vi.fn().mockResolvedValue(undefined),
}));

function seed(key: string): void {
  const kind = kindFromPath(key), language = languageFromPath(key);
  useDocumentStore.getState().upsertFromPayload({ key, displayName: key.split(/[\\/]/).pop()!, dirPath: 'C:\\notes', kind, language, content: 'base', encoding: 'utf8', eol: 'lf', size: 4, mtime: 1, readonly: false });
  useWindowStore.getState().openTab({ key, path: key, displayName: key.split(/[\\/]/).pop()!, kind, language, isDirty: false, isPreview: false, viewMode: kind === 'markdown' ? 'source' : null, externalStatus: null, isDetached: false });
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
  useExplorerStore.getState().clear();
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
  const context = { root: 'C:\\notes', source: 'tree' as const };
  useWindowStore.getState().setTabExplorerContext(key, context);
  useExplorerStore.getState().setRoot('C:\\notes', []);
  useExplorerStore.getState().setWorkspaceRoot('C:\\notes');
  const generation = getSessionGeneration(key);
  vi.mocked(ipc.renamePath).mockRejectedValueOnce(new Error('target exists'));
  await expect(renameOpenPath(key, 'C:\\notes\\target.md', false)).rejects.toThrow('target exists');
  expect(useDocumentStore.getState().getDocument(key)).toMatchObject({ content: 'unsaved', baselineContent: 'base', isDirty: true });
  expect(getSessionGeneration(key)).toBe(generation);
  expect(useWindowStore.getState().transferringKeys).toEqual([]);
  expect(ipc.writeDocument).not.toHaveBeenCalled();
  expect(useWindowStore.getState().getTab(key)?.explorerContext).toBe(context);
  expect(useExplorerStore.getState().root).toBe('C:\\notes');
  expect(useExplorerStore.getState().workspaceRoot).toBe('C:\\notes');
});

it('renames only directory descendants using normalized identities', async () => {
  seed('C:/notes/sub/a.md'); seed('C:\\NOTES\\b.md'); seed('C:\\notes-other\\c.md');
  useWindowStore.getState().setTabExplorerContext('C:/notes/sub/a.md', { root: 'C:\\notes', source: 'tree' });
  useWindowStore.getState().setTabExplorerContext('C:\\NOTES\\b.md', { root: 'C:\\notes', source: 'locate' });
  useWindowStore.getState().setTabExplorerContext('C:\\notes-other\\c.md', { root: 'C:\\notes-other', source: 'parent' });
  useExplorerStore.getState().setWorkspaceRoot('C:\\notes');
  useExplorerStore.getState().setRoot('C:\\notes', []);
  useExplorerStore.getState().expand('C:\\notes\\sub', []);
  await renameOpenPath('c:\\notes', 'C:\\renamed', true);
  expect(useDocumentStore.getState().hasDocument('C:\\renamed\\sub\\a.md')).toBe(true);
  expect(useDocumentStore.getState().hasDocument('C:\\renamed\\b.md')).toBe(true);
  expect(useDocumentStore.getState().hasDocument('C:\\notes-other\\c.md')).toBe(true);
  expect(useWindowStore.getState().getTab('C:\\renamed\\sub\\a.md')?.explorerContext).toEqual({ root: 'C:\\renamed', source: 'tree' });
  expect(useWindowStore.getState().getTab('C:\\renamed\\b.md')?.explorerContext).toEqual({ root: 'C:\\renamed', source: 'locate' });
  expect(useWindowStore.getState().getTab('C:\\notes-other\\c.md')?.explorerContext).toEqual({ root: 'C:\\notes-other', source: 'parent' });
  expect(useExplorerStore.getState().workspaceRoot).toBe('C:\\renamed');
  expect(useExplorerStore.getState().root).toBe('C:\\renamed');
  expect(useExplorerStore.getState().children.size).toBe(1);
});

it('reclassifies the tab after an extension change', async () => {
  const old = 'C:\\notes\\syntax.md', next = 'C:\\notes\\syntax.sql'; seed(old); edit(old, 'SELECT 1');
  await renameOpenPath(old, next, false);
  expect(useDocumentStore.getState().getDocument(next)).toMatchObject({ kind: 'code', language: 'sql', content: 'SELECT 1', isDirty: true });
  expect(useWindowStore.getState().getTab(next)).toMatchObject({ kind: 'code', language: 'sql', viewMode: null, isDirty: true });
});

it('reclassifies repeated extension changes without converting or saving pending content', async () => {
  let key = 'C:\\notes\\A'; seed(key); edit(key, '# unsaved');
  for (const [name, kind] of [['A.MD', 'markdown'], ['A.Doc', 'unsupported'], ['A.docx', 'unsupported'], ['A.md', 'markdown'], ['A', 'code']] as const) {
    const next = 'C:\\notes\\' + name;
    await renameOpenPath(key, next, false);
    expect(useDocumentStore.getState().getDocument(next)).toMatchObject({ kind, content: '# unsaved', baselineContent: 'base', isDirty: true });
    expect(useWindowStore.getState().getTab(next)).toMatchObject({ kind, isDirty: true });
    expect(getCurrentDocumentHistoryContent(next)).toBe('# unsaved');
    key = next;
  }
  expect(ipc.writeDocument).not.toHaveBeenCalled();
});
