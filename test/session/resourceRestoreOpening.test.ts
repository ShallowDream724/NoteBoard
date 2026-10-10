import { beforeEach, expect, it, vi } from 'vitest';
import * as ipc from '@/core/ipc/commands';
import { loadRestoredTab } from '@/features/session/closedWindowSession';
import { useDocumentStore } from '@/stores/documentStore';
import { useWindowStore } from '@/stores/windowStore';

vi.mock('@/core/ipc/commands', () => ({ prepareDocument: vi.fn(), registerDocument: vi.fn(), unregisterDocument: vi.fn().mockResolvedValue(undefined),
  focusWindow: vi.fn().mockResolvedValue(undefined), pushRecent: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ label: 'nb-main' }) }));
vi.mock('@/features/editor-host/editorLoaders', () => ({ resolveEditorKind: () => 'image', prefetchEditor: vi.fn() }));

const key = 'C:\\qa\\image.png';
function seed(path = key, kind: 'image' | 'markdown' = 'image') {
  useDocumentStore.getState().upsertFromPayload({ key: path, displayName: path.split('\\').pop()!, dirPath: 'C:\\qa', kind, language: 'plaintext',
    content: null, encoding: 'utf8', eol: 'lf', readonly: false, size: 0, mtime: 0 }, { placeholder: true });
  useWindowStore.getState().openTab({ key: path, path, displayName: path.split('\\').pop()!, kind, language: 'plaintext', isDirty: false,
    isPreview: false, viewMode: null, externalStatus: null, isDetached: false, lazySource: path });
}
function image() { return { type: 'image' as const, key, displayName: 'image.png', dirPath: 'C:\\qa', language: 'plaintext', size: 512, mtime: 123 }; }
function gate<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(ipc.pushRecent).mockResolvedValue(undefined);
  vi.mocked(ipc.unregisterDocument).mockResolvedValue(undefined);
  vi.mocked(ipc.focusWindow).mockResolvedValue(undefined);
  vi.mocked(ipc.registerDocument).mockResolvedValue({ type: 'ok' });
  vi.mocked(ipc.prepareDocument).mockResolvedValue(image());
  useDocumentStore.setState({ documents: new Map() }); useWindowStore.setState({ tabs: [], activeKey: null, transferringKeys: [] });
});

it('waits for native ownership before delivering an image and keeps a newer active tab focused', async () => {
  seed(); const registration = gate<Awaited<ReturnType<typeof ipc.registerDocument>>>();
  vi.mocked(ipc.registerDocument).mockReturnValue(registration.promise);
  const loading = loadRestoredTab(key);
  await vi.waitFor(() => expect(ipc.registerDocument).toHaveBeenCalled());
  expect(useDocumentStore.getState().getDocument(key)?.loadState).toBe('placeholder');
  seed('C:\\qa\\other.png'); registration.resolve({ type: 'ok' });
  expect(await loading).toBe('loaded');
  expect(useDocumentStore.getState().getDocument(key)).toMatchObject({ loadState: 'loaded', content: null, readonly: true });
  expect(useWindowStore.getState().activeKey).toBe('C:\\qa\\other.png');
});

it('does not clear the local placeholder when registration races with another owning window', async () => {
  seed(); vi.mocked(ipc.registerDocument).mockResolvedValue({ type: 'already-open', ownerLabel: 'nb-other' });
  expect(await loadRestoredTab(key)).toBe('stale');
  expect(useDocumentStore.getState().getDocument(key)?.loadState).toBe('placeholder');
  expect(useWindowStore.getState().getTab(key)?.lazySource).toBe(key);
  expect(ipc.focusWindow).not.toHaveBeenCalled();
});

it.each(['image', 'markdown'] as const)('does not resurrect a closed %s tab when preparation completes', async kind => {
  const path = kind === 'image' ? key : 'C:\\qa\\text.md'; seed(path, kind);
  const preparation = gate<Awaited<ReturnType<typeof ipc.prepareDocument>>>();
  vi.mocked(ipc.prepareDocument).mockReturnValue(preparation.promise);
  const loading = loadRestoredTab(path);
  useWindowStore.setState({ tabs: [], activeKey: null }); useDocumentStore.getState().remove(path);
  preparation.resolve(kind === 'image' ? image() : { type: 'text', payload: { key: path, displayName: 'text.md', dirPath: 'C:\\qa', kind: 'markdown', language: 'markdown', content: 'old', encoding: 'utf8', eol: 'lf', readonly: false, size: 3, mtime: 1 } });
  expect(await loading).toBe('stale'); expect(useWindowStore.getState().tabs).toEqual([]);
  expect(useDocumentStore.getState().documents.size).toBe(0); expect(ipc.registerDocument).not.toHaveBeenCalled();
});

it('releases newly registered ownership if a loading tab closes and does not recreate it', async () => {
  seed(); const registration = gate<Awaited<ReturnType<typeof ipc.registerDocument>>>();
  vi.mocked(ipc.registerDocument).mockReturnValue(registration.promise);
  const loading = loadRestoredTab(key); await vi.waitFor(() => expect(ipc.registerDocument).toHaveBeenCalled());
  useWindowStore.setState({ tabs: [], activeKey: null }); useDocumentStore.getState().remove(key);
  registration.resolve({ type: 'ok' }); expect(await loading).toBe('stale');
  expect(ipc.unregisterDocument).toHaveBeenCalledWith('nb-main', key);
  expect(useWindowStore.getState().tabs).toEqual([]); expect(useDocumentStore.getState().documents.size).toBe(0);
});

it('allows a new restoration generation without sharing or clearing the old generation\'s pending promise', async () => {
  seed(); const preparation = gate<Awaited<ReturnType<typeof ipc.prepareDocument>>>();
  vi.mocked(ipc.prepareDocument).mockReturnValueOnce(preparation.promise);
  const old = loadRestoredTab(key);
  useWindowStore.setState({ tabs: [], activeKey: null }); useDocumentStore.getState().remove(key); seed();
  const fresh = loadRestoredTab(key); preparation.resolve(image());
  expect(await old).toBe('stale'); expect(await fresh).toBe('loaded');
  expect(useDocumentStore.getState().getDocument(key)?.loadState).toBe('loaded');
  expect(useWindowStore.getState().getTab(key)?.lazySource).toBeUndefined();
  expect(ipc.registerDocument).toHaveBeenCalledTimes(1);
});

it('serializes a same-path reopen behind expired native registration and releases the old claim before preparing the new generation', async () => {
  seed(); const registration = gate<Awaited<ReturnType<typeof ipc.registerDocument>>>(); let owned = false;
  vi.mocked(ipc.prepareDocument).mockImplementation(async () => owned ? { type: 'already-open', key, ownerLabel: 'nb-main', ownerIsSelf: true } : image());
  vi.mocked(ipc.registerDocument).mockImplementationOnce(async () => { const result = await registration.promise; owned = true; return result; });
  vi.mocked(ipc.unregisterDocument).mockImplementation(async () => { owned = false; });
  const old = loadRestoredTab(key); await vi.waitFor(() => expect(ipc.registerDocument).toHaveBeenCalledTimes(1));
  useWindowStore.setState({ tabs: [], activeKey: null }); useDocumentStore.getState().remove(key); seed();
  const fresh = loadRestoredTab(key); await Promise.resolve();
  expect(ipc.prepareDocument).toHaveBeenCalledTimes(1);
  registration.resolve({ type: 'ok' }); expect(await old).toBe('stale'); expect(await fresh).toBe('loaded');
  expect(ipc.unregisterDocument).toHaveBeenCalledTimes(1); expect(ipc.prepareDocument).toHaveBeenCalledTimes(2);
  expect(useDocumentStore.getState().getDocument(key)?.loadState).toBe('loaded');
  expect(useWindowStore.getState().getTab(key)?.lazySource).toBeUndefined();
});

it('keeps an image retryable after registration fails', async () => {
  seed(); vi.mocked(ipc.registerDocument).mockRejectedValueOnce(new Error('ownership IPC unavailable'));
  expect(await loadRestoredTab(key)).toBe('failed');
  expect(useDocumentStore.getState().getDocument(key)?.loadState).toBe('placeholder');
  expect(await loadRestoredTab(key)).toBe('loaded');
});
