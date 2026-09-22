import type { Editor } from '@tiptap/core';
import { TextSelection, type Transaction } from '@tiptap/pm/state';
import { MapMode, StateEffect } from '@codemirror/state';
import { ViewPlugin, type EditorView, type ViewUpdate } from '@codemirror/view';
import { getEditorCapabilities } from '../../core/editor/editorRegistry';
import { useDocumentStore } from '../../stores/documentStore';
import { useWindowStore } from '../../stores/windowStore';
import { getSessionGeneration, isClosing } from '../session/documentSession';
import { getMdSourceView, getMdTipTapEditor } from './editorInstances';

export interface InsertedImage { src: string; alt: string }
interface Target {
  current(): boolean;
  insert(image: InsertedImage): boolean;
  track(cancel: () => void): () => void;
}
export interface ImageInsertionLease {
  docKey: string;
  directory: string | null;
  signal: AbortSignal;
  current(): boolean;
  commit(image: InsertedImage): boolean;
  dispose(): void;
}

/** Loss of active ownership is permanent, even if the same path/tab is reopened later. */
function captureLease(docKey: string, target: Target): ImageInsertionLease | null {
  const document = useDocumentStore.getState().getDocument(docKey);
  if (!document) return null;
  const generation = getSessionGeneration(docKey);
  const capabilities = getEditorCapabilities(docKey);
  const directory = document.dirPath ?? null;
  const tab = useWindowStore.getState().tabs.find(item => item.key === docKey);
  if (!tab) return null;
  const mode = tab.viewMode;
  const controller = new AbortController();
  let disposed = false;
  const ownsIdentity = () => {
    const doc = useDocumentStore.getState().getDocument(docKey);
    const tabs = useWindowStore.getState();
    return Boolean(doc) && generation === getSessionGeneration(docKey)
      && (doc?.dirPath ?? null) === directory && getEditorCapabilities(docKey) === capabilities
      && tabs.activeKey === docKey && !tabs.isWindowClosing && !tabs.isTransferring(docKey)
      && !tabs.pendingCloseKeys.includes(docKey) && !isClosing(docKey)
      && tabs.tabs.find(tab => tab.key === docKey)?.viewMode === mode && target.current();
  };
  if (!ownsIdentity()) return null;
  const cancel = () => controller.abort();
  const changed = () => { if (!ownsIdentity()) cancel(); };
  const stopDocument = useDocumentStore.subscribe(changed);
  const stopWindow = useWindowStore.subscribe(changed);
  const stopTarget = target.track(cancel);
  const dispose = () => {
    if (disposed) return;
    disposed = true; stopDocument(); stopWindow(); stopTarget();
  };
  const current = () => !disposed && !controller.signal.aborted && ownsIdentity();
  return { docKey, directory, signal: controller.signal, current, dispose,
    commit(image) {
      if (!current()) return false;
      // No await between proof and insertion. The insertion's own transaction must
      // not invalidate the lease before it can publish its success.
      dispose();
      return target.insert(image);
    },
  };
}

export function captureVisualImageInsertion(editor: Editor, docKey: string, position?: number): ImageInsertionLease | null {
  const selection = position === undefined ? editor.state.selection
    : TextSelection.near(editor.state.doc.resolve(Math.max(0, Math.min(position, editor.state.doc.content.size))));
  let bookmark = selection.getBookmark();
  let from = selection.from, to = selection.to;
  return captureLease(docKey, {
    current: () => !editor.isDestroyed && editor.isEditable && getMdTipTapEditor(docKey) === editor && !editor.view.dom.closest('[inert]'),
    insert: image => editor.chain().command(({ tr }) => {
      tr.setSelection(bookmark.resolve(tr.doc)); return true;
    }).setImage(image).focus().run(),
    track: cancel => {
      const update = ({ transaction, appendedTransactions }: { transaction: Transaction; appendedTransactions: Transaction[] }) => {
        for (const tr of [transaction, ...appendedTransactions]) {
          if (!tr.docChanged) continue;
          const start = tr.mapping.mapResult(from, 1), end = tr.mapping.mapResult(to, -1);
          if (tr.getMeta('noteboard-document-replacement') || start.deletedAcross || end.deletedAcross || (from < to && start.deleted && end.deleted)) { cancel(); return; }
          bookmark = bookmark.map(tr.mapping);
          const mapped = bookmark.resolve(tr.doc); from = mapped.from; to = mapped.to;
        }
      };
      editor.on('transaction', update); editor.on('destroy', cancel);
      return () => { editor.off('transaction', update); editor.off('destroy', cancel); };
    },
  });
}

interface SourceTracker { update(value: ViewUpdate): void; cancel(): void }
const sourceTargets = new WeakMap<EditorView, Set<SourceTracker>>();
const sourceTracking = ViewPlugin.define(view => ({
  update(value: ViewUpdate) { if (value.docChanged) for (const target of sourceTargets.get(view) ?? []) target.update(value); },
  destroy() { for (const target of sourceTargets.get(view) ?? []) target.cancel(); sourceTargets.delete(view); },
}));

export function captureSourceImageInsertion(view: EditorView, docKey: string): ImageInsertionLease | null {
  let range = view.state.selection.main;
  return captureLease(docKey, {
    current: () => getMdSourceView(docKey) === view && !view.dom.closest('[inert]'),
    insert: image => {
      const alt = image.alt.replace(/[\[\]\\]/g, '\\$&');
      const src = image.src.replace(/\\/g, '/').replace(/>/g, '%3E').replace(/[\r\n]/g, '');
      const snippet = `![${alt}](<${src}>)`;
      view.dispatch({ changes: { from: range.from, to: range.to, insert: snippet }, selection: { anchor: range.from + snippet.length } });
      view.focus(); return true;
    },
    track: cancel => {
      if (!view.plugin(sourceTracking)) view.dispatch({ effects: StateEffect.appendConfig.of(sourceTracking) });
      let targets = sourceTargets.get(view);
      if (!targets) { targets = new Set(); sourceTargets.set(view, targets); }
      const target: SourceTracker = { cancel, update(value) {
        let removed = false;
        value.changes.iterChangedRanges((from, to) => {
          if (to > from && ((range.from < range.to && from <= range.from && to >= range.to)
            || (from === 0 && to === value.startState.doc.length))) removed = true;
        });
        if (removed) { cancel(); return; }
        if (value.changes.mapPos(range.anchor, 1, MapMode.TrackDel) === null || value.changes.mapPos(range.head, -1, MapMode.TrackDel) === null) { cancel(); return; }
        range = range.map(value.changes, 1);
      } };
      targets.add(target);
      return () => { targets.delete(target); if (!targets.size) sourceTargets.delete(view); };
    },
  });
}
