import { beforeEach, expect, it, vi } from 'vitest';
import { confirm } from '@tauri-apps/plugin-dialog';
import * as ipc from '@/core/ipc/commands';
import type { PreparedDocument } from '@/core/ipc/types';
import { buildTabFromPath, openDocument, openDocumentWithEncoding } from '@/features/editor-code/orchestration/openDocument';
import { loadRestoredTab } from '@/features/session/closedWindowSession';
import { useDocumentStore } from '@/stores/documentStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useWindowStore } from '@/stores/windowStore';

vi.mock('@tauri-apps/plugin-dialog', () => ({ confirm: vi.fn() }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ label: 'nb-main' }) }));
vi.mock('@/core/ipc/commands', () => ({ prepareDocument: vi.fn(), registerDocument: vi.fn(), unregisterDocument: vi.fn(), pushRecent: vi.fn() }));
vi.mock('@/features/editor-host/editorLoaders', () => ({ resolveEditorKind: () => 'markdown', prefetchEditor: vi.fn() }));

const key = 'C:\\qa\\notes.md';
const otherKey = 'C:\\qa\\other.md';
const mib = 1024 * 1024;
const unsupported = { type: 'unsupported', key, displayName: 'notes.md', dirPath: 'C:\\qa', language: 'plaintext', size: 3 } as const;
const text: PreparedDocument = {
  type: 'text', payload: {
    key, displayName: 'notes.md', dirPath: 'C:\\qa', kind: 'markdown', language: 'markdown', content: '测试',
    encoding: 'gb18030', eol: 'lf', readonly: false, size: 4, mtime: 2,
  },
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(ipc.prepareDocument).mockResolvedValueOnce({ ...unsupported, encodingRequired: true });
  vi.mocked(ipc.registerDocument).mockResolvedValue({ type: 'ok' });
  vi.mocked(ipc.unregisterDocument).mockResolvedValue(undefined);
  vi.mocked(ipc.pushRecent).mockResolvedValue(undefined);
  const settings = useSettingsStore.getState().settings;
  useSettingsStore.setState({ settings: { ...settings, file: { ...settings.file, largeFileConfirmMb: 50 } } });
  useWindowStore.setState({ tabs: [], activeKey: null });
  useDocumentStore.setState({ documents: new Map() });
});

it.each([
  ['text screening', unsupported],
  ['strict decoding', { ...unsupported, encodingRequired: true, encodingMessage: '无法按 UTF-8 解码' }],
] as const)('allows the same tab to retry a different decoder after %s rejects a choice', async (_, rejected) => {
  vi.mocked(ipc.prepareDocument).mockResolvedValueOnce(rejected).mockResolvedValueOnce(text);
  expect(await openDocument(key, { explorer: 'preserve' })).toBe('opened');
  expect(useWindowStore.getState().getTab(key)).toMatchObject({ kind: 'unsupported', encodingRequired: true });
  expect(useDocumentStore.getState().getDocument(key)?.content).toBeNull();
  await openDocumentWithEncoding(key, 'utf8');
  expect(useWindowStore.getState().getTab(key)?.encodingRequired).toBe(true);
  expect(ipc.registerDocument).not.toHaveBeenCalled();

  const opening = openDocumentWithEncoding(key, 'gb18030');
  useWindowStore.getState().openTab(buildTabFromPath(otherKey));
  expect(await opening).toBe('opened');
  expect(useWindowStore.getState().tabs.map(tab => tab.key)).toEqual([key, otherKey]);
  expect(useWindowStore.getState().activeKey).toBe(otherKey);
  expect(useWindowStore.getState().getTab(key)?.kind).toBe('markdown');
  expect(useWindowStore.getState().getTab(key)?.encodingRequired).toBeUndefined();
  expect(useDocumentStore.getState().getDocument(key)).toMatchObject({ content: '测试', encodingOverride: 'gb18030' });
  expect(ipc.registerDocument).toHaveBeenCalledExactlyOnceWith('nb-main', key, 'markdown');
});

it('requires approval again when an explicitly decoded file grows above the observed size', async () => {
  vi.mocked(ipc.prepareDocument)
    .mockResolvedValueOnce({ type: 'confirmation-required', key, displayName: 'notes.md', size: 60 * mib })
    .mockResolvedValueOnce({ type: 'confirmation-required', key, displayName: 'notes.md', size: 70 * mib });
  vi.mocked(confirm).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  await openDocument(key, { explorer: 'preserve' });
  expect(await openDocumentWithEncoding(key, 'gb18030')).toBe('cancelled');
  expect(vi.mocked(ipc.prepareDocument).mock.calls.slice(1)).toEqual([
    ['nb-main', key, 50 * mib, 'gb18030'], ['nb-main', key, 60 * mib, 'gb18030'],
  ]);
  expect(ipc.registerDocument).not.toHaveBeenCalled();
  expect(useWindowStore.getState().getTab(key)?.encodingRequired).toBe(true);
});

it('leaves binary files in the system-app handoff', async () => {
  vi.mocked(ipc.prepareDocument).mockReset().mockResolvedValueOnce(unsupported);
  await openDocument(key, { explorer: 'preserve' });
  expect(useWindowStore.getState().getTab(key)?.encodingRequired).toBeUndefined();
  expect(await openDocumentWithEncoding(key, 'gb18030')).toBe('cancelled');
  expect(ipc.prepareDocument).toHaveBeenCalledTimes(1);
});

it('offers a new encoding when a restored tab cannot decode with its saved choice', async () => {
  useDocumentStore.getState().upsertFromPayload({ ...text.payload, content: null, encoding: 'utf8' }, {
    placeholder: true, encodingOverride: 'utf8',
  });
  useWindowStore.getState().openTab({ ...buildTabFromPath(key), lazySource: key, viewMode: 'source' });

  expect(await loadRestoredTab(key)).toBe('loaded');
  expect(ipc.prepareDocument).toHaveBeenCalledExactlyOnceWith('nb-main', key, 50 * mib, 'utf8');
  expect(useWindowStore.getState().getTab(key)).toMatchObject({ kind: 'unsupported', encodingRequired: true });
  expect(useWindowStore.getState().getTab(key)?.lazySource).toBeUndefined();

  vi.mocked(ipc.prepareDocument).mockResolvedValueOnce(text);
  expect(await openDocumentWithEncoding(key, 'gb18030')).toBe('opened');
  expect(useWindowStore.getState().getTab(key)).toMatchObject({ kind: 'markdown', viewMode: 'source' });
});

it('does not revive a closed candidate when native registration completes', async () => {
  vi.mocked(ipc.prepareDocument).mockResolvedValueOnce(text);
  let completeRegistration!: (result: Awaited<ReturnType<typeof ipc.registerDocument>>) => void;
  vi.mocked(ipc.registerDocument).mockReturnValueOnce(new Promise(resolve => { completeRegistration = resolve; }));
  await openDocument(key, { explorer: 'preserve' });
  const opening = openDocumentWithEncoding(key, 'gb18030');
  await vi.waitFor(() => expect(ipc.registerDocument).toHaveBeenCalled());
  useWindowStore.getState().closeTab(key);
  completeRegistration({ type: 'ok' });
  expect(await opening).toBe('cancelled');
  expect(useWindowStore.getState().getTab(key)).toBeNull();
  expect(useDocumentStore.getState().getDocument(key)).toBeUndefined();
  expect(ipc.unregisterDocument).toHaveBeenLastCalledWith('nb-main', key);
});
