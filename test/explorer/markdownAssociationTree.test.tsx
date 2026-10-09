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
  expect(io.open).toHaveBeenCalledWith(md.path, { explorerRoot: directory });
  await act(async () => key(row(md.path), 'ArrowLeft'));
  expect(document.activeElement).toBe(row(nb.path));
});

it('reveals a linked Markdown by opening its group and refreshes only real directories', async () => {
  await act(async () => useExplorerStore.getState().setRevealed(md.path, true));
  expect(row(md.path)).toBeDefined(); expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  expect(document.querySelector('[data-active-branch]')?.getAttribute('data-explorer-branch')).toBe(nb.path);
  await act(async () => refreshExplorer());
  expect(io.readDir).toHaveBeenCalledWith(directory, expect.any(Boolean));
  expect(io.readDir.mock.calls.every(([path]) => path === directory)).toBe(true);
  expect(io.headers).toHaveBeenCalledWith([nb.path, alternate.path]);
});

it('keeps the selected file or folder in exactly its displayed parent branch', async () => {
  const folder = (name: string): FileTreeNode => ({ ...entry(name), isDir: true });
  const outputs = folder('outputs'), samples = folder('outputs\\File-Text-Samples');
  const releases = folder('outputs\\releases'), version = folder('outputs\\releases\\1.0.1');
  const readme = entry('outputs\\File-Text-Samples\\README.md');
  const checksum = entry('outputs\\releases\\1.0.1\\SHA256SUMS.txt');
  const activeBranches = () => Array.from(document.querySelectorAll('[data-active-branch]'), element => element.getAttribute('data-explorer-branch'));
  await act(async () => {
    useExplorerStore.getState().setRoot(directory, [outputs]);
    useExplorerStore.getState().expand(outputs.path, [samples, releases]);
    useExplorerStore.getState().expand(samples.path, [readme]);
    useExplorerStore.getState().expand(releases.path, [version]);
    useExplorerStore.getState().expand(version.path, [checksum]);
    useExplorerStore.getState().setRevealed(readme.path, false);
  });
  expect(activeBranches()).toEqual([samples.path]);
  await act(async () => useExplorerStore.getState().setRevealed(version.path, false));
  expect(activeBranches()).toEqual([releases.path]);
  const state = useExplorerStore.getState();
  await act(async () => {
    row(checksum.path).dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    row(checksum.path).dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
  });
  expect(useExplorerStore.getState()).toBe(state);
  expect(io.readDir).not.toHaveBeenCalled();
  await act(async () => key(row(version.path), 'ArrowLeft'));
  expect(row(checksum.path)).toBeUndefined();
  expect(activeBranches()).toEqual([releases.path]);
  await act(async () => useExplorerStore.getState().setRevealed(outputs.path, false));
  expect(activeBranches()).toEqual([]);
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
  expect(io.open).toHaveBeenCalledWith(nb.path, { explorerRoot: directory });
  expect(io.readDir).not.toHaveBeenCalled(); expect(io.headers).not.toHaveBeenCalled();
});

it('passes the displayed root for deeply nested file clicks and Enter', async () => {
  const folder = (name: string): FileTreeNode => ({ ...entry(name), isDir: true });
  const a = folder('A'), b = folder('A\\B'), file = entry('A\\B\\nested.md');
  await act(async () => {
    useExplorerStore.getState().setRoot(directory, [a]);
    useExplorerStore.getState().expand(a.path, [b]);
    useExplorerStore.getState().expand(b.path, [file]);
  });
  await act(async () => row(file.path).dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await act(async () => key(row(file.path), 'Enter'));
  expect(io.open).toHaveBeenNthCalledWith(1, file.path, { explorerRoot: directory });
  expect(io.open).toHaveBeenNthCalledWith(2, file.path, { explorerRoot: directory });
  expect(io.readDir).not.toHaveBeenCalled();
});
