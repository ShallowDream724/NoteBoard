import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FileTreeNode } from '@/core/ipc/types';
import { Explorer } from '@/features/explorer/Explorer';
import { useExplorerStore } from '@/features/explorer/explorerStore';
import { invalidateMarkdownAssociations, recordNativeAssociation } from '@/features/document-format/markdownAssociationIndex';
import { refreshExplorer } from '@/features/explorer/explorerActions';
import { TooltipProvider } from '@/components/Tooltip';

const io = vi.hoisted(() => ({ open: vi.fn(), rename: vi.fn(), readDir: vi.fn(), headers: vi.fn() }));
vi.mock('@/features/editor-code/orchestration/openDocument', () => ({ openDocument: io.open }));
vi.mock('@/features/explorer/renameOpenPath', () => ({ renameOpenPath: io.rename }));
vi.mock('@/features/explorer/useReveal', () => ({ useReveal() {} }));
vi.mock('@/features/explorer/useWatcher', () => ({ useWatcher() {} }));
vi.mock('@/core/nativeDocumentIO', () => ({ readNativeHeaders: io.headers }));
vi.mock('@/core/ipc/commands', async importOriginal => ({ ...await importOriginal<typeof import('@/core/ipc/commands')>(), readDir: io.readDir }));
const directory = 'C:\\notes';
const entry = (name: string): FileTreeNode => ({ path: `${directory}\\${name}`, name, isDir: false, kind: null, size: 50, mtime: 1, isHidden: false, isSymlink: false });
const nb = entry('note.nb'), md = entry('note.md'), alternate = entry('other.nbdoc');
const source = `#!noteboard 1\n@meta ${JSON.stringify({ markdown: { path: './note.md', baselineHash: 'hash', projectionVersion: 1 } })}\n`;
let root: Root;
const scrollMethods = ['scrollIntoView', 'scrollTo'] as const;
const scrollDescriptors = scrollMethods.map(name => Object.getOwnPropertyDescriptor(Element.prototype, name));
const rows = () => Array.from(document.querySelectorAll<HTMLElement>('[data-explorer-row]'));
const row = (path: string) => rows().find(element => element.dataset.explorerRow === path)!;
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  for (const name of scrollMethods) Object.defineProperty(Element.prototype, name, { configurable: true, value: vi.fn() });
  invalidateMarkdownAssociations(); useExplorerStore.getState().clear();
  io.open.mockReset().mockResolvedValue(undefined); io.rename.mockReset().mockResolvedValue(undefined);
  io.readDir.mockReset().mockResolvedValue([nb, md, alternate]); io.headers.mockReset().mockResolvedValue([{ path: nb.path, header: source }]);
  recordNativeAssociation(nb.path, source); useExplorerStore.getState().setRoot(directory, [nb, md, alternate]);
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<TooltipProvider><Explorer/></TooltipProvider>));
});
afterEach(async () => {
  await act(async () => root.unmount()); document.body.replaceChildren(); useExplorerStore.getState().clear(); invalidateMarkdownAssociations(); vi.unstubAllGlobals(); vi.restoreAllMocks();
  scrollMethods.forEach((name, index) => { const descriptor = scrollDescriptors[index]; if (descriptor) Object.defineProperty(Element.prototype, name, descriptor); else Reflect.deleteProperty(Element.prototype, name); });
});
const key = (element: HTMLElement, value: string) => element.dispatchEvent(new KeyboardEvent('keydown', { key: value, code: value, bubbles: true, cancelable: true }));

it('shows one nested Markdown child and expands the NB without treating its path as a directory', async () => {
  expect(rows().map(element => element.dataset.explorerRow)).toEqual([nb.path, alternate.path]);
  expect(row(nb.path).querySelector('[data-file-icon="noteboard"]')).not.toBeNull();
  expect(row(alternate.path).querySelector('[data-file-icon="noteboard"]')).not.toBeNull();
  await act(async () => key(row(nb.path), 'ArrowRight'));
  expect(rows().map(element => element.dataset.explorerRow)).toEqual([nb.path, md.path, alternate.path]);
  expect(row(md.path).style.paddingLeft).toBe('20px');
  expect(row(md.path).closest('[role="treeitem"]')?.getAttribute('aria-level')).toBe('2');
  expect(io.readDir).not.toHaveBeenCalled(); expect(io.headers).not.toHaveBeenCalled();
  expect(useExplorerStore.getState().expanded.has(nb.path.toLowerCase())).toBe(false);
  await act(async () => key(row(nb.path), 'ArrowRight'));
  expect(document.activeElement).toBe(row(md.path));
  await act(async () => key(row(md.path), 'Enter'));
  expect(io.open).toHaveBeenCalledWith(md.path);
  await act(async () => key(row(md.path), 'ArrowLeft'));
  expect(document.activeElement).toBe(row(nb.path));
});

it('reveals a linked Markdown by opening its group and refreshes only real directories', async () => {
  await act(async () => useExplorerStore.getState().setRevealed(md.path, true));
  expect(row(md.path)).toBeDefined(); expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  await act(async () => refreshExplorer());
  expect(io.readDir).toHaveBeenCalledWith(directory, expect.any(Boolean));
  expect(io.readDir.mock.calls.every(([path]) => path === directory)).toBe(true);
  expect(io.headers).toHaveBeenCalledWith([nb.path, alternate.path]);
});

it('renames a nested Markdown at its actual filesystem parent, retaining the normal file action', async () => {
  await act(async () => key(row(nb.path), 'ArrowRight'));
  await act(async () => key(row(md.path), 'F2'));
  const input = row(md.path).querySelector<HTMLInputElement>('input')!;
  expect(input.selectionStart).toBe(0); expect(input.selectionEnd).toBe(4);
  const renamed = entry('renamed.md'); io.readDir.mockResolvedValue([nb, renamed, alternate]);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'renamed.md');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => key(input, 'Enter'));
  expect(io.rename).toHaveBeenCalledWith(md.path, renamed.path, false);
  expect(rows().map(element => element.dataset.explorerRow)).toContain(renamed.path);
});

it('updates grouping from an already-read source without hover or keyboard filesystem reads', async () => {
  await act(async () => recordNativeAssociation(nb.path, '#!noteboard 1\n'));
  expect(rows().map(element => element.dataset.explorerRow)).toEqual([nb.path, md.path, alternate.path]);
  await act(async () => { row(nb.path).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); key(row(nb.path), 'Enter'); });
  expect(io.open).toHaveBeenCalledWith(nb.path);
  expect(io.readDir).not.toHaveBeenCalled(); expect(io.headers).not.toHaveBeenCalled();
});
