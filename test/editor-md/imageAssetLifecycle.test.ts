import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  docs: new Map<string, { key: string; dirPath: string; kind: string; content: string }>(),
  policy: 'trash', generation: 1,
  save: vi.fn(), recycle: vi.fn(), restore: vi.fn(), toast: vi.fn(),
}));
vi.mock('../../src/stores/documentStore', () => ({
  useDocumentStore: { getState: () => ({ documents: mock.docs, getDocument: (key: string) => mock.docs.get(key) }) },
}));
vi.mock('../../src/stores/settingsStore', () => ({
  useSettingsStore: { getState: () => ({ settings: { file: { imageDirName: 'img', imageDeletionPolicy: mock.policy } } }) },
}));
vi.mock('../../src/features/explorer/explorerStore', () => ({
  useExplorerStore: { getState: () => ({ root: 'C:\\notes' }) },
}));
vi.mock('../../src/features/editor-md/linkHandler', () => ({
  resolveRelativeDocPath: (base: string, src: string) => base + '\\' + src.replaceAll('/', '\\'),
}));
vi.mock('../../src/features/session/documentSession', () => ({ getSessionGeneration: () => mock.generation }));
vi.mock('../../src/features/editor-code/orchestration/saveDocument', () => ({ saveDocument: mock.save }));
vi.mock('../../src/features/editor-code/orchestration/syncDocumentContent', () => ({
  syncDocumentContent: async (key: string) => mock.docs.get(key),
}));
vi.mock('../../src/core/ipc/commands', () => ({
  recycleDocumentImage: mock.recycle, restoreDocumentImage: mock.restore,
}));
vi.mock('../../src/features/explorer/refreshAfterWrite', () => ({ refreshExplorerAfterWrite: async () => {} }));
vi.mock('../../src/core/emitter', () => ({ emit: vi.fn() }));
vi.mock('../../src/stores/toastStore', () => ({ showToast: mock.toast }));

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  mock.docs.clear();
  mock.docs.set('C:\\notes\\a.md', { key: 'C:\\notes\\a.md', dirPath: 'C:\\notes', kind: 'markdown', content: '正文' });
  mock.policy = 'trash'; mock.generation = 1;
  mock.save.mockResolvedValue(true);
  mock.recycle.mockResolvedValue({ ticket: 'receipt', path: 'C:\\notes\\img\\a.png' });
  mock.restore.mockResolvedValue(undefined);
});
const removed = new Set(['img/a.png']);
const empty = new Set<string>();
async function settle() { await vi.dynamicImportSettled(); await new Promise((resolve) => setTimeout(resolve, 0)); }

describe('图片删除协调', () => {
  it('保存成功后才回收；删除进行中的撤销会恢复同一个文件一次', async () => {
    let finish!: (receipt: { ticket: string }) => void;
    mock.recycle.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const { reconcileImageAssets } = await import('../../src/features/editor-md/imageAssetLifecycle');
    let referenced = false;
    reconcileImageAssets('C:\\notes\\a.md', removed, empty, () => referenced);
    await vi.waitFor(() => expect(mock.recycle).toHaveBeenCalledTimes(1));
    expect(mock.save.mock.invocationCallOrder[0]).toBeLessThan(mock.recycle.mock.invocationCallOrder[0]);
    referenced = true;
    reconcileImageAssets('C:\\notes\\a.md', empty, removed, () => referenced);
    finish({ ticket: 'receipt' });
    await vi.waitFor(() => expect(mock.restore).toHaveBeenCalledTimes(1));
    await settle();
    expect(mock.restore).toHaveBeenCalledWith('receipt');
    expect(mock.restore).toHaveBeenCalledTimes(1);
  });
  it('保存失败不会删除文件', async () => {
    mock.save.mockResolvedValue(false);
    const { reconcileImageAssets } = await import('../../src/features/editor-md/imageAssetLifecycle');
    reconcileImageAssets('C:\\notes\\a.md', removed, empty, () => false);
    await settle();
    expect(mock.save).toHaveBeenCalled();
    expect(mock.recycle).not.toHaveBeenCalled();
  });
  it('关闭并重开同路径文档会取消旧会话的清理', async () => {
    mock.save.mockImplementation(async () => { mock.generation++; return true; });
    const { reconcileImageAssets } = await import('../../src/features/editor-md/imageAssetLifecycle');
    reconcileImageAssets('C:\\notes\\a.md', removed, empty, () => false);
    await settle();
    expect(mock.save).toHaveBeenCalled();
    expect(mock.recycle).not.toHaveBeenCalled();
  });
  it('其他打开文档仍引用图片时保留文件', async () => {
    mock.docs.set('C:\\notes\\b.md', { key: 'C:\\notes\\b.md', dirPath: 'C:\\notes', kind: 'markdown', content: '![共享](img/a.png)' });
    const { reconcileImageAssets } = await import('../../src/features/editor-md/imageAssetLifecycle');
    reconcileImageAssets('C:\\notes\\a.md', removed, empty, () => false);
    await settle();
    expect(mock.recycle).not.toHaveBeenCalled();
    expect(mock.toast).toHaveBeenCalled();
  });
});
