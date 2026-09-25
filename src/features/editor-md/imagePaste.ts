import type { Editor } from '@tiptap/core';
import type { EditorView } from '@codemirror/view';
import * as ipc from '../../core/ipc/commands';
import { useSettingsStore } from '../../stores/settingsStore';
import { showToast } from '../../stores/toastStore';
import { open } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';
import { refreshExplorerAfterWrite } from '../explorer/refreshAfterWrite';
import { enqueueDocumentWrite } from '../session/documentSession';
import { resolveRelativeDocPath } from '../../core/documentPath';
import { isSubPath, normalizePath } from '../explorer/pathUtils';
import { captureSourceImageInsertion, captureVisualImageInsertion, type ImageInsertionLease, type InsertedImage } from './imageInsertionLease';

const invalidName = new Set('<>:"/\\|?*');
function safeName(name: string): string {
  return Array.from(name, character => character.charCodeAt(0) <= 0x1f || invalidName.has(character) ? '_' : character)
    .join('').replace(/_+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'image';
}
class CancelledInsertion extends Error {}
function assertCurrent(lease: ImageInsertionLease) { if (!lease.current()) throw new CancelledInsertion(); }

function asDataURL(file: File, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const abort = () => reader.abort();
    const finish = () => signal.removeEventListener('abort', abort);
    reader.onload = () => { finish(); resolve(String(reader.result)); };
    reader.onerror = () => { finish(); reject(reader.error ?? new Error('无法读取图片')); };
    reader.onabort = () => { finish(); reject(new CancelledInsertion()); };
    if (signal.aborted) { reject(new CancelledInsertion()); return; }
    signal.addEventListener('abort', abort, { once: true });
    reader.readAsDataURL(file);
  });
}

interface ImageDestination { path: string; src: string; alt: string; folder: string }
function destination(lease: ImageInsertionLease, name: string): ImageDestination | null {
  if (!lease.directory || lease.docKey.startsWith('untitled:')) return null;
  const folder = (useSettingsStore.getState().settings.file.imageDirName || 'img').trim() || 'img';
  const directory = resolveRelativeDocPath(lease.directory, folder);
  if (!isSubPath(lease.directory, directory) || normalizePath(directory).toLowerCase() === normalizePath(lease.directory).toLowerCase()) throw new Error('图片目录必须位于文档目录内');
  const alt = safeName(name.replace(/\.[^.]+$/, ''));
  const candidate = name.split('.').pop()?.toLowerCase() ?? 'png';
  const extension = /^[a-z0-9]{1,10}$/.test(candidate) ? candidate : 'png';
  // Random operation identity avoids millisecond/name collisions. It is not a
  // filesystem ownership receipt, so cancellation never deletes this path.
  const filename = `${crypto.randomUUID()}_${alt}.${extension}`;
  return { path: resolveRelativeDocPath(directory, filename), src: `./${folder.replace(/\\/g, '/')}/${filename}`, alt, folder };
}

async function writeImage(lease: ImageInsertionLease, target: ImageDestination, bytes: Uint8Array): Promise<void> {
  assertCurrent(lease);
  let written = false;
  try {
    await enqueueDocumentWrite(lease.docKey, async () => {
      assertCurrent(lease);
      const result = await ipc.saveBinaryFile(target.path, bytes);
      if (!result.ok) throw new Error(typeof result.error === 'string' ? result.error : '保存图片失败');
      written = true;
      void refreshExplorerAfterWrite(target.path);
    });
    assertCurrent(lease);
  } catch (error) {
    if (written && !lease.current()) {
      // A native write already dispatched cannot be undone safely by pathname.
      showToast(`图片插入已取消，已写入文件保留；原路径：${target.path}`, 'info', 6000);
    }
    throw error;
  }
}

/** Capture the original PM target before reading bytes; optionally use the drop hit position. */
export async function handlePastedImageFiles(editor: Editor, files: File[], docKey: string, position?: number): Promise<void> {
  return handleImageFilesUsingLease(captureVisualImageInsertion(editor, docKey, position), files);
}
export async function handleImageFilesUsingLease(lease: ImageInsertionLease | null, files: File[]): Promise<void> {
  if (!lease) return;
  try {
    const images: InsertedImage[] = []; let fallback = false;
    // Sequential IO bounds decoded/binary memory and preserves clipboard order.
    for (const file of files) {
    assertCurrent(lease);
    const target = destination(lease, file.name);
    if (target) {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer()); assertCurrent(lease);
        await writeImage(lease, target, bytes);
        images.push(target); continue;
      } catch (error) {
        if (error instanceof CancelledInsertion || !lease.current()) return;
        const src = await asDataURL(file, lease.signal); assertCurrent(lease);
        images.push({ src, alt: target.alt }); fallback = true; continue;
      }
    }
    const src = await asDataURL(file, lease.signal); assertCurrent(lease);
    images.push({ src, alt: safeName(file.name.replace(/\.[^.]+$/, '')) });
    }
    if (lease.commit(images)) showToast(fallback ? '图片已插入；部分图片落盘失败，暂存于文档中' : `已插入 ${images.length} 张图片`, fallback ? 'warning' : 'success');
  } catch (error) {
    if (!(error instanceof CancelledInsertion) && !lease.signal.aborted) showToast(`图片插入失败：${String(error)}`, 'error');
  } finally { lease.dispose(); }
}

export function handlePastedImageFile(editor: Editor, file: File, docKey: string, position?: number): Promise<void> {
  return handlePastedImageFiles(editor, [file], docKey, position);
}

async function pickAndSaveLocalImage(lease: ImageInsertionLease): Promise<InsertedImage | null> {
  const selected = await open({ title: '选择要插入的图片', multiple: false,
    filters: [{ name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp'] }] });
  assertCurrent(lease);
  if (!selected || typeof selected !== 'string') return null;
  const name = selected.split(/[\\/]/).pop() || 'image.png';
  const target = destination(lease, name);
  if (!target) return { src: selected, alt: safeName(name.replace(/\.[^.]+$/, '')) };
  try {
    const bytes = await readFile(selected); assertCurrent(lease);
    await writeImage(lease, target, bytes);
    return target;
  } catch (error) {
    if (error instanceof CancelledInsertion || !lease.current()) throw new CancelledInsertion();
    showToast('复制图片失败，已使用原文件路径', 'warning');
    return { src: selected, alt: target.alt };
  }
}

async function insertPickedImage(lease: ImageInsertionLease | null): Promise<void> {
  if (!lease) return;
  try {
    const image = await pickAndSaveLocalImage(lease);
    if (image && lease.commit(image)) showToast('图片已插入', 'success');
  } catch (error) {
    if (!(error instanceof CancelledInsertion) && !lease.signal.aborted) showToast(`选择图片失败：${String(error)}`, 'error');
  } finally { lease.dispose(); }
}

export function insertLocalImageWithDialog(editor: Editor, docKey: string, position?: number): Promise<void> {
  return insertPickedImage(captureVisualImageInsertion(editor, docKey, position));
}
export function insertSourceImageWithDialog(view: EditorView, docKey: string): Promise<void> {
  return insertPickedImage(captureSourceImageInsertion(view, docKey));
}
