import * as ipc from '../../core/ipc/commands';
import { resolveRelativeDocPath } from '../../core/documentPath';
import { isSubPath, normalizePath } from '../explorer/pathUtils';
import { useSettingsStore } from '../../stores/settingsStore';
import { isTransientImageSource } from './imageAssetReferences';

export const TRANSIENT_IMAGE_DIRECTORY = '.noteboard-assets';
export const hasPendingImageAssets = (source: string): boolean => /data:image\/|\.noteboard-assets/i.test(source);
const extensions: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/bmp': 'bmp', 'image/avif': 'avif', 'image/x-icon': 'ico' };
export function imageExtension(name: string, mime = ''): string {
  const extension = name.split('.').pop()?.toLowerCase();
  return extensions[mime.toLowerCase()] ?? (extension && /^(png|jpe?g|gif|webp|svg|bmp|avif|ico)$/.test(extension) ? extension : 'png');
}
export function imageDirectory(directory: string): { path: string; relative: string } {
  const folder = (useSettingsStore.getState().settings.file.imageDirName || 'img').trim() || 'img';
  const path = resolveRelativeDocPath(directory, folder);
  if (!isSubPath(directory, path) || normalizePath(path).toLowerCase() === normalizePath(directory).toLowerCase()) throw new Error('图片目录必须位于文档目录内');
  return { path, relative: `./${folder.replace(/\\/g, '/')}` };
}
async function store(bytes: Uint8Array, extension: string, directory: string): Promise<string> {
  return ipc.storeImageAsset(directory, extension, bytes);
}

/** Persistent recovery resources outlive a view and its undo/staging snapshots.
 * Never delete these by pathname when a paste is cancelled or a tab closes. */
export async function storeTransientImage(bytes: Uint8Array, name: string, mime = ''): Promise<string> {
  const directory = resolveRelativeDocPath(await ipc.ensureStagingDirectory(), TRANSIENT_IMAGE_DIRECTORY);
  const filename = await store(bytes, imageExtension(name, mime), directory);
  return resolveRelativeDocPath(directory, filename).replace(/\\/g, '/');
}

/** Only data/transient sources reach here. Existing local/remote references are untouched. */
export async function publishImageAsset(source: string, bytes: Uint8Array | undefined, extension: string, documentPath: string, absolute = false): Promise<string> {
  if (!bytes && !isTransientImageSource(source)) throw new Error('仅可发布绝对路径的恢复图片');
  const directory = documentPath.replace(/[/\\][^/\\]*$/, '');
  if (directory === documentPath || documentPath.startsWith('untitled:')) throw new Error('保存图片需要有效的文档路径');
  const target = imageDirectory(directory);
  const filename = bytes ? await store(bytes, extension, target.path) : await ipc.publishRecoveryImage(source, target.path);
  return absolute ? resolveRelativeDocPath(target.path, filename).replace(/\\/g, '/') : `${target.relative}/${filename}`;
}
