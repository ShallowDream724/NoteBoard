// NoteBoard 更新 Store 单元测试
// 验证静默检查、主动检查、红点标记以及弹窗开关状态

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useUpdateStore } from '../../src/stores/updateStore';
import * as ipc from '../../src/core/ipc/commands';
import { onUpdateNoticeDismissed } from '../../src/core/ipc/events';

vi.mock('../../src/core/ipc/events', () => ({ onUpdateNoticeDismissed: vi.fn() }));

// Mock ipc 命令模块
vi.mock('../../src/core/ipc/commands', () => ({
  checkForUpdates: vi.fn(),
  downloadAndInstallUpdate: vi.fn(),
  openExternalUrl: vi.fn(),
  getDismissedUpdateNotices: vi.fn(),
  dismissUpdateNotice: vi.fn(),
}));

describe('useUpdateStore 状态管理与检查逻辑', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(onUpdateNoticeDismissed).mockResolvedValue(() => {});
    vi.mocked(ipc.getDismissedUpdateNotices).mockResolvedValue([]);
    vi.mocked(ipc.dismissUpdateNotice).mockResolvedValue();
    useUpdateStore.setState({
      checking: false,
      hasUpdate: false,
      updateResult: null,
      checkError: null,
      modalOpen: false,
      noticeReady: false,
      dismissedNoticeVersions: [],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('主动检查更新：发现新版本时应打开弹窗并标记 hasUpdate = true', async () => {
    vi.mocked(ipc.checkForUpdates).mockResolvedValueOnce({
      currentVersion: '0.1.0',
      latestVersion: '0.2.0',
      updateAvailable: true,
      releaseUrl: 'https://github.com/CrazyFigure/NoteBoard/releases',
    });

    const promise = useUpdateStore.getState().checkForUpdates(false);
    expect(useUpdateStore.getState().modalOpen).toBe(true);
    expect(useUpdateStore.getState().checking).toBe(true);

    await promise;

    const state = useUpdateStore.getState();
    expect(state.checking).toBe(false);
    expect(state.hasUpdate).toBe(true);
    expect(state.updateResult?.latestVersion).toBe('0.2.0');
    expect(state.checkError).toBeNull();
  });

  it('静默检查更新：发现新版本时只标记 hasUpdate = true，不主动弹窗', async () => {
    vi.mocked(ipc.checkForUpdates).mockResolvedValueOnce({
      currentVersion: '0.1.0',
      latestVersion: '0.2.0',
      updateAvailable: true,
      releaseUrl: 'https://github.com/CrazyFigure/NoteBoard/releases',
    });

    await useUpdateStore.getState().checkForUpdates(true);

    const state = useUpdateStore.getState();
    expect(state.modalOpen).toBe(false);
    expect(state.hasUpdate).toBe(true);
    expect(state.updateResult?.latestVersion).toBe('0.2.0');
  });

  it('静默检查更新：无新版本时 hasUpdate 应为 false 且不弹窗', async () => {
    vi.mocked(ipc.checkForUpdates).mockResolvedValueOnce({
      currentVersion: '0.1.0',
      latestVersion: '0.1.0',
      updateAvailable: false,
      releaseUrl: 'https://github.com/CrazyFigure/NoteBoard/releases',
    });

    await useUpdateStore.getState().checkForUpdates(true);

    const state = useUpdateStore.getState();
    expect(state.modalOpen).toBe(false);
    expect(state.hasUpdate).toBe(false);
  });

  it('主动检查失败：应记录错误提示并展示在弹窗中', async () => {
    vi.mocked(ipc.checkForUpdates).mockRejectedValueOnce(
      new Error('update_error:network:Connection timed out')
    );

    await useUpdateStore.getState().checkForUpdates(false);

    const state = useUpdateStore.getState();
    expect(state.modalOpen).toBe(true);
    expect(state.checking).toBe(false);
    expect(state.checkError).toContain('无法连接 GitHub');
  });

  it('openModal 与 closeModal 能正常切换弹窗显示状态', () => {
    const { openModal, closeModal } = useUpdateStore.getState();
    openModal();
    expect(useUpdateStore.getState().modalOpen).toBe(true);
    closeModal();
    expect(useUpdateStore.getState().modalOpen).toBe(false);
  });

  it('主动检查可以加入正在进行的自动检查并显示结果，不重复请求', async () => {
    let complete!: (result: any) => void;
    vi.mocked(ipc.checkForUpdates).mockReturnValueOnce(new Promise(resolve => { complete = resolve; }));
    const automatic = useUpdateStore.getState().checkForUpdates(true);
    const manual = useUpdateStore.getState().checkForUpdates(false);
    expect(automatic).toBe(manual);
    expect(useUpdateStore.getState().modalOpen).toBe(true);
    await Promise.resolve();
    expect(ipc.checkForUpdates).toHaveBeenCalledTimes(1);
    complete({ currentVersion: '1.0', latestVersion: '1.1', updateAvailable: true, releaseUrl: '' });
    await manual;
    expect(useUpdateStore.getState().hasUpdate).toBe(true);
  });

  it('静默网络失败不弹窗，也不清除已发现的版本', async () => {
    useUpdateStore.setState({ hasUpdate: true, updateResult: { currentVersion: '1.0', latestVersion: '1.1', updateAvailable: true, releaseUrl: '' } });
    vi.mocked(ipc.checkForUpdates).mockRejectedValueOnce('update_error:network:timeout');
    await useUpdateStore.getState().checkForUpdates(true);
    expect(useUpdateStore.getState()).toMatchObject({ hasUpdate: true, modalOpen: false, checking: false });
    expect(useUpdateStore.getState().checkError).toContain('无法连接 GitHub');
  });

  it('网络失败按退避间隔重试，清理后不再安排请求', async () => {
    vi.useFakeTimers();
    vi.mocked(ipc.checkForUpdates).mockRejectedValue('update_error:network:timeout');
    const stop = useUpdateStore.getState().initAutoUpdateTimer();
    try {
      await vi.advanceTimersByTimeAsync(3000);
      expect(ipc.checkForUpdates).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(30 * 60_000 - 1);
      expect(ipc.checkForUpdates).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(ipc.checkForUpdates).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(60 * 60_000);
      expect(ipc.checkForUpdates).toHaveBeenCalledTimes(3);
    } finally { stop(); }
    await vi.advanceTimersByTimeAsync(24 * 60 * 60_000);
    expect(ipc.checkForUpdates).toHaveBeenCalledTimes(3);
  });

  it('离线时不请求，恢复联网后重试并遵守服务端限流时间', async () => {
    vi.useFakeTimers();
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const reset = Math.floor(Date.now() / 1000) + 3600;
    vi.mocked(ipc.checkForUpdates).mockRejectedValue(`update_error:rate_limited:${reset}`);
    const stop = useUpdateStore.getState().initAutoUpdateTimer();
    try {
      await vi.advanceTimersByTimeAsync(3000);
      expect(ipc.checkForUpdates).not.toHaveBeenCalled();
      online.mockReturnValue(true); window.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(3000);
      expect(ipc.checkForUpdates).toHaveBeenCalledTimes(1);
      window.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(30 * 60_000);
      expect(ipc.checkForUpdates).toHaveBeenCalledTimes(1);
    } finally { stop(); }
  });

  it('关闭提醒同步到进程；较旧的启动快照不撤销其他窗口的关闭', async () => {
    vi.useFakeTimers();
    let read!: (versions: string[]) => void;
    const unlisten = vi.fn();
    vi.mocked(onUpdateNoticeDismissed).mockResolvedValue(unlisten);
    vi.mocked(ipc.getDismissedUpdateNotices).mockReturnValue(new Promise(resolve => { read = resolve; }));
    const stop = useUpdateStore.getState().initAutoUpdateTimer();
    await Promise.resolve();
    const receive = vi.mocked(onUpdateNoticeDismissed).mock.calls[0][0];
    receive('1.2');
    read(['1.1']);
    await Promise.resolve();
    expect(useUpdateStore.getState()).toMatchObject({ noticeReady: true, dismissedNoticeVersions: ['1.2', '1.1'] });
    useUpdateStore.getState().dismissNotice('1.3');
    expect(ipc.dismissUpdateNotice).toHaveBeenCalledWith('1.3');
    stop();
    expect(unlisten).toHaveBeenCalledOnce();
    receive('1.4');
    expect(useUpdateStore.getState().dismissedNoticeVersions).not.toContain('1.4');
  });

  it('卸载时尚未注册完成的监听也会释放，不继续读取会话', async () => {
    vi.useFakeTimers();
    let registered!: (stop: () => void) => void;
    vi.mocked(onUpdateNoticeDismissed).mockReturnValue(new Promise(resolve => { registered = resolve; }));
    const stop = useUpdateStore.getState().initAutoUpdateTimer();
    stop();
    const unlisten = vi.fn(); registered(unlisten);
    await Promise.resolve();
    expect(unlisten).toHaveBeenCalledOnce();
    expect(ipc.getDismissedUpdateNotices).not.toHaveBeenCalled();
  });
});
