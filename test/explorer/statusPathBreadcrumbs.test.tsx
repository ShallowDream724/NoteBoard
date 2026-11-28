import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { StatusPathBreadcrumbs } from '@/components/statusbar/StatusPathBreadcrumbs';
import { readDir } from '@/core/ipc/commands';
import type { FileTreeNode } from '@/core/ipc/types';
import { openDocument } from '@/features/editor-code/orchestration/openDocument';
import { useExplorerStore } from '@/features/explorer/explorerStore';

vi.mock('@/core/ipc/commands', () => ({ readDir: vi.fn() }));
vi.mock('@/features/editor-code/orchestration/openDocument', () => ({ openDocument: vi.fn().mockResolvedValue('opened') }));

let host: HTMLElement;
let reactRoot: ReturnType<typeof createRoot>;
const workspace = 'C:\\workspaces\\demo';
const reports = `${workspace}\\汇报`;
const assets = `${reports}\\素材`;
const currentPath = `${assets}\\sample.py`;

const entry = (parent: string, name: string, isDir = false): FileTreeNode => ({
  path: `${parent}\\${name}`, name, isDir, kind: isDir ? null : 'code', size: null, mtime: null, isHidden: false, isSymlink: false,
});

const render = (path: string | null, displayName?: string) => act(async () => reactRoot.render(<StatusPathBreadcrumbs path={path} displayName={displayName} />));
const buttons = () => Array.from(host.querySelectorAll<HTMLButtonElement>('button.nb-status-crumb'));
const button = (label: string) => buttons().find(item => item.textContent === label)!;
const menus = () => Array.from(document.querySelectorAll<HTMLElement>('[role="menu"]'));
const key = (element: HTMLElement, key: string) => act(async () => element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })));
async function click(element: HTMLElement) {
  await act(async () => element.click());
  await act(async () => vi.dynamicImportSettled());
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(() => 280);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(() => 300);
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: () => {} });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.mocked(readDir).mockReset();
  vi.mocked(openDocument).mockClear();
  useExplorerStore.getState().setRoot(workspace, []);
  host = document.body.appendChild(document.createElement('div'));
  reactRoot = createRoot(host);
});

afterEach(async () => {
  await act(async () => reactRoot.unmount());
  host.remove();
  useExplorerStore.getState().clear();
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('lists one directory at each level, marks the current branch and opens a sibling without following the Explorer', async () => {
  vi.mocked(readDir).mockImplementation(async path => path === reports
    ? [entry(reports, '素材', true), entry(reports, '说明.md')]
    : [entry(assets, 'sample.py'), entry(assets, 'second.py')]);
  await render(currentPath);
  expect(buttons().map(item => item.textContent)).toEqual(['demo', '汇报', '素材', 'sample.py']);
  expect(readDir).not.toHaveBeenCalled();
  await click(button('汇报'));
  const [parent] = menus();
  expect(document.activeElement).toBe(parent);
  expect(parent.querySelector('[aria-current="location"]')?.textContent).toBe('素材');
  expect(parent.querySelector('[role="separator"]')).toBeTruthy();
  expect(readDir).toHaveBeenCalledExactlyOnceWith(reports, false);

  await key(parent, 'ArrowRight');
  const [, submenu] = menus();
  expect(document.activeElement).toBe(submenu);
  expect(readDir).toHaveBeenLastCalledWith(assets, false);
  expect(submenu.querySelector('[aria-checked="true"]')?.textContent).toBe('sample.py');
  expect(submenu.querySelector('[data-file-icon="lang-python"]')).toBeTruthy();
  await key(submenu, 'ArrowLeft');
  expect(menus()).toEqual([parent]);
  expect(document.activeElement).toBe(parent);

  await key(parent, 'Escape');
  expect(menus()).toHaveLength(0);
  await click(button('sample.py'));
  const [siblings] = menus();
  expect(readDir).toHaveBeenLastCalledWith(assets, false);
  await key(siblings, 'End');
  await key(siblings, 'Enter');
  expect(openDocument).toHaveBeenCalledExactlyOnceWith(`${assets}\\second.py`, { explorer: 'preserve', explorerRoot: workspace });
  expect(useExplorerStore.getState().root).toBe(workspace);
  expect(useExplorerStore.getState().expanded.size).toBe(0);
});

it('responds to changes of explorer root, discards old reads and shows a full path outside the root', async () => {
  let finish!: (result: FileTreeNode[]) => void;
  vi.mocked(readDir).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  vi.mocked(readDir).mockResolvedValueOnce([entry(assets, 'sample.py')]);
  await render(currentPath);
  await click(button('demo'));
  expect(menus()[0].getAttribute('aria-busy')).toBe('true');
  await act(async () => useExplorerStore.getState().setRoot('C:\\workspaces\\demo-other', []));
  expect(buttons().map(item => item.textContent)).toEqual([currentPath]);
  await click(button(currentPath));
  await act(async () => finish([entry(workspace, 'old.txt')]));
  expect(menus()).toHaveLength(1);
  expect(menus()[0].textContent).toContain('sample.py');
  expect(menus()[0].textContent).not.toContain('old.txt');
  expect(readDir).toHaveBeenLastCalledWith(assets, false);
});

it('keeps UNC share and drive roots valid and shows a plain name for untitled documents', async () => {
  const share = '\\\\server\\share';
  vi.mocked(readDir).mockResolvedValue([]);
  await act(async () => useExplorerStore.getState().setRoot(share, []));
  await render(`${share}\\demo.md`);
  expect(buttons().map(item => item.textContent)).toEqual(['share', 'demo.md']);
  await click(button('share'));
  expect(readDir).toHaveBeenLastCalledWith(share, false);
  await act(async () => useExplorerStore.getState().setRoot('D:\\', []));
  await render('D:\\demo.md');
  await click(button('D:'));
  expect(readDir).toHaveBeenLastCalledWith('D:\\', false);
  await render(null, '未命名文档');
  expect(buttons()).toHaveLength(0);
  expect(host.querySelector('[aria-current="page"]')?.textContent).toBe('未命名文档');
});

it('limits a large menu to 300 entries without mounting the complete list', async () => {
  vi.mocked(readDir).mockResolvedValue(Array.from({ length: 715 }, (_, index) => entry(assets, `file${index}.md`)));
  await render(currentPath);
  await click(button('sample.py'));
  const [menu] = menus();
  expect(menu.querySelectorAll('[role="menuitemradio"]').length).toBeLessThan(25);
  expect(menu.querySelector('[role="status"]')?.textContent).toBe('另有 415 项');
  await key(menu, 'End');
  const last = document.getElementById(menu.getAttribute('aria-activedescendant')!)!;
  expect(last.textContent).toBe('file299.md');
});
