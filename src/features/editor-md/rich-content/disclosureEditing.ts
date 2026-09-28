import { Extension, type Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { dispatchDiscreteEdit } from '../discreteEdit';

/** Only the canonical empty body may lose its isolating shell. Textless atoms,
 * nested containers and extra paragraphs still belong to the document. */
export function deleteEmptyDisclosure(editor: Editor, pos: number, title?: string): boolean {
  if (!editor.isEditable || editor.view.composing) return false;
  const { state, view } = editor, node = state.doc.nodeAt(pos), body = node?.firstChild;
  if (node?.type.name !== 'disclosure' || node.childCount !== 1 || body?.type.name !== 'paragraph' || body.content.size) return false;
  // The title input commits on blur. Preserve its pending edit as the preceding
  // action so undoing shell removal restores the empty title the user just saw.
  if (title !== undefined && title !== node.attrs.title) {
    dispatchDiscreteEdit(view, state.tr.setNodeAttribute(pos, 'title', title));
    return deleteEmptyDisclosure(editor, pos);
  }
  // The title and block metadata belong to the deleted container. The schema
  // supplies an empty paragraph only when its parent requires a text block.
  const tr = state.tr.delete(pos, pos + node.nodeSize);
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(pos, tr.doc.content.size)), -1));
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
      return deleteEmptyDisclosure(this.editor, $from.before($from.depth - 1));
    } };
  },
});
