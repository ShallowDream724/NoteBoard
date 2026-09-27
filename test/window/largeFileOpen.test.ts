import { beforeEach, expect, it, vi } from 'vitest';
import { confirm } from '@tauri-apps/plugin-dialog';
import * as ipc from '../../src/core/ipc/commands';
import { openDocument } from '../../src/features/editor-code/orchestration/openDocument';
import { useSettingsStore } from '../../src/stores/settingsStore';
import { useWindowStore } from '../../src/stores/windowStore';
import { useDocumentStore } from '../../src/stores/documentStore';
import { confirmLargeFile } from '../../src/core/files/largeFilePolicy';

vi.mock('@tauri-apps/plugin-dialog', () => ({ confirm: vi.fn() }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ label: 'nb-main' }) }));
vi.mock('../../src/core/ipc/commands', () => ({ prepareDocument: vi.fn(), registerDocument: vi.fn(), pushRecent: vi.fn().mockResolvedValue(undefined), focusWindow: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../src/features/editor-host/editorLoaders', () => ({ prefetchEditor: vi.fn(), resolveEditorKind: () => 'unsupported' }));
const mib = 1024 * 1024;
const path = 'C:/large.png';

beforeEach(() => {
  vi.clearAllMocks();
  useWindowStore.setState({ tabs: [], activeKey: null });
  useDocumentStore.setState({ documents: new Map() });
  const settings = useSettingsStore.getState().settings;
  useSettingsStore.setState({ settings: { ...settings, file: { ...settings.file, largeFileConfirmMb: 50 } } });
});

it('cancels an oversized image before prepare can return its content or create a tab', async () => {
  vi.mocked(ipc.prepareDocument).mockResolvedValue({ type: 'confirmation-required', key: path, displayName: 'large.png', size: 60 * mib });
  vi.mocked(confirm).mockResolvedValue(false);
  expect(await openDocument(path)).toBe('cancelled');
  expect(ipc.prepareDocument).toHaveBeenCalledExactlyOnceWith('nb-main', path, 50 * mib);
  expect(ipc.registerDocument).not.toHaveBeenCalled();
  expect(useDocumentStore.getState().documents.size).toBe(0);
  expect(useWindowStore.getState().tabs).toHaveLength(0);
});

it('approves only the observed size and asks again if the file grows', async () => {
  vi.mocked(ipc.prepareDocument)
    .mockResolvedValueOnce({ type: 'confirmation-required', key: path, displayName: 'large.png', size: 60 * mib })
    .mockResolvedValueOnce({ type: 'confirmation-required', key: path, displayName: 'large.png', size: 70 * mib })
    .mockResolvedValueOnce({ type: 'image', key: path, displayName: 'large.png', dirPath: '', language: 'plaintext', size: 70 * mib, mtime: 1 });
  vi.mocked(confirm).mockResolvedValue(true);
  vi.mocked(ipc.registerDocument).mockResolvedValue({ type: 'ok' });
  expect(await openDocument(path)).toBe('opened');
  expect(vi.mocked(ipc.prepareDocument).mock.calls.map(call => call[2])).toEqual([50 * mib, 60 * mib, 70 * mib]);
  expect(confirm).toHaveBeenCalledTimes(2);
  expect(useDocumentStore.getState().getDocument(path)?.content).toBeNull();
});

it('shares the configured threshold with image imports, including its exact boundary', async () => {
  const settings = useSettingsStore.getState().settings;
  useSettingsStore.setState({ settings: { ...settings, file: { ...settings.file, largeFileConfirmMb: 3 } } });
  expect(await confirmLargeFile('image.png', 3 * mib)).toBe(true);
  expect(confirm).not.toHaveBeenCalled();
  vi.mocked(confirm).mockResolvedValue(false);
  expect(await confirmLargeFile('image.png', 3 * mib + 1)).toBe(false);
});
