import type { Editor, JSONContent } from '@tiptap/core';
import { Fragment } from '@tiptap/pm/model';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { runWithDocumentCapability } from '../document-format/featureGate';
import type { DocumentCapabilityId } from '../document-format/capabilities';
import { isEmptyParagraph } from './blockInteractionScope';
import { dispatchDiscreteEdit } from './discreteEdit';
import { editorDocumentKey } from './editorDocumentCodec';
import { captureVisualInsertion, type InsertionLease } from './imageInsertionLease';
import { ensureDisclosureTail } from './rich-content/disclosureEditing';

/** Replace the named empty paragraph, independently of the editor's live selection. */
export function replaceEmptyParagraph(editor: Editor, pos: number, content: JSONContent | JSONContent[]): boolean {
  if (editor.isDestroyed || !editor.isEditable || pos < 0 || pos >= editor.state.doc.content.size) return false;
  const { state, view } = editor, previous = state.doc.nodeAt(pos);
  if (!isEmptyParagraph(previous)) return false;
  const nodes = (Array.isArray(content) ? content : [content]).map(value => state.schema.nodeFromJSON(value));
  const fragment = Fragment.fromArray(nodes), at = state.doc.resolve(pos);
  if (!fragment.size || !at.parent.canReplace(at.index(), at.index() + 1, fragment)) return false;
  const tr = state.tr.replaceWith(pos, pos + previous!.nodeSize, fragment);
  tr.setSelection(nodes[0].isAtom && NodeSelection.isSelectable(nodes[0])
    ? NodeSelection.create(tr.doc, pos)
    : TextSelection.near(tr.doc.resolve(pos + (nodes[0].isTextblock ? nodes[0].nodeSize - 1 : 1))));
  ensureDisclosureTail(tr, pos + 1);
  dispatchDiscreteEdit(view, tr.scrollIntoView()); view.focus(); return true;
}

export function insertAtEmptyParagraph(editor: Editor, pos: number, content: JSONContent, capability?: DocumentCapabilityId): boolean {
  return capability ? runWithDocumentCapability(editor, capability, next => replaceEmptyParagraph(next, pos, content))
    : replaceEmptyParagraph(editor, pos, content);
}

/** Dialog results retain the original paragraph through edits and reject a filled/deleted target. */
export function captureEmptyParagraphInsertion<T>(editor: Editor, pos: number, content: (value: T) => JSONContent | JSONContent[]): InsertionLease<T> | null {
  const key = editorDocumentKey(editor);
  if (!key || !isEmptyParagraph(editor.state.doc.nodeAt(pos))) return null;
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos + 1)));
  return captureVisualInsertion<T>(editor, key, (value, selection) => {
    const at = selection.$from;
    if (!selection.empty || !at.depth || !isEmptyParagraph(at.parent)) return false;
    return replaceEmptyParagraph(editor, at.before(), content(value));
  });
}
