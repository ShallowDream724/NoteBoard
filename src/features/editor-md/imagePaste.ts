import type { Editor } from '@tiptap/core';
import type { EditorView } from '@codemirror/view';
import { showToast } from '../../stores/toastStore';
import { open } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';
import { refreshExplorerAfterWrite } from '../explorer/refreshAfterWrite';
import { enqueueDocumentWrite } from '../session/documentSession';
import { resolveRelativeDocPath } from '../../core/documentPath';
import { captureSourceImageInsertion, captureVisualImageInsertion, type ImageInsertionLease, type InsertedImage } from './imageInsertionLease';
import { imageExtension, publishImageAsset, storeTransientImage } from './imageAssetStorage';

const invalidName = new Set('<>:"/\\|?*');
function safeName(name: string): string {
  return Array.from(name, character => character.charCodeAt(0) <= 0x1f || invalidName.has(character) ? '_' : character)
    .join('').replace(/_+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'image';
}
class CancelledInsertion extends Error {}
function assertCurrent(lease: ImageInsertionLease) { if (!lease.current()) throw new CancelledInsertion(); }

async function writeImage(lease: ImageInsertionLease, name: string, bytes: Uint8Array, mime = ''): Promise<InsertedImage> {
  assertCurrent(lease);
  let written: string | undefined;
  try {
    const src = await enqueueDocumentWrite(lease.docKey, async () => {
      assertCurrent(lease);
      const saved = Boolean(lease.directory) && !lease.docKey.startsWith('untitled:');
      const source = saved ? await publishImageAsset('', bytes, imageExtension(name, mime), lease.docKey) : await storeTransientImage(bytes, name, mime);
      written = saved ? resolveRelativeDocPath(lease.directory!, source) : source;
      if (saved) void refreshExplorerAfterWrite(written);
      return source;
    });
    assertCurrent(lease);
    return { src, alt: safeName(name.replace(/\.[^.]+$/, '')) };
  } catch (error) {
    if (written && !lease.current()) {
      // A native write already dispatched cannot be undone safely by pathname.
      showToast(`图片插入已取消，已写入文件保留；原路径：${written}`, 'info', 6000);
    }
    throw error;
  }
}

/** Capture the original PM target before reading bytes; optionally use the drop hit position. */
export async function handlePastedImageFiles(editor: Editor, files: File[], docKey: string, position?: number): Promise<void> {
  return handleImageFilesUsingLease(captureVisualImageInsertion(editor, docKey, position), files);
}
export async function handleImageFilesUsingLease(lease: ImageInsertionLease | null, files: File[]): Promise<void> {
  return handleImageSourcesUsingLease(lease, files.map(file => ({ name: file.name, mime: file.type, read: async () => new Uint8Array(await file.arrayBuffer()) })));
}
/** Native file drops share the same ownership, storage and atomic insertion as clipboard images. */
export async function handleImagePathsUsingLease(lease: ImageInsertionLease | null, paths: readonly string[]): Promise<void> {
  return handleImageSourcesUsingLease(lease, paths.map(path => ({ name: path.split(/[\\/]/).pop() || 'image.png', mime: '', read: () => readFile(path) })));
}
async function handleImageSourcesUsingLease(lease: ImageInsertionLease | null, sources: { name: string; mime: string; read(): Promise<Uint8Array> }[]): Promise<void> {
  if (!lease) return;
  try {
    const images: InsertedImage[] = [];
    // Sequential IO bounds decoded/binary memory and preserves clipboard order.
    for (const file of sources) {
      assertCurrent(lease);
      const bytes = await file.read(); assertCurrent(lease);
      images.push(await writeImage(lease, file.name, bytes, file.mime));
    }
    if (lease.commit(images)) showToast(`已插入 ${images.length} 张图片`, 'success');
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
  const bytes = await readFile(selected); assertCurrent(lease);
  return writeImage(lease, name, bytes);
}

export async function insertLocalImageUsingLease(lease: ImageInsertionLease | null): Promise<void> {
  if (!lease) return;
  try {
    const image = await pickAndSaveLocalImage(lease);
    if (image && lease.commit(image)) showToast('图片已插入', 'success');
  } catch (error) {
    if (!(error instanceof CancelledInsertion) && !lease.signal.aborted) showToast(`选择图片失败：${String(error)}`, 'error');
  } finally { lease.dispose(); }
}

export function insertLocalImageWithDialog(editor: Editor, docKey: string, position?: number): Promise<void> {
  return insertLocalImageUsingLease(captureVisualImageInsertion(editor, docKey, position));
}
export function insertSourceImageWithDialog(view: EditorView, docKey: string): Promise<void> {
  return insertLocalImageUsingLease(captureSourceImageInsertion(view, docKey));
}
