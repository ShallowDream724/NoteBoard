import type { Editor } from '@tiptap/core';
import type { Transaction } from '@tiptap/pm/state';
import { save } from '@tauri-apps/plugin-dialog';
import { emit, on, off } from '../../core/emitter';
import { resolveRelativeDocPath } from '../../core/documentPath';
import { writeImageEdit } from '../../core/ipc/commands';
import { getDocumentRevision } from '../../core/editor/editorRegistry';
import { useDocumentStore } from '../../stores/documentStore';
import { useWindowStore } from '../../stores/windowStore';
import { showToast } from '../../stores/toastStore';
import { getMdTipTapEditor, subscribeMdTipTapEditors } from '../editor-md/editorInstances';
import { dispatchDiscreteEdit } from '../editor-md/discreteEdit';
import { publishImageAsset, storeTransientImage } from '../editor-md/imageAssetStorage';
import { sameKey } from '../explorer/pathUtils';
import { refreshExplorerAfterWrite } from '../explorer/refreshAfterWrite';
import { noteSelfWrite } from '../explorer/directoryWatcher';
import { enqueueDocumentWrite, getSessionGeneration, isClosing } from '../session/documentSession';
import type { ImageEditorSaveMetadata } from './index';

type ImageEditorModule = typeof import('./index');
interface Target {
  kind: 'document' | 'file';
  key: string;
  docKey: string;
  generation: number;
  source: string;
  position?: number;
  editor?: Editor;
  suspendedRevision?: number;
  attempt: number;
}
interface EditorTargets { targets: Set<Target>; dispose(): void }
const targets = new Map<string, Target>();
const editors = new Map<Editor, EditorTargets>();
let nextTarget = 0;
let activeEpoch = 0;
let ui: ImageEditorModule | undefined;
let stopLifecycle: (() => void) | undefined;

function currentDocument(target: Target, active = false): boolean {
  const window = useWindowStore.getState();
  return targets.get(target.key) === target
    && getSessionGeneration(target.docKey) === target.generation
    && useDocumentStore.getState().hasDocument(target.docKey)
    && window.tabs.some(tab => tab.key === target.docKey)
    && (!active || (window.activeKey === target.docKey && !window.isWindowClosing
      && !window.pendingCloseKeys.includes(target.docKey) && !window.isTransferring(target.docKey) && !isClosing(target.docKey)));
}

function currentImage(target: Target, active = false): boolean {
  const editor = target.editor;
  return currentDocument(target, active) && !!editor && !editor.isDestroyed
    && getMdTipTapEditor(target.docKey) === editor
    && (!active || (editor.isEditable && !editor.view.dom.closest('[inert]')
      && useWindowStore.getState().getTab(target.docKey)?.viewMode !== 'source'))
    && target.position !== undefined && editor.state.doc.nodeAt(target.position)?.type.name === 'image'
    && editor.state.doc.nodeAt(target.position)?.attrs.src === target.source;
}

function discardTarget(target: Target): void {
  targets.delete(target.key);
  target.attempt++;
  ui?.discardImageEditor(target.key);
  const tracker = target.editor && editors.get(target.editor);
  tracker?.targets.delete(target);
  if (tracker && !tracker.targets.size) tracker.dispose();
  if (!targets.size) { stopLifecycle?.(); stopLifecycle = undefined; }
}

/** Only edited images allocate tracking. A document has one transaction listener,
 * regardless of how many images it contains or how often the editor is reopened. */
function trackEditor(editor: Editor): EditorTargets {
  const existing = editors.get(editor); if (existing) return existing;
  const tracked = new Set<Target>();
  const changed = ({ transaction, appendedTransactions }: { transaction: Transaction; appendedTransactions: Transaction[] }) => {
    for (const tr of [transaction, ...appendedTransactions]) {
      if (!tr.docChanged) continue;
      for (const target of [...tracked]) {
        const at = target.position!;
        const before = tr.before.nodeAt(at);
        const start = tr.mapping.mapResult(at, 1);
        const end = tr.mapping.mapResult(at + (before?.nodeSize ?? 1), -1);
        if (tr.getMeta('noteboard-document-replacement') || start.deletedAcross || end.deletedAcross
          || (start.deleted && end.deleted)) { discardTarget(target); continue; }
        target.position = start.pos;
        const image = tr.doc.nodeAt(start.pos);
        if (image?.type.name !== 'image' || image.attrs.src !== target.source) discardTarget(target);
      }
    }
  };
  const destroyed = () => {
    for (const target of tracked) {
      target.editor = undefined;
      target.suspendedRevision = getDocumentRevision(target.docKey);
      target.attempt++;
    }
    tracked.clear(); tracker.dispose(); ui?.suspendImageEditor();
  };
  const tracker = { targets: tracked, dispose() {
    editor.off('transaction', changed); editor.off('destroy', destroyed); editors.delete(editor);
  } };
  editors.set(editor, tracker); editor.on('transaction', changed); editor.on('destroy', destroyed);
  return tracker;
}

function ensureLifecycle(): void {
  if (stopLifecycle) return;
  const changed = () => { for (const target of [...targets.values()]) if (!currentDocument(target)) discardTarget(target); };
  const stopDocuments = useDocumentStore.subscribe(changed);
  const stopEditors = subscribeMdTipTapEditors((docKey, editor) => attachRemountedEditor(docKey, editor));
  const stopWindow = useWindowStore.subscribe((state, previous) => {
    if (state.activeKey !== previous.activeKey || state.isWindowClosing !== previous.isWindowClosing
      || state.pendingCloseKeys !== previous.pendingCloseKeys || state.transferringKeys !== previous.transferringKeys
      || state.tabs.find(tab => tab.key === state.activeKey)?.viewMode !== previous.tabs.find(tab => tab.key === previous.activeKey)?.viewMode) {
      activeEpoch++; ui?.suspendImageEditor();
    }
    changed();
  });
  const ended = ({ key }: { key: string }) => {
    for (const target of [...targets.values()]) if (target.docKey === key) discardTarget(target);
  };
  on('document-session-ended', ended);
  stopLifecycle = () => { stopDocuments(); stopWindow(); stopEditors(); off('document-session-ended', ended); };
}

function attachRemountedEditor(docKey: string, editor: Editor): void {
  for (const target of [...targets.values()]) {
    if (target.kind !== 'document' || target.docKey !== docKey || target.editor === editor) continue;
    const image = target.position === undefined ? null : editor.state.doc.nodeAt(target.position);
    // A recycled view can recover a recipe only while its exact document revision
    // remains intact. Source edits during suspension cannot redirect an old draft.
    if (target.editor || target.suspendedRevision !== getDocumentRevision(docKey)
      || !currentDocument(target) || image?.type.name !== 'image' || image.attrs.src !== target.source) {
      discardTarget(target); continue;
    }
    target.editor = editor; target.suspendedRevision = undefined;
    trackEditor(editor).targets.add(target);
  }
}

function imageTarget(editor: Editor, docKey: string, position: number): Target | null {
  const image = editor.state.doc.nodeAt(position);
  if (image?.type.name !== 'image' || !image.attrs.src) return null;
  attachRemountedEditor(docKey, editor);
  for (const target of targets.values()) if (target.editor === editor && target.position === position && target.source === image.attrs.src) return target;
  const target: Target = { kind: 'document', key: `document-image:${++nextTarget}`, docKey, generation: getSessionGeneration(docKey),
    position, source: image.attrs.src, editor, attempt: 0 };
  targets.set(target.key, target);
  if (!currentImage(target, true)) { targets.delete(target.key); return null; }
  trackEditor(editor).targets.add(target); ensureLifecycle(); return target;
}

async function replaceDocumentImage(target: Target, blob: Blob, metadata: ImageEditorSaveMetadata, signal?: AbortSignal): Promise<boolean> {
  const attempt = ++target.attempt, epoch = activeEpoch;
  const directory = useDocumentStore.getState().getDocument(target.docKey)?.dirPath ?? '';
  const current = () => !signal?.aborted && target.attempt === attempt && activeEpoch === epoch && currentImage(target, true)
    && (useDocumentStore.getState().getDocument(target.docKey)?.dirPath ?? '') === directory;
  if (!current()) return false;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (!current()) return false;
  const source = await enqueueDocumentWrite(target.docKey, async () => {
    if (!current()) return null;
    return directory && !target.docKey.startsWith('untitled:')
      ? publishImageAsset('', bytes, metadata.extension, target.docKey)
      : storeTransientImage(bytes, `image-edited.${metadata.extension}`, metadata.mimeType);
  });
  if (!source || !current()) return false;
  const editor = target.editor!;
  // Attribute-only steps retain captions, annotations and layout and form one
  // undo group. No await may separate the ownership proof from the transaction.
  const tr = editor.state.tr.setNodeAttribute(target.position!, 'src', source);
  target.source = source;
  dispatchDiscreteEdit(editor.view, tr);
  if (directory) void refreshExplorerAfterWrite(resolveRelativeDocPath(directory, source));
  return true;
}

export async function editDocumentImage(editor: Editor, docKey: string, position: number | undefined, src: string, name?: string): Promise<void> {
  if (position === undefined || !src) return;
  const target = imageTarget(editor, docKey, position); if (!target) return;
  const epoch = activeEpoch;
  try {
    ui = await import('./index');
    if (!currentImage(target, true) || epoch !== activeEpoch) return;
    await ui.openImageEditor({ key: target.key, src, name, saveLabel: '保存到文档',
      onSave: (blob, metadata, signal) => replaceDocumentImage(target, blob, metadata, signal) });
  } catch (error) { showToast(`打开图片编辑器失败：${String(error)}`, 'error'); }
}

/** The original file is retained unless the user explicitly chooses it in Save As. */
export async function editImageFile(docKey: string, filePath: string, src: string, name?: string): Promise<void> {
  let target = [...targets.values()].find(value => value.kind === 'file' && value.docKey === docKey && value.source === filePath);
  if (!target) {
    target = { kind: 'file', key: `image-file:${++nextTarget}`, docKey, source: filePath, generation: getSessionGeneration(docKey), attempt: 0 };
    targets.set(target.key, target);
  }
  if (!currentDocument(target, true)) { discardTarget(target); return; }
  ensureLifecycle();
  const owner = target, epoch = activeEpoch;
  try {
    ui = await import('./index');
    if (!currentDocument(owner, true) || epoch !== activeEpoch) return;
    await ui.openImageEditor({ key: owner.key, src, name, saveLabel: '另存为', onSave: async (blob, metadata, signal) => {
      const attempt = ++owner.attempt, saveEpoch = activeEpoch;
      const current = () => !signal?.aborted && owner.attempt === attempt && activeEpoch === saveEpoch && currentDocument(owner, true);
      if (!current()) return false;
      const basePath = filePath.replace(/\.[^./\\]+$/, '');
      const path = await save({ title: '保存编辑后的图片', defaultPath: `${basePath}-edited.${metadata.extension}`,
        filters: [{ name: metadata.extension.toUpperCase(), extensions: [metadata.extension] }] });
      if (!path || !current()) return false;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (!current()) return false;
      const result = await writeImageEdit(path, bytes);
      if (!result.ok) throw new Error(result.error?.kind === 'io' ? result.error.message : `图片保存失败（${result.error?.kind ?? 'unknown'}）`);
      noteSelfWrite(path);
      if (sameKey(path, filePath)) emit('image-file-restored', { path });
      void refreshExplorerAfterWrite(path);
      showToast('图片已保存', 'success');
      return true;
    } });
  } catch (error) { showToast(`打开图片编辑器失败：${String(error)}`, 'error'); }
}
