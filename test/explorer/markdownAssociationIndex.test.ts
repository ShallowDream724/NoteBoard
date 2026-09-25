import { beforeEach, expect, it, vi } from 'vitest';
import type { FileTreeNode } from '@/core/ipc/types';
import { groupMarkdownAssociations, invalidateMarkdownAssociations, recordNativeAssociation, refreshMarkdownAssociations } from '@/features/document-format/markdownAssociationIndex';

const io = vi.hoisted(() => ({ headers: vi.fn() }));
vi.mock('@/core/nativeDocumentIO', () => ({ readNativeHeaders: io.headers }));
const directory = 'C:\\notes';
const entry = (name: string, mtime = 1, isDir = false): FileTreeNode => ({ path: `${directory}\\${name}`, name, mtime, isDir, kind: null, size: 50, isHidden: false, isSymlink: false });
const source = (path: string) => `#!noteboard 1\n@meta ${JSON.stringify({ markdown: { path, baselineHash: 'hash', projectionVersion: 1 } })}\n@block invalid body intentionally unread\n`;
beforeEach(() => { invalidateMarkdownAssociations(); io.headers.mockReset().mockResolvedValue([]); });

it('reads only NB headers in one directory batch and nests each uniquely linked Markdown once', async () => {
  const nb = entry('Note.NB'), alternate = entry('other.nbdoc'), md = entry('note.md'), other = entry('other.markdown'), folder = entry('folder.nb', 1, true);
  io.headers.mockResolvedValue([{ path: nb.path, header: source('./NOTE.md') }, { path: alternate.path, header: source('./other.markdown') }]);
  await refreshMarkdownAssociations(directory, [folder, nb, md, alternate, other]);
  expect(io.headers).toHaveBeenCalledOnce(); expect(io.headers).toHaveBeenCalledWith([nb.path, alternate.path]);
  expect(groupMarkdownAssociations([folder, nb, md, alternate, other])).toEqual([{ node: folder }, { node: nb, markdown: md }, { node: alternate, markdown: other }]);
});

it('uses mtime/size cache and forces a fresh header batch on directory refresh', async () => {
  const nb = entry('note.nb'), md = entry('note.md');
  io.headers.mockResolvedValue([{ path: nb.path, header: source('./note.md') }]);
  await refreshMarkdownAssociations(directory, [nb, md]);
  await refreshMarkdownAssociations(directory, [{ ...nb }, { ...md }]);
  expect(io.headers).toHaveBeenCalledTimes(1);
  await refreshMarkdownAssociations(directory, [{ ...nb, mtime: 2 }, md]);
  expect(io.headers).toHaveBeenCalledTimes(2);
  await refreshMarkdownAssociations(directory, [{ ...nb, mtime: 2 }, md], true);
  expect(io.headers).toHaveBeenCalledTimes(3);
});

it('bounds every native read to 256 headers, even for a large directory', async () => {
  const entries = Array.from({ length: 600 }, (_, index) => entry(`${index}.nb`));
  io.headers.mockImplementation(async (paths: string[]) => paths.map(path => ({ path, header: '#!noteboard 1\n' })));
  await refreshMarkdownAssociations(directory, entries);
  expect(io.headers.mock.calls.map(([paths]) => paths.length)).toEqual([256, 256, 88]);
  await refreshMarkdownAssociations(directory, entries);
  expect(io.headers).toHaveBeenCalledTimes(3);
});

it('keeps missing, cross-directory and ambiguously owned Markdown files at their real level', () => {
  const a = entry('a.nb'), b = entry('b.nbdoc'), c = entry('c.nb'), md = entry('note.md'), distant = { ...entry('outside.md'), path: 'C:\\elsewhere\\outside.md' };
  recordNativeAssociation(a.path, source('./note.md')); recordNativeAssociation(b.path, source('./note.md'));
  recordNativeAssociation(c.path, source('../elsewhere/outside.md'));
  expect(groupMarkdownAssociations([a, b, c, md, distant])).toEqual([a, b, c, md, distant].map(node => ({ node })));
  expect(groupMarkdownAssociations([a])).toEqual([{ node: a }]);
});

it('does not let an older in-flight directory read overwrite a newer saved association', async () => {
  const nb = entry('note.nb'), first = entry('first.md'), second = entry('second.md');
  let complete!: (headers: { path: string; header: string }[]) => void;
  io.headers.mockReturnValue(new Promise(resolve => { complete = resolve; }));
  const pending = refreshMarkdownAssociations(directory, [nb, first, second]);
  recordNativeAssociation(nb.path, source('./second.md'));
  complete([{ path: nb.path, header: source('./first.md') }]); await pending;
  expect(groupMarkdownAssociations([nb, first, second])).toEqual([{ node: nb, markdown: second }, { node: first }]);
  io.headers.mockResolvedValue([{ path: nb.path, header: source('./first.md') }]);
  await refreshMarkdownAssociations(directory, [{ ...nb, mtime: 2 }, first, second]);
  expect(groupMarkdownAssociations([nb, first, second])[0]).toEqual({ node: nb, markdown: first });
});

it('coalesces matching in-flight requests and prunes removed NB owners', async () => {
  const nb = entry('note.nb'), md = entry('note.md');
  let complete!: (headers: { path: string; header: string }[]) => void;
  io.headers.mockReturnValue(new Promise(resolve => { complete = resolve; }));
  const first = refreshMarkdownAssociations(directory, [nb, md]), second = refreshMarkdownAssociations(directory, [nb, md]);
  expect(second).toBe(first); expect(io.headers).toHaveBeenCalledOnce();
  complete([{ path: nb.path, header: source('./note.md') }]); await first;
  await refreshMarkdownAssociations(directory, [md]);
  expect(groupMarkdownAssociations([md])).toEqual([{ node: md }]);
});

it('keeps files visible after a failed header read and retries on explicit refresh', async () => {
  const nb = entry('note.nb'), md = entry('note.md'); io.headers.mockRejectedValue(new Error('unreadable'));
  await refreshMarkdownAssociations(directory, [nb, md]);
  expect(groupMarkdownAssociations([nb, md])).toEqual([{ node: nb }, { node: md }]);
  io.headers.mockResolvedValue([{ path: nb.path, header: source('./note.md') }]);
  await refreshMarkdownAssociations(directory, [nb, md], true);
  expect(groupMarkdownAssociations([nb, md])).toEqual([{ node: nb, markdown: md }]);
});
