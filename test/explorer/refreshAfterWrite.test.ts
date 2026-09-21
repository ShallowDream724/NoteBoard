import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useExplorerStore } from '../../src/features/explorer/explorerStore';
import { refreshExplorerAfterWrite } from '../../src/features/explorer/refreshAfterWrite';
import { readDir } from '../../src/core/ipc/commands';
vi.mock('../../src/core/ipc/commands', () => ({ readDir: vi.fn() }));
beforeEach(() => {
  vi.resetAllMocks();
  useExplorerStore.getState().setRoot('C:\\notes', []);
});
describe('图片写入后的目录更新', () => {
  it('新建 img 和已经展开的 img 都会获取新内容', async () => {
    vi.mocked(readDir).mockResolvedValue([]);
    await refreshExplorerAfterWrite('C:/notes/img/new.png');
    expect(readDir).toHaveBeenCalledWith('C:\\notes', false);
    expect(readDir).toHaveBeenCalledWith('C:\\notes\\img', false);
    expect(useExplorerStore.getState().children.has('c:\\notes\\img')).toBe(true);
  });
  it('切换根目录后旧刷新不污染新目录', async () => {
    let finish: (value: []) => void = () => {};
    vi.mocked(readDir).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const task = refreshExplorerAfterWrite('C:\\notes\\new.png');
    useExplorerStore.getState().setRoot('D:\\other', []);
    finish([]);
    await task;
    expect([...useExplorerStore.getState().children.keys()]).toEqual(['d:\\other']);
  });
  it('读取期间的新写入会触发后续读取，避免遗漏连续粘贴', async () => {
    let finish: (value: []) => void = () => {};
    vi.mocked(readDir).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
      .mockResolvedValue([]);
    const first = refreshExplorerAfterWrite('C:\\notes\\one.png');
    const second = refreshExplorerAfterWrite('C:\\notes\\two.png');
    finish([]);
    await Promise.all([first, second]);
    expect(readDir).toHaveBeenCalledTimes(2);
  });
  it('刷新失败不否定写入，目录外图片不增加监听或缓存', async () => {
    vi.mocked(readDir).mockRejectedValue(new Error('not found'));
    await expect(refreshExplorerAfterWrite('C:\\notes\\img\\x.png')).resolves.toBeUndefined();
    vi.mocked(readDir).mockClear();
    await refreshExplorerAfterWrite('D:\\private\\x.png');
    expect(readDir).not.toHaveBeenCalled();
  });
});
