import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTabFromPath, openDocument } from '../../src/features/editor-code/orchestration/openDocument';
import { followExplorerFile, openExplorerDirectory, revealExplorerFile } from '../../src/features/explorer/explorerActions';
import { useExplorerStore } from '../../src/features/explorer/explorerStore';
import { useDocumentStore } from '../../src/stores/documentStore';
import { useLayoutStore } from '../../src/stores/layoutStore';
import { useWindowStore } from '../../src/stores/windowStore';
import type { DocumentPayload, FileTreeNode, PreparedDocument } from '../../src/core/ipc/types';
import * as ipc from '../../src/core/ipc/commands';
import { emitTo } from '@tauri-apps/api/event';

const currentWindow = vi.hoisted(() => ({ label: 'nb-main' }));

vi.mock('../../src/core/ipc/commands', () => ({
  prepareDocument: vi.fn(), registerDocument: vi.fn(), readDir: vi.fn(),
  pushRecent: vi.fn(), focusWindow: vi.fn(), enqueueOpenRequests: vi.fn(),
}));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => currentWindow }));
vi.mock('@tauri-apps/api/event', () => ({ emitTo: vi.fn(), listen: vi.fn() }));
vi.mock('../../src/features/editor-host/editorLoaders', () => ({ prefetchEditor: vi.fn(), resolveEditorKind: () => 'markdown' }));

const payload = (key: string): DocumentPayload => ({
  key, displayName: key.split('\\').pop()!, dirPath: key.slice(0, key.lastIndexOf('\\')),
  kind: 'markdown', language: 'markdown', content: '# Ready to edit', encoding: 'utf8',
  eol: 'lf', size: 15, mtime: 0, readonly: false,
});

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
  vi.mocked(ipc.readDir).mockResolvedValue([]);
  vi.mocked(ipc.pushRecent).mockResolvedValue(undefined);
  vi.mocked(ipc.focusWindow).mockResolvedValue(undefined);
  vi.mocked(ipc.enqueueOpenRequests).mockResolvedValue(['forward-1', 7]);
  vi.mocked(emitTo).mockResolvedValue(undefined);
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
