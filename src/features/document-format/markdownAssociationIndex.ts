import type { FileTreeNode } from '../../core/ipc/types';
import { readNativeHeaders } from '../../core/nativeDocumentIO';
import { nativeMarkdownLink, parentDirectory } from './nativeLink';
import { normalizePath, sameKey } from '../explorer/pathUtils';

interface Association { target: string | null; mtime?: number | null; size?: number | null; write: number }
interface DirectoryRead { signature: string; paths: Set<string>; pending?: Promise<void> }
export interface AssociatedExplorerEntry { node: FileTreeNode; markdown?: FileTreeNode }
const associations = new Map<string, Association>();
const directories = new Map<string, DirectoryRead>();
const listeners = new Set<() => void>();
let revision = 0, nextWrite = 0;
const key = (path: string) => normalizePath(path).toLowerCase();
const native = (node: FileTreeNode) => !node.isDir && /\.(?:nb|nbdoc)$/i.test(node.path);
function publish(changed: boolean) { if (changed) { revision++; for (const listener of listeners) listener(); } }
function targetFromSource(path: string, source: string): string | null { return nativeMarkdownLink(path, source)?.path ?? null; }

export function subscribeMarkdownAssociations(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }
export function markdownAssociationRevision(): number { return revision; }

/** Open/save/conversion already own these bytes; never read a file from a UI event. */
export function recordNativeAssociation(nbPath: string, source: string): void {
  if (!/\.(?:nb|nbdoc)$/i.test(nbPath)) return;
  const id = key(nbPath), previous = associations.get(id), target = targetFromSource(nbPath, source);
  associations.set(id, { ...previous, target, write: ++nextWrite });
  publish(!previous || !sameKey(previous.target, target));
}

/** Once per directory snapshot, with at most 256 bounded headers in each native call. */
export function refreshMarkdownAssociations(directory: string, entries: readonly FileTreeNode[], force = false): Promise<void> {
  const id = key(directory), files = entries.filter(native);
  const signature = files.map(node => `${key(node.path)}:${node.mtime}:${node.size}`).join('\n');
  const previous = directories.get(id);
  if (previous?.signature === signature && !force) return previous.pending ?? Promise.resolve();
  const state: DirectoryRead = { signature, paths: new Set(files.map(node => key(node.path))) };
  directories.set(id, state);
  let changed = false;
  for (const old of previous?.paths ?? []) if (!state.paths.has(old)) { changed = associations.delete(old) || changed; }
  const pending = files.filter(node => {
    const cached = associations.get(key(node.path));
    if (!cached || force) return true;
    if (cached.mtime === undefined) return true;
    return cached.mtime !== node.mtime || cached.size !== node.size;
  });
  const writes = new Map(pending.map(node => [key(node.path), associations.get(key(node.path))?.write]));
  publish(changed);
  const work = (async () => {
    let changed = false;
    for (let offset = 0; offset < pending.length; offset += 256) {
      const batch = pending.slice(offset, offset + 256);
      let headers: { path: string; header: string }[] = [];
      try { headers = await readNativeHeaders(batch.map(node => node.path)); } catch { /* Unreadable headers leave files visible and retry on refresh. */ }
      if (directories.get(id) !== state) return;
      const results = new Map(headers.map(item => [key(item.path), item.header]));
      for (const node of batch) {
        const file = key(node.path), before = associations.get(file);
        // A newer open/save result wins over a directory request already in flight.
        if (before?.write !== writes.get(file)) {
          if (before && before.mtime === undefined) { before.mtime = node.mtime; before.size = node.size; }
          continue;
        }
        const target = targetFromSource(node.path, results.get(file) ?? '');
        associations.set(file, { target, mtime: node.mtime, size: node.size, write: before?.write ?? 0 });
        changed = !before || !sameKey(before.target, target) || changed;
      }
    }
    if (directories.get(id) === state) publish(changed);
  })().finally(() => { if (directories.get(id) === state) state.pending = undefined; });
  state.pending = work;
  return work;
}

/** Only a present Markdown file with exactly one same-directory owner is nested. */
export function groupMarkdownAssociations(entries: readonly FileTreeNode[]): AssociatedExplorerEntry[] {
  const files = new Map(entries.map(node => [key(node.path), node]));
  const owners = new Map<string, { node: FileTreeNode; count: number }>();
  for (const node of entries) {
    if (!native(node)) continue;
    const target = associations.get(key(node.path))?.target, markdown = target ? files.get(key(target)) : undefined;
    if (!markdown || markdown.isDir || !/\.(?:md|markdown)$/i.test(markdown.path) || !sameKey(parentDirectory(node.path), parentDirectory(markdown.path))) continue;
    const id = key(markdown.path), previous = owners.get(id);
    owners.set(id, { node: previous?.node ?? node, count: (previous?.count ?? 0) + 1 });
  }
  const nested = new Map<string, FileTreeNode>(), hidden = new Set<string>();
  for (const [target, owner] of owners) if (owner.count === 1) { nested.set(key(owner.node.path), files.get(target)!); hidden.add(target); }
  return entries.filter(node => !hidden.has(key(node.path))).map(node => ({ node, ...(nested.has(key(node.path)) ? { markdown: nested.get(key(node.path))! } : {}) }));
}

/** Explicit cache invalidation, including an in-flight refresh, for a directory re-scan. */
export function invalidateMarkdownAssociations(directory?: string): void {
  if (directory === undefined) { directories.clear(); const changed = associations.size > 0; associations.clear(); publish(changed); return; }
  const id = key(directory), current = directories.get(id); directories.delete(id);
  let changed = false;
  for (const path of current?.paths ?? []) changed = associations.delete(path) || changed;
  publish(changed);
}
