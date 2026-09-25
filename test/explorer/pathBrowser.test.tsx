import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { PathBrowser, parentBrowsePath } from '@/features/welcome/PathBrowser';
import { readDir } from '@/core/ipc/commands';
vi.mock('@/core/ipc/commands', () => ({
  browseLocations: async () => [{ name: '个人文件夹', path: 'C:\\notes', kind: 'folder' }],
  pathExists: async () => ({ exists: true, isDir: true }),
  readDir: vi.fn(async () => [
    { name: '资料', path: 'C:\\notes\\资料', isDir: true },
    { name: '笔记.nb', path: 'C:\\notes\\笔记.nb', isDir: false },
  ]),
}));
vi.mock('@tanstack/react-virtual', () => ({ useVirtualizer: ({ count }: { count: number }) => ({
  getTotalSize: () => count * 36, getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ index, start: index * 36, size: 36 })), scrollToIndex: () => {},
}) }));
it.each(['C:\\', '\\\\server\\share'])('stops parent navigation at a filesystem root %s', path => expect(parentBrowsePath(path)).toBeNull());
it('selects files and folders through the same confirmation and navigates folders independently', async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLElement.prototype.scrollTo = () => {};
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host); const finish = vi.fn();
  try {
    await act(async () => { root.render(<PathBrowser initialPath="" finish={finish} back={() => {}}/>); });
    const entries = host.querySelectorAll('[role="option"]');
    await act(async () => { (entries[0] as HTMLElement).click(); entries[1].dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true })); });
    await act(async () => { (host.querySelector('footer .nb-btn-primary') as HTMLButtonElement).click(); });
    expect(finish).toHaveBeenLastCalledWith(['C:\\notes\\资料', 'C:\\notes\\笔记.nb']);
    finish.mockClear();
    await act(async () => { entries[0].dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
    expect(readDir).toHaveBeenLastCalledWith('C:\\notes\\资料', false);
    expect(finish).not.toHaveBeenCalled();
    await act(async () => { (host.querySelector('footer .nb-btn-primary') as HTMLButtonElement).click(); });
    expect(finish).toHaveBeenCalledWith(['C:\\notes\\资料']);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
