import type { Editor } from '@tiptap/core';
import { NodeSelection, TextSelection, type Selection, type Transaction } from '@tiptap/pm/state';
import { Fragment, Slice } from '@tiptap/pm/model';
import { MapMode, StateEffect } from '@codemirror/state';
import { ViewPlugin, type EditorView, type ViewUpdate } from '@codemirror/view';
import { getEditorCapabilities } from '../../core/editor/editorRegistry';
import { useDocumentStore } from '../../stores/documentStore';
import { useWindowStore } from '../../stores/windowStore';
import { getSessionGeneration, isClosing } from '../session/documentSession';
import { getMdSourceView, getMdTipTapEditor } from './editorInstances';
import { dispatchDiscreteEdit } from './discreteEdit';
import { ensureContainerTail } from './containerEditing';
import { revealInsertedImage } from './imageInsertionScroll';

export interface InsertedImage { src: string; alt: string }
export interface InsertionTarget<T> {
  current(): boolean;
  insert(value: T): boolean;
  track(cancel: () => void): () => void;
}
export interface InsertionLease<T> {
  docKey: string;
  directory: string | null;
  signal: AbortSignal;
  current(): boolean;
  commit(value: T): boolean;
  dispose(): void;
}
export type ImageInsertionLease = InsertionLease<InsertedImage | InsertedImage[]>;

/** Loss of active ownership is permanent, even if the same path/tab is reopened later. */
export function captureDocumentInsertion<T>(docKey: string, target: InsertionTarget<T>): InsertionLease<T> | null {
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
    disposed = true; stopDocument(); stopWindow(); stopTarget(); controller.abort();
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

export function captureVisualInsertion<T>(editor: Editor, docKey: string, insert: (value: T, selection: Selection, position?: number) => boolean, position?: number): InsertionLease<T> | null {
  const selection = position === undefined ? editor.state.selection
    : TextSelection.near(editor.state.doc.resolve(Math.max(0, Math.min(position, editor.state.doc.content.size))));
  let bookmark = selection.getBookmark();
  let from = selection.from, to = selection.to;
  let rawPosition = position;
  // Empty slots have no text selection of their own. Track their enclosing node
  // independently so deleting/replacing it cannot redirect pending image IO.
  let slotRange: { from: number; to: number } | undefined;
  if (position !== undefined) {
    const $pos = editor.state.doc.resolve(position);
    for (let depth = $pos.depth; depth > 0; depth--) if ($pos.node(depth).type.name === 'imageSlot') {
      slotRange = { from: $pos.before(depth), to: $pos.after(depth) }; break;
    }
  }
  return captureDocumentInsertion(docKey, {
    current: () => !editor.isDestroyed && editor.isEditable && getMdTipTapEditor(docKey) === editor && !editor.view.dom.closest('[inert]'),
    insert: value => insert(value, bookmark.resolve(editor.state.doc), rawPosition),
    track: cancel => {
      const update = ({ transaction, appendedTransactions }: { transaction: Transaction; appendedTransactions: Transaction[] }) => {
        for (const tr of [transaction, ...appendedTransactions]) {
          if (!tr.docChanged) continue;
          if (slotRange) {
            const start = tr.mapping.mapResult(slotRange.from, 1), end = tr.mapping.mapResult(slotRange.to, -1);
            if (start.deletedAcross || end.deletedAcross || (start.deleted && end.deleted)) { cancel(); return; }
            slotRange = { from: start.pos, to: end.pos };
          }
          const start = tr.mapping.mapResult(from, 1), end = tr.mapping.mapResult(to, -1);
          if (rawPosition !== undefined) { const mapped = tr.mapping.mapResult(rawPosition, 1); if (mapped.deletedAcross) { cancel(); return; } rawPosition = mapped.pos; }
          if (tr.getMeta('noteboard-document-replacement') || (rawPosition === undefined && (start.deletedAcross || end.deletedAcross || (from < to && start.deleted && end.deleted)))) { cancel(); return; }
          bookmark = bookmark.map(tr.mapping);
          const mapped = bookmark.resolve(tr.doc); from = mapped.from; to = mapped.to;
        }
      };
      editor.on('transaction', update); editor.on('destroy', cancel);
      return () => { editor.off('transaction', update); editor.off('destroy', cancel); };
    },
  });
}

/** Fill empty slots in order, append capacity, and preserve all existing captions. */
export function insertVisualImages(editor: Editor, images: InsertedImage[], selection: Selection, position?: number): boolean {
  return insertViewImages(editor.view, images, selection, position);
}
export function insertViewImages(view: import('@tiptap/pm/view').EditorView, images: InsertedImage[], selection: Selection, position?: number): boolean {
  const schema = view.state.schema;
  if (!images.length || !schema.nodes.image) return false;
  const tr = view.state.tr, raw = Math.max(0, Math.min(position ?? selection.from, tr.doc.content.size));
  const $pos = tr.doc.resolve(raw);
  let firstImage: number | undefined;
  let slotDepth = -1;
  for (let depth = $pos.depth; depth > 0; depth--) if ($pos.node(depth).type.name === 'imageSlot') { slotDepth = depth; break; }
  if (slotDepth >= 0 && $pos.node(slotDepth - 1).type.name === 'imageCollection') {
    const collection = $pos.node(slotDepth - 1), collectionPos = $pos.before(slotDepth - 1), slotIndex = $pos.index(slotDepth - 1);
    const appended = []; let next = 0, offset = 0;
    for (let index = 0; index < collection.childCount; index++) {
      const slot = collection.child(index);
      if (index >= slotIndex && next < images.length && slot.firstChild?.type.name !== 'image') {
        const position = collectionPos + 1 + offset;
        tr.replaceWith(tr.mapping.map(position, 1), tr.mapping.map(position + slot.nodeSize, -1), slot.copy(Fragment.from(schema.nodes.image.create(images[next++])).append(slot.content)));
      }
      offset += slot.nodeSize;
    }
    while (next < images.length) appended.push(schema.nodes.imageSlot.create(null, schema.nodes.image.create(images[next++])));
    if (appended.length) tr.insert(tr.mapping.map(collectionPos + collection.nodeSize - 1, -1), appended);
  } else {
    const content = Fragment.from(images.map(image => schema.nodes.image.create(image)));
    if (position !== undefined && $pos.parent.canReplace($pos.index(), $pos.index(), content)) {
      tr.insert(raw, content);
      tr.setSelection(NodeSelection.create(tr.doc, raw));
    }
    else tr.setSelection(selection).replaceSelection(new Slice(content, 0, 0));
    tr.mapping.maps[0]?.forEach((_from, _to, from, to) => {
      tr.doc.nodesBetween(from, to, (node, pos) => {
        if (firstImage !== undefined) return false;
        if (node.type.name === 'image') { firstImage = pos; return false; }
      });
    });
    if (firstImage !== undefined) tr.setSelection(NodeSelection.create(tr.doc, firstImage));
    ensureContainerTail(tr, raw);
  }
  // Pointer-targeted drops/pastes are already in view. Scrolling the previous
  // caret can jump to a different paragraph; image decode must not pull it back.
  dispatchDiscreteEdit(view, tr);
  view.focus();
  if (position === undefined && firstImage !== undefined) revealInsertedImage(view, firstImage);
  return true;
}

export function captureVisualImageInsertion(editor: Editor, docKey: string, position?: number): ImageInsertionLease | null {
  return captureVisualInsertion<InsertedImage | InsertedImage[]>(editor, docKey, (value, selection, mappedPosition) => insertVisualImages(editor, Array.isArray(value) ? value : [value], selection, mappedPosition), position);
}

interface SourceTracker { update(value: ViewUpdate): void; cancel(): void }
const sourceTargets = new WeakMap<EditorView, Set<SourceTracker>>();
const sourceTracking = ViewPlugin.define(view => ({
  update(value: ViewUpdate) { if (value.docChanged) for (const target of sourceTargets.get(view) ?? []) target.update(value); },
  destroy() { for (const target of sourceTargets.get(view) ?? []) target.cancel(); sourceTargets.delete(view); },
}));

export function captureSourceImageInsertion(view: EditorView, docKey: string): ImageInsertionLease | null {
  let range = view.state.selection.main;
  return captureDocumentInsertion(docKey, {
    current: () => getMdSourceView(docKey) === view && !view.dom.closest('[inert]'),
    insert: value => {
      const images = Array.isArray(value) ? value : [value];
      const snippet = images.map(image => {
      const alt = image.alt.replace(/[[\]\\]/g, '\\$&');
      const src = image.src.replace(/\\/g, '/').replace(/>/g, '%3E').replace(/[\r\n]/g, '');
        return `![${alt}](<${src}>)`;
      }).join('\n\n');
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
