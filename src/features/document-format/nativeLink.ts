import { readNativeMetadata, type NativeMetadata } from '../../core/nativeDocument';
import { resolveRelativeDocPath } from '../../core/documentPath';
import { normalizePath, sameKey } from '../explorer/pathUtils';

export const MARKDOWN_PROJECTION_VERSION = 1;
export function parentDirectory(path: string): string {
  const normalized = normalizePath(path);
  return normalized.slice(0, normalized.lastIndexOf('\\'));
}
export function markdownLinkPath(path: string, metadata: NativeMetadata): string | null {
  const target = metadata.markdown?.path;
  if (!target || !/\.(?:md|markdown)$/i.test(target) || /^[a-z][\w+.-]*:\/\//i.test(target)) return null;
  const resolved = resolveRelativeDocPath(parentDirectory(path), target);
  return resolved && !sameKey(path, resolved) ? normalizePath(resolved) : null;
}
export function nativeMarkdownLink(path: string, source: string | null | undefined): { path: string; metadata: NativeMetadata } | null {
  if (!source) return null;
  const metadata = readNativeMetadata(source);
  const target = markdownLinkPath(path, metadata);
  return target ? { path: target, metadata } : null;
}
export function relativeDocumentPath(owner: string, target: string): string {
  const dir = parentDirectory(owner).split('\\');
  const parts = normalizePath(target).split('\\');
  if (dir[0]?.toLowerCase() !== parts[0]?.toLowerCase()) return normalizePath(target).replace(/\\/g, '/');
  let shared = 0;
  while (shared < dir.length && shared < parts.length && dir[shared].toLowerCase() === parts[shared].toLowerCase()) shared++;
  return [...dir.slice(shared).map(() => '..'), ...parts.slice(shared)].join('/') || '.';
}
