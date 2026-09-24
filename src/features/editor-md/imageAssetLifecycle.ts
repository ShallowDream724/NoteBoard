import { useDocumentStore } from '../../stores/documentStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useExplorerStore } from '../explorer/explorerStore';
import { isSubPath, normalizePath } from '../explorer/pathUtils';
import { resolveRelativeDocPath } from '../../core/documentPath';
import { refreshExplorerAfterWrite } from '../explorer/refreshAfterWrite';
import { recycleDocumentImages, restoreDocumentImage } from '../../core/ipc/commands';
import { getDocumentRevision, getEditorCapabilities } from '../../core/editor/editorRegistry';
import { emit, on, off } from '../../core/emitter';
import { showToast } from '../../stores/toastStore';
import { getSavedRevision, getSessionGeneration } from '../session/documentSession';
import { mayReferenceImage, normalizeImageReferenceText } from './imageReferences';

interface Removal {
  docKey: string; path: string; src: string; generation: number;
  removed: boolean; approved: boolean; savedRevision?: number;
  stillReferenced: (src: string) => boolean;
  ticket?: string; inFlight?: boolean;
}
interface Evidence {
  key: string; generation: number; revision: number;
  capabilities: ReturnType<typeof getEditorCapabilities>;
  content: string; normalized: string;
}
const removals = new Map<string, Removal>();
const scheduled = new Set<string>();
let decisions = Promise.resolve();
let operations = Promise.resolve();
let listening = false;
const identity = (path: string) => normalizePath(path).toLowerCase();
const warn = (error: unknown) => showToast(String(error), 'warning', 6000);

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
  // Keep in-flight receipts reachable by the save barrier until rollback ends.
  if (record.inFlight || record.ticket) return;
  if (removals.get(identity(record.path)) === record) removals.delete(identity(record.path));
  if (!removals.size && listening) {
    off('document-saved', documentSaved);
    off('document-session-ended', sessionEnded);
    listening = false;
  }
}

function enqueue(action: () => Promise<void>): Promise<void> {
  const result = operations.then(action);
  operations = result.catch(() => {});
  return result;
}

async function restore(record: Removal) {
  if (record.ticket) {
    // Failure preserves the ticket and rejects the save barrier for retry.
    await restoreDocumentImage(record.ticket);
    record.ticket = undefined;
    emit('image-file-restored', { path: record.path });
    void refreshExplorerAfterWrite(record.path);
  }
  if (!record.removed) forget(record);
}

/** Reconcile authoritative Markdown independently of the mounted editor mode.
 * Invalidates pending deletion synchronously; resolves only after native restore
 * (including in-flight recycling) succeeds. Writes must await this barrier.
 * History callers may enqueue it without awaiting and report its rejection. */
export function restoreImageAssetsForContent(docKey: string, content: string): Promise<void> {
  if (!removals.size || !useDocumentStore.getState().getDocument(docKey)) return Promise.resolve();
  const normalized = normalizeImageReferenceText(content, useDocumentStore.getState().getDocument(docKey)?.kind === 'noteboard');
  // A peer may paste a reference after cleanup. The same save barrier restores
  // its asset too; ownership belongs to the receipt, not the active editor view.
  const referenced = [...removals.values()].filter(record => mayReferenceImage(normalized, record.path));
  if (!referenced.length) return Promise.resolve();
  for (const record of referenced) {
    record.removed = false;
    record.approved = false;
    record.savedRevision = undefined;
  }
  return enqueue(async () => {
    for (const record of referenced) await restore(record);
  });
}

/** Undo history survives rename/Save As, while native recycle receipts refer to
 * the old filesystem location. Resolve those receipts before moving a directory
 * or ending the old session so that undo never revives a dangling image link. */
export function prepareImageAssetsForIdentity(docKey: string): Promise<void> {
  const records = [...removals.values()].filter(record => record.docKey === docKey);
  if (!records.length) return Promise.resolve();
  for (const record of records) {
    record.removed = false;
    record.approved = false;
    record.savedRevision = undefined;
  }
  return enqueue(async () => { for (const record of records) await restore(record); });
}

function evidenceCurrent(evidence: Evidence): boolean {
  const doc = useDocumentStore.getState().getDocument(evidence.key);
  return Boolean(doc) && getSessionGeneration(evidence.key) === evidence.generation
    && getDocumentRevision(evidence.key) === evidence.revision
    && getEditorCapabilities(evidence.key) === evidence.capabilities
    && doc?.content === evidence.content;
}

function referenceDocuments() {
  return [...useDocumentStore.getState().documents.values()]
    .filter(doc => doc.kind === 'markdown' || doc.kind === 'noteboard' || /\.(?:html?|mdx)$/i.test(doc.key));
}

function allEvidenceCurrent(evidence: Evidence[]): boolean {
  const docs = referenceDocuments();
  const keys = new Set(evidence.map(item => item.key));
  return docs.length === evidence.length && docs.every(doc => keys.has(doc.key))
    && evidence.every(evidenceCurrent);
}

/** Unknown/stale/failed captures are not negative reference evidence. Never mount
 * a background kernel merely to authorize cleanup. */
async function captureReferences(): Promise<Evidence[]> {
  const { hasPendingSnapshot } = await import('./visualSnapshot');
  const evidence: Evidence[] = [];
  for (const doc of referenceDocuments()) {
    const generation = getSessionGeneration(doc.key);
    const revision = getDocumentRevision(doc.key);
    const capabilities = getEditorCapabilities(doc.key);
    let content: string | null = doc.content;
    if (capabilities) {
      const captured = await capabilities.flush('save');
      if (!captured || captured.content === null || captured.docKey !== doc.key
        || captured.instanceId !== capabilities.instanceId || captured.revision !== revision) {
        throw new Error('无法确认已打开文档的最新图片引用，已保留文件');
      }
      content = captured.content;
    } else if (hasPendingSnapshot(doc.key)) {
      content = null;
    }
    const normalized = content === null ? null : normalizeImageReferenceText(content, doc.kind === 'noteboard');
    if (content === null || normalized === null) throw new Error('文档正文或图片引用尚无法确认，已保留文件');
    const item = { key: doc.key, generation, revision, capabilities, content, normalized };
    if (!evidenceCurrent(item)) throw new Error('文档在引用检查期间发生变化，已保留文件');
    evidence.push(item);
  }
  return evidence;
}

/** Same-save candidates share peer flushes and a native scan; never retain
 * negative reference evidence across revisions. */
async function recycleAfterSave(docKey: string, generation: number, revision: number) {
  const eligible = () => [...removals.values()].filter(record => record.docKey === docKey
    && record.generation === generation && record.savedRevision === revision
    && record.approved && !record.ticket && active(record));
  if (!eligible().length || getDocumentRevision(docKey) !== revision || getSavedRevision(docKey) !== revision) return;
  const evidence = await captureReferences();
  const pending = eligible();
  const candidates = pending.filter(record => !evidence.some(item => mayReferenceImage(item.normalized, record.path)));
  if (candidates.length !== pending.length) warn('已打开的文档仍可能引用图片，已保留相关文件');
  if (!candidates.length) return;
  if (!allEvidenceCurrent(evidence) || getSavedRevision(docKey) !== revision) return;
  for (const record of candidates) { record.inFlight = true; record.savedRevision = undefined; }
  try {
    const results = await recycleDocumentImages(docKey, candidates.map(record => record.path),
      useSettingsStore.getState().settings.file.imageDirName || 'img', useExplorerStore.getState().root);
    const rollback = new Set<string>();
    const byPath = new Map(candidates.map(record => [identity(record.path), record]));
    // Install every receipt first: failed restoration must not lose later items.
    for (const result of results) {
      const record = byPath.get(identity(result.path));
      if (!record) continue;
      if (result.ticket) record.ticket = result.ticket;
      if (result.error) { warn(result.error); rollback.add(identity(record.path)); }
    }
    const evidenceChanged = !allEvidenceCurrent(evidence) || getSavedRevision(docKey) !== revision;
    const failures: unknown[] = [];
    for (const record of candidates) {
      if (record.ticket) void refreshExplorerAfterWrite(record.path);
      // New input during native I/O invalidates the negative reference evidence.
      if (record.ticket && (evidenceChanged || !active(record) || rollback.has(identity(record.path)))) {
        try { await restore(record); } catch (error) { failures.push(error); }
      }
    }
    if (failures.length) throw failures[0];
  } finally {
    for (const record of candidates) { record.inFlight = false; if (!record.removed) forget(record); }
  }
}

function scheduleBatch(docKey: string, generation: number, revision: number) {
  const key = `${generation}:${revision}:${docKey}`;
  if (scheduled.has(key)) return;
  scheduled.add(key);
  queueMicrotask(() => {
    // Wait for already queued decisions so one deletion gesture gets one batch.
    void decisions.then(() => enqueue(() => recycleAfterSave(docKey, generation, revision)))
      .catch(warn).finally(() => scheduled.delete(key));
  });
}

function documentSaved({ key, generation }: { key: string; generation: number }) {
  const revision = getSavedRevision(key);
  for (const record of removals.values()) {
    if (record.docKey !== key || record.generation !== generation) continue;
    record.savedRevision = revision;
  }
  scheduleBatch(key, generation, revision);
}

function sessionEnded({ key }: { key: string }) {
  for (const record of removals.values()) {
    if (record.docKey !== key) continue;
    record.removed = false;
    // Completed deletions remain in the system recycle bin on normal close.
    // Pending restoration/in-flight deletion retains the receipt until settled.
    if (!record.inFlight && record.ticket && !record.approved) continue;
    if (!record.inFlight) record.ticket = undefined;
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
  if (record.savedRevision !== undefined) scheduleBatch(record.docKey, record.generation, record.savedRevision);
}

/** Only semantic visual deletion creates candidates. Source/history restoration
 * cancels or restores existing candidates without creating new ones. */
export function reconcileImageAssets(
  docKey: string, removed: Set<string>, added: Set<string>, stillReferenced: (src: string) => boolean,
): void {
  for (const src of added) {
    const path = managedPath(docKey, src);
    const record = path ? removals.get(identity(path)) : undefined;
    if (!record) continue;
    record.removed = false;
    record.approved = false;
    record.savedRevision = undefined;
    void enqueue(() => restore(record)).catch(warn);
  }
  for (const src of removed) {
    if (stillReferenced(src)) continue;
    const path = managedPath(docKey, src);
    if (!path) continue;
    const existing = removals.get(identity(path));
    if (existing?.removed) continue;
    const record: Removal = existing ?? { docKey, path, src, generation: getSessionGeneration(docKey),
      removed: true, approved: false, stillReferenced };
    record.removed = true;
    record.approved = false;
    record.savedRevision = undefined;
    record.stillReferenced = stillReferenced;
    removals.set(identity(path), record);
    if (!listening) {
      on('document-saved', documentSaved);
      on('document-session-ended', sessionEnded);
      listening = true;
    }
    const decision = decisions.then(() => decide(record));
    decisions = decision.catch(warn);
  }
}
