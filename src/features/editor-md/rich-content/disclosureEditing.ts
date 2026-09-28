import { Extension, type Editor } from '@tiptap/core';
import { Fragment } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { dispatchDiscreteEdit } from '../discreteEdit';

/** Only the canonical empty body may lose its isolating shell. Textless atoms,
 * nested containers and extra paragraphs still belong to the document. */
export function unwrapEmptyDisclosure(editor: Editor, pos: number, title?: string): boolean {
  if (!editor.isEditable || editor.view.composing) return false;
  const { state, view } = editor, node = state.doc.nodeAt(pos), body = node?.firstChild;
  if (node?.type.name !== 'disclosure' || node.childCount !== 1 || body?.type.name !== 'paragraph' || body.content.size) return false;
  // The title input commits on blur. Preserve its pending edit as the preceding
  // action so undoing shell removal restores the empty title the user just saw.
  if (title !== undefined && title !== node.attrs.title) {
    dispatchDiscreteEdit(view, state.tr.setNodeAttribute(pos, 'title', title));
    return unwrapEmptyDisclosure(editor, pos);
  }
  const text = title ?? String(node.attrs.title ?? '');
  const attrs = { ...body.attrs }, annotationId = node.attrs.annotationId;
  const keepBodyAnnotation = !!annotationId && !!body.attrs.annotationId && annotationId !== body.attrs.annotationId;
  if (annotationId) attrs.annotationId = annotationId;
  const paragraph = body.type.create(attrs, text ? state.schema.text(text) : null, body.marks);
  const content = Fragment.fromArray(keepBodyAnnotation ? [paragraph, body] : [paragraph]);
  const at = state.doc.resolve(pos);
  if (!at.parent.canReplace(at.index(), at.index() + 1, content)) return false;
  const tr = state.tr.replaceWith(pos, pos + node.nodeSize, content);
  tr.setSelection(TextSelection.create(tr.doc, pos + 1 + text.length));
  dispatchDiscreteEdit(view, tr.scrollIntoView());
  return true;
}

/** Run before the generic input-rule undo/join keys, which stop at isolating. */
export const DisclosureEditing = Extension.create({
  name: 'disclosureEditing', priority: 1100,
  addKeyboardShortcuts() {
    return { Backspace: () => {
      const { selection } = this.editor.state, { $from } = selection;
      if (!(selection instanceof TextSelection) || !selection.empty || $from.parentOffset !== 0 || $from.depth < 2
        || $from.node(-1).type.name !== 'disclosure') return false;
      return unwrapEmptyDisclosure(this.editor, $from.before($from.depth - 1));
    } };
  },
});
