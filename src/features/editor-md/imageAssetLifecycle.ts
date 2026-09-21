import { useDocumentStore } from '../../stores/documentStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useExplorerStore } from '../explorer/explorerStore';
import { isSubPath, normalizePath } from '../explorer/pathUtils';
import { resolveRelativeDocPath } from './linkHandler';
import { refreshExplorerAfterWrite } from '../explorer/refreshAfterWrite';
import { recycleDocumentImage, restoreDocumentImage } from '../../core/ipc/commands';
import { emit, on, off } from '../../core/emitter';
import { showToast } from '../../stores/toastStore';
import { getSessionGeneration } from '../session/documentSession';

interface Removal {
  docKey: string; path: string; src: string; generation: number;
  removed: boolean; approved: boolean; saved: boolean;
  stillReferenced: (src: string) => boolean;
  ticket?: string; work?: Promise<void>;
}
const removals = new Map<string, Removal>();
let decisions = Promise.resolve();
let listening = false;
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

function active(record: Removal) {
  return removals.get(identity(record.path)) === record && record.removed
    && !record.stillReferenced(record.src)
    && getSessionGeneration(record.docKey) === record.generation
    && Boolean(useDocumentStore.getState().getDocument(record.docKey));
}

function forget(record: Removal) {
  if (removals.get(identity(record.path)) === record) removals.delete(identity(record.path));
  if (!removals.size && listening) {
    off('document-saved', documentSaved);
    off('document-session-ended', sessionEnded);
    listening = false;
  }
}

async function restore(record: Removal) {
  if (record.ticket) {
    // Keep the receipt on failure: the file is still in the recycle bin and a
    // later undo can retry restoration. Clearing it would lose that ability.
    await restoreDocumentImage(record.ticket);
    record.ticket = undefined;
    emit('image-file-restored', { path: record.path });
    void refreshExplorerAfterWrite(record.path);
  }
  if (!record.removed) forget(record);
}

/** Consumes a normal successful save; this service never initiates one. */
async function recycleAfterSave(record: Removal) {
  if (!record.approved || !record.saved || record.ticket || !active(record)) return;
  record.saved = false;
  const { syncDocumentContent } = await import('../editor-code/orchestration/syncDocumentContent');
  const filename = record.path.split(/[\\/]/).pop()!.toLowerCase();
  for (const peer of useDocumentStore.getState().documents.values()) {
    if (peer.key === record.docKey || peer.kind !== 'markdown') continue;
    const latest = await syncDocumentContent(peer.key);
    const text = latest?.content?.toLowerCase();
    if (text?.includes(filename) || text?.includes(encodeURIComponent(filename).toLowerCase())) {
      throw new Error('另一篇已打开的文档仍可能引用此图片，已保留文件');
    }
  }
  if (!active(record)) return;
  const receipt = await recycleDocumentImage(record.docKey, record.path,
    useSettingsStore.getState().settings.file.imageDirName || 'img', useExplorerStore.getState().root);
  record.ticket = receipt.ticket;
  void refreshExplorerAfterWrite(record.path);
  // Undo/close can occur during the native recycle operation.
  if (!active(record)) await restore(record);
}

function queue(record: Removal, action: () => Promise<void>) {
  record.work = (record.work ?? Promise.resolve()).then(action).catch((error) => {
    showToast(String(error), 'warning', 6000);
  });
}

function documentSaved({ key, generation }: { key: string; generation: number }) {
  for (const record of removals.values()) {
    if (record.docKey !== key || record.generation !== generation) continue;
    record.saved = true;
    queue(record, () => recycleAfterSave(record));
  }
}

function sessionEnded({ key }: { key: string }) {
  for (const record of removals.values()) {
    if (record.docKey !== key) continue;
    record.removed = false;
    forget(record);
  }
}

async function decide(record: Removal) {
  if (!active(record)) { forget(record); return; }
  const policy = useSettingsStore.getState().settings.file.imageDeletionPolicy ?? 'ask';
  const choice = policy === 'keep' || policy === 'trash'
    ? { action: policy, remember: false }
    : await (await import('./ImageRemovalDialog')).askImageRemoval(record.path.split(/[\\/]/).pop() ?? record.path);
  if (choice.remember) await useSettingsStore.getState().setFile({ imageDeletionPolicy: choice.action });
  if (choice.action !== 'trash' || !active(record)) { forget(record); return; }
  record.approved = true;
  // A user may have saved while the confirmation was open.
  await recycleAfterSave(record);
}

/** Semantic image changes only; NodeViews never mutate files themselves. */
export function reconcileImageAssets(
  docKey: string, removed: Set<string>, added: Set<string>, stillReferenced: (src: string) => boolean,
): void {
  for (const src of added) {
    const path = managedPath(docKey, src);
    const record = path ? removals.get(identity(path)) : undefined;
    if (!record) continue;
    record.removed = false;
    record.approved = false;
    record.saved = false;
    queue(record, async () => { if (!record.removed) await restore(record); });
  }
  for (const src of removed) {
    if (stillReferenced(src)) continue;
    const path = managedPath(docKey, src);
    if (!path) continue;
    const existing = removals.get(identity(path));
    if (existing?.removed) continue;
    const record: Removal = existing ?? { docKey, path, src, generation: getSessionGeneration(docKey),
      removed: true, approved: false, saved: false, stillReferenced };
    record.removed = true;
    record.approved = false;
    record.saved = false;
    record.stillReferenced = stillReferenced;
    removals.set(identity(path), record);
    if (!listening) {
      on('document-saved', documentSaved);
      on('document-session-ended', sessionEnded);
      listening = true;
    }
    queue(record, async () => {
      const decision = decisions.then(() => decide(record));
      decisions = decision.catch(() => {});
      await decision;
    });
  }
}
