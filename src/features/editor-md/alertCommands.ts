import type { Editor } from '@tiptap/core';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { Fragment } from '@tiptap/pm/model';
import { dispatchDiscreteEdit } from './discreteEdit';
import { closeHistory } from '@tiptap/pm/history';
import type { AlertKind } from './alertPresentation';
import { runWithDocumentCapability } from '../document-format/featureGate';
import { calloutAttributes, isAlertKind, isCalloutColor, isCalloutIcon, isCalloutTitle, normalizeAlertInput, type CalloutAttributes } from './calloutPresentation';

/** Replace only the marker's quote and enter its body, preserving the surrounding document. */
export function completeAlert(editor: Editor, kind: AlertKind): boolean {
  const { state, view } = editor;
  const { $from, empty } = state.selection;
  if (!empty || $from.parent.type.name !== 'paragraph' || !/^\[![a-z]*\]?$/i.test(normalizeAlertInput($from.parent.textContent))) return false;
  const quoted = $from.depth >= 2 && $from.node(-1).type.name === 'blockquote' && $from.node(-1).childCount === 1;
  const depth = quoted ? $from.depth - 1 : $from.depth;
  const pos = $from.before(depth);
  const tr = closeHistory(state.tr).replaceWith(pos, $from.after(depth),
    state.schema.nodes.githubAlert.create({ kind }, state.schema.nodes.paragraph.create()));
  view.dispatch(tr.setSelection(TextSelection.create(tr.doc, pos + 2)).scrollIntoView());
  view.focus();
  return true;
}

/** A generic callout uses the existing node, with an explicitly hidden title. */
export function insertCallout(editor: Editor): boolean {
  return runWithDocumentCapability(editor, 'callout', next => next.chain().focus().insertContent({
    type: 'githubAlert', attrs: { title: '' }, content: [{ type: 'paragraph' }],
  }).run());
}

const calloutTextBlocks = new Set(['paragraph', 'heading', 'blockquote', 'bulletList', 'orderedList', 'taskList']);
/** Remove the callout shell without flattening its rich body or nested blocks. */
export function unwrapCallout(editor: Editor, pos: number): boolean {
  const { state, view } = editor, node = state.doc.nodeAt(pos);
  if (node?.type.name !== 'githubAlert') return false;
  const children = [...node.content.content];
  // A custom title is user content; the preset Note/Tip label is presentation.
  const title = typeof node.attrs.title === 'string' ? node.attrs.title.trim() : '';
  if (title) children.unshift(state.schema.nodes.paragraph.create(null, state.schema.text(title)));
  if (node.attrs.annotationId) {
    if (!children[0] || children[0].attrs.annotationId || !('annotationId' in children[0].attrs)) children.unshift(state.schema.nodes.paragraph.create());
    const first = children[0];
    children[0] = first.type.create({ ...first.attrs, annotationId: node.attrs.annotationId }, first.content, first.marks);
  }
  const content = Fragment.fromArray(children), at = state.doc.resolve(pos);
  if (!at.parent.canReplace(at.index(), at.index() + 1, content)) return false;
  view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, pos)));
  const tr = editor.state.tr.replaceWith(pos, pos + node.nodeSize, content);
  tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 1)));
  dispatchDiscreteEdit(view, tr); return true;
}
export function canWrapBlockInCallout(editor: Editor, pos: number): boolean {
  const block = editor.state.doc.nodeAt(pos), type = editor.schema.nodes.githubAlert;
  if (!block || !type || !calloutTextBlocks.has(block.type.name)) return false;
  const $pos = editor.state.doc.resolve(pos);
  return $pos.parent.canReplaceWith($pos.index(), $pos.index() + 1, type);
}
export function wrapBlockInCallout(editor: Editor, pos: number): boolean {
  if (!canWrapBlockInCallout(editor, pos)) return false;
  return runWithDocumentCapability(editor, 'callout', next => {
    if (!canWrapBlockInCallout(next, pos)) return false;
    const { state, view } = next, block = state.doc.nodeAt(pos), type = state.schema.nodes.githubAlert;
    if (!block?.isBlock || !type || ['githubAlert', 'documentPresentation', 'annotationStore'].includes(block.type.name)) return false;
    const $pos = state.doc.resolve(pos), wrapped = type.create({ title: '' }, block);
    if (!$pos.parent.canReplaceWith($pos.index(), $pos.index() + 1, type)) return false;
    const tr = closeHistory(state.tr).replaceWith(pos, pos + block.nodeSize, wrapped);
    view.dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 1))).scrollIntoView());
    view.focus(); return true;
  });
}

/** One node attribute transaction is one undoable action, never a content rewrite. */
export function updateCallout(editor: Editor, pos: number, patch: Partial<CalloutAttributes>): boolean {
  if (Object.entries(patch).some(([key, value]) => key === 'kind' ? !isAlertKind(value) : key === 'title' ? !isCalloutTitle(value)
    : key === 'icon' ? !isCalloutIcon(value) : !['textColor', 'borderColor', 'backgroundColor'].includes(key) || !isCalloutColor(value))) return false;
  const apply = (next: Editor) => {
    const node = next.state.doc.nodeAt(pos);
    if (node?.type.name !== 'githubAlert') return false;
    const attrs: Record<string, unknown> = { ...node.attrs, ...calloutAttributes({ ...node.attrs, ...patch }) };
    if (Object.keys(attrs).every(key => attrs[key] === node.attrs[key])) return false;
    next.view.dispatch(closeHistory(next.state.tr).setNodeMarkup(pos, undefined, attrs));
    return true;
  };
  return Object.entries(patch).every(([key, value]) => key === 'kind' || value === null) ? apply(editor) : runWithDocumentCapability(editor, 'callout', apply);
}
