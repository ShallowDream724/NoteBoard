import { useDocumentStore } from '../../stores/documentStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useExplorerStore } from '../explorer/explorerStore';
import { isSubPath, normalizePath } from '../explorer/pathUtils';
import { resolveRelativeDocPath } from './linkHandler';
import { refreshExplorerAfterWrite } from '../explorer/refreshAfterWrite';
import { recycleDocumentImage, restoreDocumentImage } from '../../core/ipc/commands';
import { emit } from '../../core/emitter';
import { showToast } from '../../stores/toastStore';
import { getSessionGeneration } from '../session/documentSession';

interface Removal {
  docKey: string; path: string; src: string; removed: boolean;
  ticket?: string; work?: Promise<void>;
}
const removals = new Map<string, Removal>();
let decisions = Promise.resolve();
const identity = (path: string) => normalizePath(path).toLowerCase();

function managedPath(docKey: string, src: string): string | null {
  const doc = useDocumentStore.getState().getDocument(docKey);
  if (!doc?.dirPath || docKey.startsWith('untitled:') || /^(?:https?:|data:|asset:)/i.test(src)) return null;
  try {
    const path = resolveRelativeDocPath(doc.dirPath, src);
    const managed = resolveRelativeDocPath(doc.dirPath, useSettingsStore.getState().settings.file.imageDirName || 'img');
    return isSubPath(managed, path) && identity(managed) !== identity(path) ? path : null;
  } catch { return null; }
}

async function restore(record: Removal) {
  if (!record.ticket) return;
  try {
    await restoreDocumentImage(record.ticket);
    record.ticket = undefined;
    emit('image-file-restored', { path: record.path });
    void refreshExplorerAfterWrite(record.path);
    removals.delete(identity(record.path));
  } catch (error) {
    showToast('正文已恢复，图片文件恢复失败：' + String(error), 'error', 6000);
  }
}

/** Called by the editor adapter after a semantic image-node change, never by a view's delete button. */
export function reconcileImageAssets(
  docKey: string, removed: Set<string>, added: Set<string>, stillReferenced: (src: string) => boolean,
): void {
  for (const src of added) {
    const path = managedPath(docKey, src);
    const record = path ? removals.get(identity(path)) : undefined;
    if (!record) continue;
    record.removed = false;
    record.work = (record.work ?? Promise.resolve()).then(async () => {
      if (!record.removed) await restore(record);
    });
  }
  for (const src of removed) {
    if (stillReferenced(src)) continue;
    const path = managedPath(docKey, src);
    if (!path) continue;
    const existing = removals.get(identity(path));
    if (existing) {
      existing.removed = true;
      void existing.work?.then(() => {
        if (!existing.ticket && !stillReferenced(src)) {
          removals.delete(identity(path));
          reconcileImageAssets(docKey, new Set([src]), new Set(), stillReferenced);
        }
      });
      continue;
    }
    const generation = getSessionGeneration(docKey);
    const record: Removal = { docKey, path, src, removed: true };
    const cancelled = () => !record.removed || stillReferenced(src)
      || getSessionGeneration(docKey) !== generation || !useDocumentStore.getState().getDocument(docKey);
    removals.set(identity(path), record);
    const run = async () => {
      try {
        if (cancelled()) return;
        const policy = useSettingsStore.getState().settings.file.imageDeletionPolicy ?? 'ask';
        const choice = policy === 'keep' || policy === 'trash'
          ? { action: policy, remember: false }
          : await (await import('./ImageRemovalDialog')).askImageRemoval(path.split(/[\\/]/).pop() ?? path);
        if (choice.remember) await useSettingsStore.getState().setFile({ imageDeletionPolicy: choice.action });
        if (choice.action !== 'trash' || cancelled()) return;

        // Save before file mutation: a crash must not leave an on-disk Markdown reference dangling.
        const { saveDocument } = await import('../editor-code/orchestration/saveDocument');
        if (!await saveDocument(docKey)) return;
        if (cancelled()) return;
        const { syncDocumentContent } = await import('../editor-code/orchestration/syncDocumentContent');
        const filename = path.split(/[\\/]/).pop()!.toLowerCase();
        for (const peer of useDocumentStore.getState().documents.values()) {
          if (peer.key === docKey || peer.kind !== 'markdown') continue;
          const latest = await syncDocumentContent(peer.key);
          const text = latest?.content?.toLowerCase();
          if (text?.includes(filename) || text?.includes(encodeURIComponent(filename).toLowerCase())) {
            throw new Error('另一篇已打开的文档仍可能引用此图片，已保留文件');
          }
        }
        if (cancelled()) return;
        const receipt = await recycleDocumentImage(docKey, path,
          useSettingsStore.getState().settings.file.imageDirName || 'img', useExplorerStore.getState().root);
        record.ticket = receipt.ticket;
        void refreshExplorerAfterWrite(path);
        if (!record.removed || stillReferenced(src)) await restore(record);
      } catch (error) {
        showToast(String(error), 'warning', 6000);
      } finally {
        if (!record.ticket) removals.delete(identity(path));
      }
    };
    record.work = decisions.then(run);
    decisions = record.work.catch(() => {});
  }
}
