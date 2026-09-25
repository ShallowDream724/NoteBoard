import type { Editor, JSONContent } from '@tiptap/core';
import { Fragment } from '@tiptap/pm/model';
import { NodeSelection, type Selection } from '@tiptap/pm/state';
import { dispatchDiscreteEdit } from '../discreteEdit';
import { annotationAnchors, annotationBodyContent, annotationId, collectAnnotations, newAnnotationId } from './model';
import { captureAnnotationTarget, type AnnotationDraftTarget } from './draftTarget';
import { editorSupportsCapability, runWithDocumentCapability } from '../../document-format/featureGate';
import { BlockMetadataStep } from '../blockMetadataStep';
import { annotationIndexKey } from './extension';

export const ANNOTATION_OPEN_EVENT = 'nb-open-annotation';
export const ANNOTATION_BEGIN_EVENT = 'nb-begin-annotation';
export interface AnnotationBeginRequest { id: string; target: AnnotationDraftTarget }
/** UI creation starts with a local draft. Only its explicit Save changes the document. */
export function beginAnnotation(editor: Editor): string | null {
  if (!canAddAnnotation(editor)) return null;
  if (!editorSupportsCapability(editor, 'annotation')) { runWithDocumentCapability(editor, 'annotation', next => { beginAnnotation(next); }); return null; }
  const id = newAnnotationId();
  editor.view.dom.dispatchEvent(new CustomEvent<AnnotationBeginRequest>(ANNOTATION_BEGIN_EVENT, { detail: { id, target: captureAnnotationTarget(editor.state.selection) } }));
  return id;
}
/** Capture the block directly: tableEditing normalizes a dispatched table
 * NodeSelection into cells, so the editor's current selection is not a target. */
export function beginBlockAnnotation(editor: Editor, pos: number): string | null {
  if (editor.isDestroyed || !editor.state.doc.nodeAt(pos)?.isBlock) return null;
  const selection = NodeSelection.create(editor.state.doc, pos);
  if (!canAddAnnotation(editor, selection)) return null;
  if (!editorSupportsCapability(editor, 'annotation')) { runWithDocumentCapability(editor, 'annotation', next => { beginBlockAnnotation(next, pos); }); return null; }
  const id = newAnnotationId();
  editor.view.dom.dispatchEvent(new CustomEvent<AnnotationBeginRequest>(ANNOTATION_BEGIN_EVENT, { detail: { id, target: captureAnnotationTarget(selection) } }));
  return id;
}
export function openAnnotation(editor: Editor, id: string, options: { edit?: boolean } = {}) {
  if (options.edit && !editorSupportsCapability(editor, 'annotation')) { runWithDocumentCapability(editor, 'annotation', next => openAnnotation(next, id, options)); return; }
  editor.view.dom.dispatchEvent(new CustomEvent(ANNOTATION_OPEN_EVENT, { detail: { id, edit: options.edit ?? false } }));
}

export function selectedAnnotationId(editor: Editor, selection = editor.state.selection): string | null {
  const { doc } = editor.state;
  if (selection instanceof NodeSelection) return annotationId(selection.node.attrs.annotationId);
  const mark = selection.$from.marks().find(value => value.type.name === 'annotationReference');
  if (mark) return annotationId(mark.attrs.id);
  let found: string | null = null;
  if (!selection.empty) doc.nodesBetween(selection.from, selection.to, node => {
    found ??= annotationId(node.marks.find(value => value.type.name === 'annotationReference')?.attrs.id) ?? annotationId(node.attrs.annotationId);
    return !found;
  });
  for (let depth = selection.$from.depth; !found && depth > 0; depth--) found = annotationId(selection.$from.node(depth).attrs.annotationId);
  return found;
}

export function canAddAnnotation(editor: Editor, selection = editor.state.selection): boolean {
  const { schema } = editor.state;
  if (!schema.nodes.annotationStore || !schema.marks.annotationReference || selection.empty || selectedAnnotationId(editor, selection)) return false;
  for (let depth = selection.$from.depth; depth > 0; depth--) if (selection.$from.node(depth).type.name.startsWith('annotation')) return false;
  if (selection instanceof NodeSelection) return Object.hasOwn(selection.node.attrs, 'annotationId');
  let suitable = false;
  editor.state.doc.nodesBetween(selection.from, selection.to, (node, _pos, parent) => {
    if (suitable || node.type.name === 'annotationStore') return false;
    suitable = (node.isInline && !!parent?.type.allowsMarkType(schema.marks.annotationReference))
      || (node.isLeaf && node.isBlock && Object.hasOwn(node.attrs, 'annotationId'));
  });
  return suitable;
}

export function addAnnotation(editor: Editor, content: JSONContent[] = [{ type: 'paragraph' }], options: { id?: string; selection?: Selection; open?: boolean } = {}): string | null {
  if (!editorSupportsCapability(editor, 'annotation')) { runWithDocumentCapability(editor, 'annotation', next => { addAnnotation(next, content, { ...options, selection: undefined }); }); return null; }
  const { state } = editor, { schema } = state, selection = options.selection ?? state.selection;
  if (!canAddAnnotation(editor, selection)) return null;
  const id = options.id === undefined ? newAnnotationId() : annotationId(options.id);
  if (!id || (options.id !== undefined && collectAnnotations(state.doc).has(id))) return null;
  let body;
  try { body = schema.nodes.annotationBody.createChecked({ id }, Fragment.fromArray(annotationBodyContent(content).map(node => schema.nodeFromJSON(node)))); }
  catch { return null; }
  const tr = state.tr;
  if (selection instanceof NodeSelection) tr.step(new BlockMetadataStep(selection.from, 'annotationId', id));
  else {
    state.doc.nodesBetween(selection.from, selection.to, (node, pos) => {
      if (node.type.name === 'annotationStore' || node.type.name === 'annotationBody') return false;
      if (node.isInline) tr.addMark(Math.max(pos, selection.from), Math.min(pos + node.nodeSize, selection.to), schema.marks.annotationReference.create({ id }));
      if (node.isLeaf && node.isBlock && Object.hasOwn(node.attrs, 'annotationId')) tr.setNodeMarkup(pos, undefined, { ...node.attrs, annotationId: id });
    });
  }
  if (selection instanceof NodeSelection ? tr.doc.nodeAt(selection.from)?.attrs.annotationId !== id : !annotationAnchors(tr.doc).some(anchor => anchor.id === id)) return null;
  let storeEnd: number | null = null;
  tr.doc.forEach((node, pos) => { if (node.type.name === 'annotationStore') storeEnd = pos + node.nodeSize - 1; });
  if (storeEnd !== null) tr.insert(storeEnd, body);
  else tr.insert(tr.doc.firstChild?.type.name === 'documentPresentation' ? tr.doc.firstChild.nodeSize : 0, schema.nodes.annotationStore.createChecked(null, body));
  dispatchDiscreteEdit(editor.view, tr);
  if (options.open !== false) openAnnotation(editor, id, { edit: true });
  return id;
}

export function updateAnnotation(editor: Editor, id: string, content: JSONContent[]): boolean {
  if (!editorSupportsCapability(editor, 'annotation')) return runWithDocumentCapability(editor, 'annotation', next => updateAnnotation(next, id, content));
  const record = collectAnnotations(editor.state.doc).get(id); if (!record) return false;
  let replacement;
  try { replacement = record.node.type.createChecked({ id }, Fragment.fromArray(annotationBodyContent(content).map(node => editor.schema.nodeFromJSON(node)))); }
  catch { return false; }
  if (replacement.eq(record.node)) return true;
  dispatchDiscreteEdit(editor.view, editor.state.tr.replaceWith(record.pos, record.pos + record.node.nodeSize, replacement));
  return true;
}

export function removeAnnotation(editor: Editor, id: string): boolean {
  const { state } = editor, record = collectAnnotations(state.doc).get(id);
  const anchors = (annotationIndexKey.getState(state)?.anchors ?? annotationAnchors(state.doc)).filter(anchor => anchor.id === id);
  if (!record && !anchors.length) return false;
  const tr = state.tr;
  for (const anchor of anchors) {
    if (anchor.block) tr.step(new BlockMetadataStep(anchor.from, 'annotationId', null));
    else tr.removeMark(anchor.from, anchor.to, state.schema.marks.annotationReference.create({ id }));
  }
  if (record) {
    const parent = state.doc.resolve(record.pos).parent;
    if (parent.childCount === 1) tr.delete(record.pos - 1, record.pos + record.node.nodeSize + 1);
    else tr.delete(record.pos, record.pos + record.node.nodeSize);
  }
  dispatchDiscreteEdit(editor.view, tr);
  return true;
}
