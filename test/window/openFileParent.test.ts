import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTabFromPath, openDocument } from '../../src/features/editor-code/orchestration/openDocument';
import { followExplorerFile, openExplorerDirectory, revealExplorerFile } from '../../src/features/explorer/explorerActions';
import { getPathChain, useExplorerStore } from '../../src/features/explorer/explorerStore';
import { useDocumentStore } from '../../src/stores/documentStore';
import { useLayoutStore } from '../../src/stores/layoutStore';
import { useWindowStore } from '../../src/stores/windowStore';
import type { DocumentPayload, FileTreeNode, PreparedDocument } from '../../src/core/ipc/types';
import * as ipc from '../../src/core/ipc/commands';
import { emitTo } from '@tauri-apps/api/event';
import { confirm } from '@tauri-apps/plugin-dialog';

const currentWindow = vi.hoisted(() => ({ label: 'nb-main' }));

vi.mock('../../src/core/ipc/commands', () => ({
  prepareDocument: vi.fn(), registerDocument: vi.fn(), readDir: vi.fn(),
  pushRecent: vi.fn(), focusWindow: vi.fn(), enqueueOpenRequests: vi.fn(),
  unregisterDocument: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => currentWindow }));
vi.mock('@tauri-apps/api/event', () => ({ emitTo: vi.fn(), listen: vi.fn() }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ confirm: vi.fn() }));
vi.mock('../../src/features/editor-host/editorLoaders', () => ({ prefetchEditor: vi.fn(), resolveEditorKind: () => 'markdown' }));

const payload = (key: string): DocumentPayload => ({
  key, displayName: key.split('\\').pop()!, dirPath: key.slice(0, key.lastIndexOf('\\')),
  kind: 'markdown', language: 'markdown', content: '# Ready to edit', encoding: 'utf8',
  eol: 'lf', size: 15, mtime: 0, readonly: false,
});
const directoryNode = (path: string): FileTreeNode => ({ path, name: path.split('\\').pop()!, isDir: true, kind: null, size: null, mtime: 0, isHidden: false, isSymlink: false });

describe('opening a document while preserving Explorer', () => {
  function retainExplorerView(): void {
    const store = useExplorerStore.getState();
    store.setRoot('D:\\workspace', []);
    store.expand('D:\\workspace\\drafts', []);
    store.setRevealed('D:\\workspace\\drafts\\original.md', true);
  }

  function expectExplorerView(): void {
    const state = useExplorerStore.getState();
    expect(state.root).toBe('D:\\workspace');
    expect([...state.expanded.keys()]).toEqual(['d:\\workspace\\drafts']);
    expect(state.revealed).toBe('D:\\workspace\\drafts\\original.md');
    expect(useLayoutStore.getState().explorerVisible).toBe(false);
  }

  it.each(['text', 'image', 'unsupported'] as const)('opens a new %s tab without explicit or delayed passive navigation', async kind => {
    retainExplorerView();
    const key = `C:\\exports\\result.${kind === 'text' ? 'md' : kind === 'image' ? 'png' : 'pdf'}`;
    if (kind !== 'text') vi.mocked(ipc.prepareDocument).mockResolvedValueOnce({
      type: kind, key, displayName: key.split('\\').pop()!, dirPath: 'C:\\exports', language: 'plaintext', size: 4096, mtime: 0,
    });
    expect(await openDocument(key, { explorer: 'preserve', exportNotice: {} })).toBe('opened');
    await paint();
    // This is the same delayed effect used by useReveal, including when the sidebar mounts later.
    await followExplorerFile(key, 'C:\\exports', () => true);
    await followExplorerFile(key, 'C:\\exports', () => true);
    expect(useWindowStore.getState().activeKey).toBe(key);
    expectExplorerView();
    expect(ipc.readDir).not.toHaveBeenCalled();
  });

  it.each(['already-open', 'text-race', 'image-race'] as const)('preserves Explorer for %s activation without replacing dirty text', async branch => {
    const key = branch === 'image-race' ? 'C:\\exports\\result.png' : 'C:\\exports\\result.md';
    const tab = { ...buildTabFromPath(key), isDirty: true };
    useWindowStore.setState({ tabs: [tab], activeKey: null });
    useDocumentStore.getState().upsertFromPayload({ ...payload(key), content: 'unsaved text' });
    retainExplorerView();
    if (branch === 'already-open') {
      vi.mocked(ipc.prepareDocument).mockResolvedValueOnce({ type: 'already-open', key, ownerLabel: 'nb-main', ownerIsSelf: true });
    } else {
      vi.mocked(ipc.registerDocument).mockResolvedValueOnce({ type: 'already-open', ownerLabel: 'nb-main' });
      if (branch === 'image-race') vi.mocked(ipc.prepareDocument).mockResolvedValueOnce({ type: 'image', key, displayName: 'result.png', dirPath: 'C:\\exports', language: 'plaintext', size: 4096, mtime: 0 });
    }
    expect(await openDocument(key, { explorer: 'preserve' })).toBe('focused');
    await followExplorerFile(key, 'C:\\exports', () => true);
    await paint();
    expectExplorerView();
    expect(useWindowStore.getState().getTab(key)?.isDirty).toBe(true);
    if (branch !== 'image-race') expect(useDocumentStore.getState().getDocument(key)?.content).toBe('unsaved text');
    expect(ipc.readDir).not.toHaveBeenCalled();
  });

  it('allows explicit location and restores passive following after leaving the preserved activation', async () => {
    const key = 'C:\\exports\\result.md';
    retainExplorerView();
    await openDocument(key, { explorer: 'preserve' });
    await revealExplorerFile(key, 'C:\\exports');
    expect(useExplorerStore.getState().root).toBe('C:\\exports');
    retainExplorerView();
    useWindowStore.getState().activateTab('D:\\workspace\\drafts\\original.md');
    useWindowStore.getState().activateTab(key);
    await followExplorerFile(key, 'C:\\exports', () => true);
    expect(useExplorerStore.getState().root).toBe('C:\\exports');
    expect(useExplorerStore.getState().revealed).toBe(key);
  });

  it('invalidates a directory result started before the preserve activation', async () => {
    retainExplorerView();
    const directory = deferred<FileTreeNode[]>();
    vi.mocked(ipc.readDir).mockReturnValueOnce(directory.promise);
    const oldReveal = revealExplorerFile('C:\\old\\old.md', 'C:\\old');
    await openDocument('C:\\exports\\result.md', { explorer: 'preserve' });
    directory.resolve([]);
    await oldReveal;
    expectExplorerView();
  });

  it('does not change Explorer when a preserve request resolves to a directory or remote owner', async () => {
    retainExplorerView();
    vi.mocked(ipc.prepareDocument).mockResolvedValueOnce({ type: 'directory', path: 'C:\\exports' });
    expect(await openDocument('C:\\exports', { explorer: 'preserve' })).toBe('failed');
    vi.mocked(ipc.prepareDocument).mockResolvedValueOnce({ type: 'already-open', key: 'C:\\exports\\result.md', ownerLabel: 'nb-owner', ownerIsSelf: false });
    expect(await openDocument('C:\\exports\\result.md', { explorer: 'preserve' })).toBe('focused');
    expectExplorerView();
    expect(ipc.enqueueOpenRequests).not.toHaveBeenCalled();
    expect(ipc.readDir).not.toHaveBeenCalled();
  });
});
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};
async function paint(): Promise<void> { await vi.runAllTimersAsync(); }

beforeEach(() => {
  vi.resetAllMocks();
  currentWindow.label = 'nb-main';
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0));
  useWindowStore.setState({ tabs: [], activeKey: null, transferringKeys: [] });
  useDocumentStore.setState({ documents: new Map() });
  useExplorerStore.getState().clear();
  useLayoutStore.setState({ explorerVisible: false });
  vi.mocked(ipc.prepareDocument).mockImplementation(async (_label, path) => ({ type: 'text', payload: payload(path) }));
  vi.mocked(ipc.registerDocument).mockResolvedValue({ type: 'ok' });
  vi.mocked(ipc.unregisterDocument).mockResolvedValue(undefined);
  vi.mocked(ipc.readDir).mockResolvedValue([]);
  vi.mocked(ipc.pushRecent).mockResolvedValue(undefined);
  vi.mocked(ipc.focusWindow).mockResolvedValue(undefined);
  vi.mocked(ipc.enqueueOpenRequests).mockResolvedValue(['forward-1', 7]);
  vi.mocked(emitTo).mockResolvedValue(undefined);
  vi.mocked(confirm).mockResolvedValue(false);
});

describe('workspace and per-tab Explorer context', () => {
  it('keeps the manually opened highest root for deep system-opened files and reads only their ancestors', async () => {
    const workspace = 'C:\\workspace', file = workspace + '\\B\\C\\deep.md';
    await openExplorerDirectory(workspace);
    useExplorerStore.getState().expand(workspace + '\\other', []);
    vi.mocked(ipc.readDir).mockClear();
    expect(await openDocument(file, { explorer: 'parent' })).toBe('opened');
    await paint();
    await revealExplorerFile(file, payload(file).dirPath);
    expect(useExplorerStore.getState().root).toBe(workspace);
    expect(useExplorerStore.getState().workspaceRoot).toBe(workspace);
    expect(useExplorerStore.getState().isExpanded(workspace + '\\other')).toBe(true);
    expect(useExplorerStore.getState().revealed).toBe(file);
    expect(vi.mocked(ipc.readDir).mock.calls.map(([path]) => path)).toEqual([workspace + '\\B', workspace + '\\B\\C']);
    expect(useWindowStore.getState().getTab(file)?.explorerContext).toEqual({ root: workspace, source: 'locate' });
    expect(useLayoutStore.getState().explorerVisible).toBe(false);
  });

  it.each(['text', 'image', 'unsupported'] as const)('keeps outside %s opens in the workspace until explicit Locate, without changing other tabs', async kind => {
    const workspace = 'C:\\workspace', original = workspace + '\\original.md';
    await openExplorerDirectory(workspace);
    await openDocument(original, { explorerRoot: workspace }); await paint();
    const originalContext = useWindowStore.getState().getTab(original)!.explorerContext;
    const file = `C:\\outside\\a.${kind === 'text' ? 'md' : kind === 'image' ? 'png' : 'pdf'}`;
    if (kind !== 'text') vi.mocked(ipc.prepareDocument).mockResolvedValueOnce({ type: kind, key: file, displayName: file.split('\\').pop()!, dirPath: 'C:\\outside', language: 'plaintext', size: 100, mtime: 0 });
    vi.mocked(ipc.readDir).mockClear();
    await openDocument(file, { explorer: 'parent' }); await paint();
    await followExplorerFile(file, 'C:\\outside', () => true);
    expect(useExplorerStore.getState().root).toBe(workspace);
    expect(useExplorerStore.getState().revealed).toBeNull();
    expect(ipc.readDir).not.toHaveBeenCalled();
    await revealExplorerFile(file, 'C:\\outside');
    expect(useExplorerStore.getState().root).toBe('C:\\outside');
    expect(useWindowStore.getState().getTab(original)!.explorerContext).toBe(originalContext);
    useWindowStore.getState().activateTab(original);
    await followExplorerFile(original, workspace, () => true);
    expect(useExplorerStore.getState().root).toBe(workspace);
    useWindowStore.getState().activateTab(file);
    await followExplorerFile(file, 'C:\\outside', () => true);
    expect(useExplorerStore.getState().root).toBe('C:\\outside');
    expect(useExplorerStore.getState().workspaceRoot).toBe(workspace);
  });

  it('inherits a displayed foreign tree root for nested files, including while a workspace is pinned', async () => {
    const workspace = 'C:\\workspace', external = 'C:\\outside\\a.md', nested = 'C:\\outside\\B\\C\\b.md';
    await openExplorerDirectory(workspace);
    await openDocument(external, { explorer: 'parent' }); await paint();
    await revealExplorerFile(external, 'C:\\outside');
    await openDocument(nested, { explorerRoot: useExplorerStore.getState().root! }); await paint();
    expect(useWindowStore.getState().getTab(nested)?.explorerContext).toEqual({ root: 'C:\\outside', source: 'tree' });
    expect(useExplorerStore.getState().root).toBe('C:\\outside');
    await openDocument(workspace + '\\other.md', { explorer: 'parent' }); await paint();
    useWindowStore.getState().activateTab(nested);
    await followExplorerFile(nested, payload(nested).dirPath, () => true);
    await revealExplorerFile(nested, payload(nested).dirPath);
    expect(useExplorerStore.getState().root).toBe('C:\\outside');
    expect(useExplorerStore.getState().workspaceRoot).toBe(workspace);
    const contexts = useWindowStore.getState().tabs.map(tab => tab.explorerContext);
    await openExplorerDirectory('C:\\another-workspace');
    expect(useWindowStore.getState().tabs.map(tab => tab.explorerContext)).toEqual(contexts);
    contexts.forEach((context, index) => expect(useWindowStore.getState().tabs[index].explorerContext).toBe(context));
  });

  it('keeps tree origin without a workspace and retains it when an external request refocuses the existing tab', async () => {
    const first = 'C:\\A\\a.md', nested = 'C:\\A\\B\\C\\b.md';
    await openDocument(first, { explorer: 'parent' }); await paint();
    await openDocument(nested, { explorerRoot: 'C:\\A' }); await paint();
    const origin = useWindowStore.getState().getTab(nested)!.explorerContext;
    await openDocument('C:\\other\\x.md', { explorer: 'parent' }); await paint();
    vi.mocked(ipc.prepareDocument).mockResolvedValueOnce({ type: 'already-open', key: nested, ownerLabel: 'nb-main', ownerIsSelf: true });
    await openDocument(nested, { explorer: 'parent' }); await paint();
    await revealExplorerFile(nested, payload(nested).dirPath);
    expect(useExplorerStore.getState().root).toBe('C:\\A');
    expect(origin).toEqual({ root: 'C:\\A', source: 'tree' });
    expect(useExplorerStore.getState().workspaceRoot).toBeNull();
  });

  it('captures the tree root before preparation and does not undo a later manual folder choice', async () => {
    const file = 'C:\\A\\B\\b.md', document = deferred<PreparedDocument>();
    useExplorerStore.getState().setRoot('C:\\A', []);
    vi.mocked(ipc.prepareDocument).mockReturnValueOnce(document.promise);
    const opening = openDocument(file, { explorerRoot: 'C:\\A' });
    await openExplorerDirectory('C:\\new-workspace');
    document.resolve({ type: 'text', payload: payload(file) });
    expect(await opening).toBe('opened'); await paint();
    await followExplorerFile(file, payload(file).dirPath, () => true);
    expect(useWindowStore.getState().getTab(file)?.explorerContext).toEqual({ root: 'C:\\A', source: 'tree' });
    expect(useExplorerStore.getState().root).toBe('C:\\new-workspace');
  });

  it('reads a deep tab only along its actual ancestor chain and keeps one root cache across many tabs and closes', async () => {
    const root = 'C:\\deep', file = root + Array.from({ length: 40 }, (_, index) => `\\level-${index}`).join('') + '\\a.md';
    useWindowStore.getState().openTab({ ...buildTabFromPath(file), explorerContext: { root, source: 'tree' } });
    vi.mocked(ipc.readDir).mockImplementation(async path => [directoryNode(path + '\\unvisited-sibling')]);
    await followExplorerFile(file, payload(file).dirPath, () => true);
    expect(vi.mocked(ipc.readDir).mock.calls.map(([path]) => path)).toEqual([root, ...getPathChain(root, file)]);
    expect(useExplorerStore.getState().children.size).toBe(41);
    for (let index = 0; index < 30; index += 1) {
      await openDocument(`C:\\root-${index}\\a.md`, { explorer: 'parent' }); await paint();
      expect(useExplorerStore.getState().children.size).toBe(1);
    }
    useWindowStore.getState().closeAllTabs();
    expect(useWindowStore.getState().tabs).toEqual([]);
    expect(useWindowStore.getState().activeKey).toBeNull();
    await openDocument(file, { explorer: 'parent' }); await paint();
    expect(useWindowStore.getState().getTab(file)?.explorerContext).toEqual({ root: payload(file).dirPath, source: 'parent' });
    expect(useExplorerStore.getState().children.size).toBe(1);
  });

  it('rapid A/B/A activation neither shares the abandoned root read nor lets its stale result win', async () => {
    const a = 'C:\\a\\a.md', b = 'C:\\b\\b.md', oldA = deferred<FileTreeNode[]>(), newA = deferred<FileTreeNode[]>();
    useWindowStore.setState({ tabs: [a, b].map(key => ({ ...buildTabFromPath(key), explorerContext: { root: payload(key).dirPath, source: 'parent' as const } })), activeKey: a });
    vi.mocked(ipc.readDir).mockImplementationOnce(() => oldA.promise).mockResolvedValueOnce([]).mockImplementationOnce(() => newA.promise);
    const first = followExplorerFile(a, 'C:\\a', () => useWindowStore.getState().activeKey === a);
    useWindowStore.getState().activateTab(b);
    await followExplorerFile(b, 'C:\\b', () => useWindowStore.getState().activeKey === b);
    useWindowStore.getState().activateTab(a);
    const last = followExplorerFile(a, 'C:\\a', () => useWindowStore.getState().activeKey === a);
    expect(ipc.readDir).toHaveBeenCalledTimes(3);
    newA.resolve([directoryNode('C:\\a\\fresh')]); await last;
    oldA.resolve([directoryNode('C:\\a\\stale')]); await first;
    expect(useExplorerStore.getState().root).toBe('C:\\a');
    expect(useExplorerStore.getState().getChildren('C:\\a')?.[0].name).toBe('fresh');
    expect(useExplorerStore.getState().children.size).toBe(1);
  });
});

describe('following the active document after a failed or cancelled open', () => {
  it.each(['failed', 'cancelled'] as const)('resumes an interrupted active read after %s in parent, workspace and explicit contexts', async result => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const context of ['parent', 'workspace', 'locate'] as const) {
      useExplorerStore.getState().clear();
      useWindowStore.setState({ tabs: [], activeKey: null });
      useDocumentStore.setState({ documents: new Map() });
      const workspace = 'C:\\workspace', a = context === 'workspace' ? workspace + '\\nested\\a.md' : 'C:\\outside\\a.md';
      if (context !== 'parent') {
        useExplorerStore.getState().setWorkspaceRoot(workspace);
        useExplorerStore.getState().setRoot(workspace, []);
      }
      if (context === 'locate') useWindowStore.getState().openTab({ ...buildTabFromPath(a), explorerContext: { root: 'C:\\outside', source: 'locate' } });
      const directory = deferred<FileTreeNode[]>();
      vi.mocked(ipc.readDir).mockReset().mockReturnValue(directory.promise);
      await openDocument(a, { explorer: 'parent' }); await paint();
      expect(ipc.readDir).toHaveBeenCalledOnce();
      const b = 'C:\\b\\b.md';
      vi.mocked(ipc.prepareDocument).mockResolvedValueOnce(result === 'failed'
        ? { type: 'failed', message: 'access denied', missing: false }
        : { type: 'confirmation-required', key: b, displayName: 'b.md', size: 1024 ** 4 });
      expect(await openDocument(b, { explorer: 'parent' })).toBe(result);
      expect(useWindowStore.getState().activeKey).toBe(a);
      directory.resolve([]); await paint();
      expect(useExplorerStore.getState().root).toBe(context === 'workspace' ? workspace : 'C:\\outside');
      expect(useExplorerStore.getState().revealed).toBe(a);
      expect(useExplorerStore.getState().workspaceRoot).toBe(context === 'parent' ? null : workspace);
      expect(useLayoutStore.getState().explorerVisible).toBe(false);
      expect(ipc.readDir).toHaveBeenCalledOnce();
    }
    error.mockRestore();
  });

  it('keeps the active preserve policy after a failed open', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = useExplorerStore.getState(), a = 'C:\\exports\\a.md';
    store.setRoot('C:\\workspace', []); store.expand('C:\\workspace\\branch', []); store.setRevealed('C:\\workspace\\old.md');
    await openDocument(a, { explorer: 'preserve' });
    vi.mocked(ipc.prepareDocument).mockResolvedValueOnce({ type: 'failed', message: 'access denied', missing: false });
    expect(await openDocument('C:\\b\\b.md', { explorer: 'parent' })).toBe('failed'); await paint();
    expect(useWindowStore.getState().activeKey).toBe(a);
    expect(useExplorerStore.getState().root).toBe('C:\\workspace');
    expect(useExplorerStore.getState().revealed).toBe('C:\\workspace\\old.md');
    expect(store.isExpanded('C:\\workspace\\branch')).toBe(true);
    expect(ipc.readDir).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it('does not restart the old active follow while a newer open is still preparing', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const directory = deferred<FileTreeNode[]>(), b = deferred<PreparedDocument>(), c = deferred<PreparedDocument>();
    vi.mocked(ipc.readDir).mockReturnValueOnce(directory.promise);
    await openDocument('C:\\a\\a.md', { explorer: 'parent' }); await paint();
    vi.mocked(ipc.prepareDocument).mockReturnValueOnce(b.promise);
    const openingB = openDocument('C:\\b\\b.md', { explorer: 'parent' });
    vi.mocked(ipc.prepareDocument).mockReturnValueOnce(c.promise);
    const openingC = openDocument('C:\\c\\c.md', { explorer: 'parent' });
    b.resolve({ type: 'failed', message: 'access denied', missing: false }); await openingB;
    directory.resolve([]); await paint();
    expect(useExplorerStore.getState().root).toBeNull();
    expect(ipc.readDir).toHaveBeenCalledOnce();
    c.resolve({ type: 'text', payload: payload('C:\\c\\c.md') }); await openingC; await paint();
    expect(useExplorerStore.getState().root).toBe('C:\\c');
    expect(useExplorerStore.getState().revealed).toBe('C:\\c\\c.md');
    error.mockRestore();
  });

  it.each(['before', 'after'] as const)('keeps a folder chosen %s the failure when the interrupted directory read finishes', async timing => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const directory = deferred<FileTreeNode[]>(), b = deferred<PreparedDocument>();
    vi.mocked(ipc.readDir).mockReturnValueOnce(directory.promise);
    await openDocument('C:\\a\\a.md', { explorer: 'parent' }); await paint();
    vi.mocked(ipc.prepareDocument).mockReturnValueOnce(b.promise);
    const openingB = openDocument('C:\\b\\b.md', { explorer: 'parent' });
    if (timing === 'before') await openExplorerDirectory('C:\\chosen');
    b.resolve({ type: 'failed', message: 'access denied', missing: false }); await openingB;
    if (timing === 'after') await openExplorerDirectory('C:\\chosen');
    directory.resolve([]); await paint();
    expect(useWindowStore.getState().activeKey).toBe('C:\\a\\a.md');
    expect(useExplorerStore.getState().root).toBe('C:\\chosen');
    expect(useExplorerStore.getState().workspaceRoot).toBe('C:\\chosen');
    expect(useExplorerStore.getState().revealed).toBeNull();
    expect(vi.mocked(ipc.readDir).mock.calls.map(([path]) => path)).toEqual(['C:\\a', 'C:\\chosen']);
    error.mockRestore();
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('external opening follows the direct parent after the document is ready', () => {
  it.each([false, true])('preserves sidebar visibility %s and uses the cached direct parent after paint', async visible => {
    const store = useExplorerStore.getState();
    store.setRoot('C:\\notes', []);
    store.updateChildren('C:\\notes\\project', []);
    useLayoutStore.setState({ explorerVisible: visible });

    expect(await openDocument('C:\\notes\\project\\a.md', { explorer: 'parent' })).toBe('opened');
    expect(useDocumentStore.getState().getDocument('C:\\notes\\project\\a.md')?.content).toBe('# Ready to edit');
    expect(useExplorerStore.getState().root).toBe('C:\\notes');
    expect(ipc.readDir).not.toHaveBeenCalled();
    await paint();
    expect(useExplorerStore.getState().root).toBe('C:\\notes\\project');
    expect(useExplorerStore.getState().revealed).toBe('C:\\notes\\project\\a.md');
    expect(useLayoutStore.getState().explorerVisible).toBe(visible);
    expect(ipc.readDir).not.toHaveBeenCalled();
  });

  it('returns an editable document before a pending directory read settles', async () => {
    const directory = deferred<FileTreeNode[]>();
    vi.mocked(ipc.readDir).mockReturnValue(directory.promise);
    expect(await openDocument('C:\\notes\\a.md', { explorer: 'parent' })).toBe('opened');
    expect(ipc.readDir).not.toHaveBeenCalled();
    await paint();
    expect(ipc.readDir).toHaveBeenCalledOnce();
    expect(useWindowStore.getState().activeKey).toBe('C:\\notes\\a.md');
    expect(useExplorerStore.getState().root).toBeNull();
    const follow = followExplorerFile('C:\\notes\\a.md', 'C:\\notes', () => true);
    directory.resolve([]);
    await follow;
    expect(useExplorerStore.getState().root).toBe('C:\\notes');
  });

  it('a later request invalidates old directory results even while its document is preparing', async () => {
    const oldDirectory = deferred<FileTreeNode[]>();
    const nextDocument = deferred<PreparedDocument>();
    vi.mocked(ipc.readDir).mockImplementation(path => path === 'C:\\a' ? oldDirectory.promise : Promise.resolve([]));
    await openDocument('C:\\a\\a.md', { explorer: 'parent' });
    await paint();
    vi.mocked(ipc.prepareDocument).mockReturnValueOnce(nextDocument.promise);
    const next = openDocument('C:\\b\\b.md', { explorer: 'parent' });
    await followExplorerFile('C:\\a\\a.md', 'C:\\a', () => true);
    oldDirectory.resolve([]);
    await Promise.resolve(); await Promise.resolve();
    expect(useExplorerStore.getState().root).toBeNull();
    nextDocument.resolve({ type: 'text', payload: payload('C:\\b\\b.md') });
    expect(await next).toBe('opened');
    const passiveFollow = followExplorerFile('C:\\b\\b.md', 'C:\\b', () => true);
    await paint(); await passiveFollow;
    expect(useExplorerStore.getState().root).toBe('C:\\b');
    expect(useExplorerStore.getState().revealed).toBe('C:\\b\\b.md');
  });

  it('a directory chosen after opening wins over a pending parent follow-up', async () => {
    await openDocument('C:\\notes\\a.md', { explorer: 'parent' });
    await openExplorerDirectory('D:\\work');
    await paint();
    expect(useExplorerStore.getState().root).toBe('D:\\work');
    expect(ipc.readDir).toHaveBeenCalledExactlyOnceWith('D:\\work', false);
  });

  it('switching to another tab supersedes the pending parent follow-up', async () => {
    await openDocument('C:\\notes\\a.md', { explorer: 'parent' });
    await followExplorerFile('D:\\work\\b.md', 'D:\\work', () => true);
    await paint();
    expect(useExplorerStore.getState().root).toBe('D:\\work');
    expect(useExplorerStore.getState().revealed).toBe('D:\\work\\b.md');
  });

  it('refocuses an already-open local document and follows its parent without replacing dirty content', async () => {
    await openDocument('C:\\notes\\a.md', { explorer: 'parent' });
    await paint();
    useExplorerStore.getState().setRoot('D:\\other', []);
    useDocumentStore.getState().upsertFromPayload({ ...payload('C:\\notes\\a.md'), content: 'unsaved local content' });
    useWindowStore.getState().setTabDirty('C:\\notes\\a.md', true);
    vi.mocked(ipc.prepareDocument).mockResolvedValueOnce({ type: 'already-open', key: 'C:\\notes\\a.md', ownerLabel: 'nb-main', ownerIsSelf: true });
    const registrations = vi.mocked(ipc.registerDocument).mock.calls.length;
    expect(await openDocument('C:\\notes\\a.md', { explorer: 'parent' })).toBe('focused');
    await paint();
    expect(useExplorerStore.getState().root).toBe('C:\\notes');
    expect(useWindowStore.getState().tabs).toHaveLength(1);
    expect(useWindowStore.getState().tabs[0].isDirty).toBe(true);
    expect(useDocumentStore.getState().getDocument('C:\\notes\\a.md')?.content).toBe('unsaved local content');
    expect(ipc.registerDocument).toHaveBeenCalledTimes(registrations);
  });

  it.each(['cli', 'second-instance'] as const)('routes a remote %s request to its owner without directory IO or another relay', async source => {
    const key = 'C:\\notes\\a.md';
    useExplorerStore.getState().setRoot('D:\\source', []);
    vi.mocked(ipc.prepareDocument).mockResolvedValueOnce({ type: 'already-open', key, ownerLabel: 'nb-owner', ownerIsSelf: false });
    expect(await openDocument('C:/notes/a.md', { explorer: 'parent', openRequestSource: source })).toBe('focused');
    expect(ipc.enqueueOpenRequests).toHaveBeenCalledExactlyOnceWith('nb-owner', [key], source);
    expect(emitTo).toHaveBeenCalledExactlyOnceWith('nb-owner', 'nb://open-requests-available', { queueVersion: 7 });
    expect(ipc.focusWindow).toHaveBeenCalledExactlyOnceWith('nb-owner');
    expect(vi.mocked(ipc.enqueueOpenRequests).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(emitTo).mock.invocationCallOrder[0]);
    await paint();
    expect(ipc.readDir).not.toHaveBeenCalled();
    expect(useWindowStore.getState().tabs).toHaveLength(0);
    expect(useExplorerStore.getState().root).toBe('D:\\source');

    // Simulate consuming the durable request in its owner; preparation returns before body IO.
    currentWindow.label = 'nb-owner';
    useWindowStore.setState({ tabs: [{ ...buildTabFromPath(key), isDirty: true }], activeKey: null });
    useDocumentStore.getState().upsertFromPayload({ ...payload(key), content: 'owner unsaved content' });
    useExplorerStore.getState().clear();
    useExplorerStore.getState().setRoot('C:\\', []);
    vi.mocked(ipc.prepareDocument).mockResolvedValueOnce({ type: 'already-open', key, ownerLabel: 'nb-owner', ownerIsSelf: true });
    expect(await openDocument(key, { explorer: 'parent', openRequestSource: source })).toBe('focused');
    expect(ipc.readDir).not.toHaveBeenCalled();
    await paint();
    expect(useExplorerStore.getState().root).toBe('C:\\notes');
    expect(useLayoutStore.getState().explorerVisible).toBe(false);
    expect(useDocumentStore.getState().getDocument(key)?.content).toBe('owner unsaved content');
    expect(useWindowStore.getState().getTab(key)?.isDirty).toBe(true);
    expect(ipc.enqueueOpenRequests).toHaveBeenCalledTimes(1);
    expect(ipc.registerDocument).not.toHaveBeenCalled();
    expect(ipc.prepareDocument).toHaveBeenCalledTimes(2);
  });

  it.each(['text', 'image'] as const)('routes a %s registration race through the same owner queue', async kind => {
    const key = kind === 'image' ? 'C:\\notes\\a.png' : 'C:\\notes\\a.md';
    if (kind === 'image') {
      vi.mocked(ipc.prepareDocument).mockResolvedValueOnce({ type: 'image', key, displayName: 'a.png', dirPath: 'C:\\notes', language: 'plaintext', size: 12, mtime: 0 });
    }
    vi.mocked(ipc.registerDocument).mockResolvedValueOnce({ type: 'already-open', ownerLabel: 'nb-owner' });
    expect(await openDocument(key, { explorer: 'parent', openRequestSource: 'cli' })).toBe('focused');
    expect(ipc.enqueueOpenRequests).toHaveBeenCalledExactlyOnceWith('nb-owner', [key], 'cli');
    await paint();
    expect(ipc.readDir).not.toHaveBeenCalled();
    expect(useWindowStore.getState().tabs).toHaveLength(0);
  });

  it('reports failed delivery instead of claiming the remote open succeeded', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(ipc.prepareDocument).mockResolvedValueOnce({ type: 'already-open', key: 'C:\\notes\\a.md', ownerLabel: 'nb-owner', ownerIsSelf: false });
    vi.mocked(ipc.enqueueOpenRequests).mockRejectedValueOnce(new Error('queue unavailable'));
    expect(await openDocument('C:\\notes\\a.md', { explorer: 'parent', openRequestSource: 'second-instance' })).toBe('failed');
    await paint();
    expect(emitTo).not.toHaveBeenCalled();
    expect(ipc.focusWindow).not.toHaveBeenCalled();
    expect(ipc.readDir).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it('ordinary tree and restored-document opens keep a containing root and its branches', async () => {
    const store = useExplorerStore.getState();
    store.setRoot('C:\\notes', []);
    store.expand('C:\\notes\\other', []);
    store.updateChildren('C:\\notes\\project', []);
    await openDocument('C:\\notes\\project\\a.md');
    expect(useExplorerStore.getState().root).toBe('C:\\notes');
    expect(store.isExpanded('C:\\notes\\other')).toBe(true);
    expect(ipc.readDir).not.toHaveBeenCalled();
  });

  it('directory requests open the directory itself; empty paths perform no IO', async () => {
    expect(await openDocument('   ', { explorer: 'parent' })).toBe('failed');
    expect(ipc.prepareDocument).not.toHaveBeenCalled();
    vi.mocked(ipc.prepareDocument).mockResolvedValueOnce({ type: 'directory', path: 'C:\\notes' });
    expect(await openDocument('C:\\notes', { explorer: 'parent' })).toBe('opened');
    expect(useExplorerStore.getState().root).toBe('C:\\notes');
    expect(useLayoutStore.getState().explorerVisible).toBe(true);
    expect(useWindowStore.getState().tabs).toHaveLength(0);
  });

  it('a parent read failure does not turn a ready document into an open failure', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(ipc.readDir).mockRejectedValueOnce(new Error('unreadable directory'));
    expect(await openDocument('C:\\notes\\a.md', { explorer: 'parent' })).toBe('opened');
    await paint();
    expect(useWindowStore.getState().activeKey).toBe('C:\\notes\\a.md');
    expect(useExplorerStore.getState().root).toBeNull();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
