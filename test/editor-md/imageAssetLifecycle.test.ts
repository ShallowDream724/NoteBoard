import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  docs: new Map<string, { key: string; dirPath: string; kind: string; content: string }>(),
  policy: 'trash', generation: 1,
  save: vi.fn(), recycle: vi.fn(), restore: vi.fn(), toast: vi.fn(),
  listeners: new Map<string, (payload: any) => void>(),
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
vi.mock('../../src/core/emitter', () => ({
  emit: (event: string, payload: unknown) => mock.listeners.get(event)?.(payload),
  on: (event: string, handler: (payload: any) => void) => mock.listeners.set(event, handler),
  off: (event: string) => mock.listeners.delete(event),
}));
vi.mock('../../src/stores/toastStore', () => ({ showToast: mock.toast }));

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  mock.docs.clear();
  mock.listeners.clear();
  mock.docs.set('C:\\notes\\a.md', { key: 'C:\\notes\\a.md', dirPath: 'C:\\notes', kind: 'markdown', content: '正文' });
  mock.policy = 'trash'; mock.generation = 1;
  mock.save.mockResolvedValue(true);
  mock.recycle.mockResolvedValue({ ticket: 'receipt', path: 'C:\\notes\\img\\a.png' });
  mock.restore.mockResolvedValue(undefined);
});
const removed = new Set(['img/a.png']);
const empty = new Set<string>();
async function settle() { await vi.dynamicImportSettled(); await new Promise((resolve) => setTimeout(resolve, 0)); }
function saved(key = 'C:\\notes\\a.md') {
  mock.listeners.get('document-saved')?.({ key, generation: mock.generation });
}

describe('图片删除协调', () => {
  it('恢复失败保留回收凭据；重做不重复回收，再次撤销可以重试', async () => {
    mock.restore.mockRejectedValueOnce(new Error('文件被占用')).mockResolvedValue(undefined);
    const { reconcileImageAssets } = await import('../../src/features/editor-md/imageAssetLifecycle');
    let referenced = false;
    const reconcile = () => reconcileImageAssets('C:\\notes\\a.md', referenced ? empty : removed, referenced ? removed : empty, () => referenced);
    reconcile(); await settle(); saved();
    await vi.waitFor(() => expect(mock.recycle).toHaveBeenCalledTimes(1));
    referenced = true; reconcile();
    await vi.waitFor(() => expect(mock.restore).toHaveBeenCalledTimes(1));
    expect(mock.toast).toHaveBeenCalled();
    referenced = false; reconcile(); await settle(); saved(); await settle();
    expect(mock.recycle).toHaveBeenCalledTimes(1);
    referenced = true; reconcile();
    await vi.waitFor(() => expect(mock.restore).toHaveBeenCalledTimes(2));
    expect(mock.restore).toHaveBeenLastCalledWith('receipt');
  });
  it('不代为保存；收到正常保存成功事件才回收，撤销在途删除恢复一次', async () => {
    let finish!: (receipt: { ticket: string }) => void;
    mock.recycle.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const { reconcileImageAssets } = await import('../../src/features/editor-md/imageAssetLifecycle');
    let referenced = false;
    reconcileImageAssets('C:\\notes\\a.md', removed, empty, () => referenced);
    await settle();
    expect(mock.save).not.toHaveBeenCalled();
    expect(mock.recycle).not.toHaveBeenCalled();
    saved();
    await vi.waitFor(() => expect(mock.recycle).toHaveBeenCalledTimes(1));
    referenced = true;
    reconcileImageAssets('C:\\notes\\a.md', empty, removed, () => referenced);
    finish({ ticket: 'receipt' });
    await vi.waitFor(() => expect(mock.restore).toHaveBeenCalledTimes(1));
    await settle();
    expect(mock.restore).toHaveBeenCalledWith('receipt');
    expect(mock.restore).toHaveBeenCalledTimes(1);
  });
  it('没有成功保存事件（未保存/保存失败）不会删除，其他文档保存也不触发', async () => {
    const { reconcileImageAssets } = await import('../../src/features/editor-md/imageAssetLifecycle');
    reconcileImageAssets('C:\\notes\\a.md', removed, empty, () => false);
    await settle();
    saved('C:\\notes\\b.md');
    await settle();
    expect(mock.save).not.toHaveBeenCalled();
    expect(mock.recycle).not.toHaveBeenCalled();
  });
  it('关闭并重开同路径文档会取消旧会话的清理', async () => {
    const { reconcileImageAssets } = await import('../../src/features/editor-md/imageAssetLifecycle');
    reconcileImageAssets('C:\\notes\\a.md', removed, empty, () => false);
    await settle();
    mock.listeners.get('document-session-ended')?.({ key: 'C:\\notes\\a.md' });
    mock.generation++;
    saved();
    await settle();
    expect(mock.recycle).not.toHaveBeenCalled();
  });
  it('其他打开文档仍引用图片时保留文件', async () => {
    mock.docs.set('C:\\notes\\b.md', { key: 'C:\\notes\\b.md', dirPath: 'C:\\notes', kind: 'markdown', content: '![共享](img/a.png)' });
    const { reconcileImageAssets } = await import('../../src/features/editor-md/imageAssetLifecycle');
    reconcileImageAssets('C:\\notes\\a.md', removed, empty, () => false);
    await settle();
    saved();
    await settle();
    expect(mock.recycle).not.toHaveBeenCalled();
    expect(mock.toast).toHaveBeenCalled();
  });
  it('保存前撤销保留文件，重新删除需要等待下一次保存', async () => {
    const { reconcileImageAssets } = await import('../../src/features/editor-md/imageAssetLifecycle');
    let referenced = false;
    reconcileImageAssets('C:\\notes\\a.md', removed, empty, () => referenced);
    await settle();
    referenced = true;
    reconcileImageAssets('C:\\notes\\a.md', empty, removed, () => referenced);
    saved();
    await settle();
    expect(mock.recycle).not.toHaveBeenCalled();
    referenced = false;
    reconcileImageAssets('C:\\notes\\a.md', removed, empty, () => referenced);
    await settle();
    expect(mock.recycle).not.toHaveBeenCalled();
    saved();
    await vi.waitFor(() => expect(mock.recycle).toHaveBeenCalledTimes(1));
  });
});
