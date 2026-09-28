import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UpdateModal } from '../../src/components/UpdateModal';
import { renderUpdateReleaseNotes } from '../../src/components/updateReleaseNotes';
import * as ipc from '../../src/core/ipc/commands';

vi.mock('../../src/core/ipc/commands', () => ({ downloadAndInstallUpdate: vi.fn(), openExternalUrl: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock('../../src/components/Tooltip', () => ({ Tooltip: ({ children }: { children: ReactNode }) => children }));

let root: Root;
const release = { currentVersion: '1.0.1', latestVersion: '1.0.2', updateAvailable: true, releaseUrl: 'https://github.com/ShallowDream724/NoteBoard/releases/tag/v1.0.2', installerDownloadUrl: 'https://github.com/ShallowDream724/NoteBoard/releases/download/v1.0.2/NoteBoard.exe', installerAssetName: 'NoteBoard.exe', installerSize: 1024, releaseBody: '## 编辑体验\n\n- **表格**选择更稳定。\n- 查看[完整说明](https://github.com/ShallowDream724/NoteBoard/releases)。' };
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); const host = document.createElement('div'); document.body.append(host); root = createRoot(host); vi.clearAllMocks(); vi.mocked(ipc.openExternalUrl).mockResolvedValue(true); });
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });
const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(element => element.textContent === name)!;

describe('更新内容与显式操作', () => {
  it('renders headings and lists while rejecting executable markup and external images', () => {
    const host = document.createElement('div');
    host.innerHTML = renderUpdateReleaseNotes('## 更新\n\n- **改进**\n\n<script>alert(1)</script>\n\n[unsafe](javascript:alert(1))\n\n![截图](https://example.com/tracker.png)');
    expect(host.querySelector('h2')?.textContent).toBe('更新');
    expect(host.querySelector('li strong')?.textContent).toBe('改进');
    expect(host.querySelector('script, img, a')).toBeNull();
    expect(host.textContent).toContain('<script>alert(1)</script>');
    expect(host.textContent).toContain('截图');
  });
  it('opening notes never downloads, and a note link opens externally without navigating the app', async () => {
    await act(async () => root.render(<UpdateModal isOpen onClose={() => {}} result={release} />));
    expect(document.querySelector('.update-release-notes h2')?.textContent).toBe('编辑体验');
    expect(ipc.downloadAndInstallUpdate).not.toHaveBeenCalled();
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    await act(async () => document.querySelector('a')!.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(ipc.openExternalUrl).toHaveBeenCalledExactlyOnceWith('https://github.com/ShallowDream724/NoteBoard/releases');
  });
  it('keeps close disabled during an explicit download and reports failure with retry available', async () => {
    let rejectDownload!: (error: Error) => void;
    vi.mocked(ipc.downloadAndInstallUpdate).mockReturnValue(new Promise((_, reject) => { rejectDownload = reject; }));
    const onClose = vi.fn();
    await act(async () => root.render(<UpdateModal isOpen onClose={onClose} result={release} />));
    await act(async () => button('下载并安装').click());
    expect(ipc.downloadAndInstallUpdate).toHaveBeenCalledExactlyOnceWith({ downloadUrl: release.installerDownloadUrl, assetName: release.installerAssetName, installerSize: 1024 });
    expect(button('稍后').disabled).toBe(true);
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => rejectDownload(new Error('network unavailable')));
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('network unavailable');
    expect(button('下载并安装').disabled).toBe(false);
    expect(button('稍后').disabled).toBe(false);
  });
  it('a release without an installable asset keeps its release-page fallback and disables installation', async () => {
    await act(async () => root.render(<UpdateModal isOpen onClose={() => {}} result={{ ...release, installerAssetName: undefined }} />));
    expect(button('下载并安装').disabled).toBe(true);
    expect(button('发布页').disabled).toBe(false);
    expect(document.body.textContent).toContain('此版本暂无可用安装包');
  });
});
