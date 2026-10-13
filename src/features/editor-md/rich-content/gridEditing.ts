import type { Editor } from '@tiptap/core';
import { Fragment } from '@tiptap/pm/model';
import { NodeSelection } from '@tiptap/pm/state';
import { resizeImageGridItems, imageGridColumns } from '../../../core/document/imageGrid';
import { dispatchDiscreteEdit } from '../discreteEdit';
import { EDITOR_MENU_PREVIEW_META } from '../menuPreview';

export function resizeImageGrid(editor: Editor, pos: number, columns: number, rows: number): boolean {
  const node = editor.state.doc.nodeAt(pos);
  if (!editor.isEditable || node?.type.name !== 'imageCollection' || node.attrs.layout !== 'grid') return false;
  const oldColumns = imageGridColumns(node.attrs.columns);
  if (oldColumns === columns && node.childCount === columns * rows) return false;
  const items = resizeImageGridItems(
    Array.from({ length: node.childCount }, (_, i) => node.child(i)),
    oldColumns, columns, rows, () => editor.schema.nodes.imageSlot.create(),
  );
  if (!items) return false;
  const tr = editor.state.tr
    .replaceWith(pos + 1, pos + node.nodeSize - 1, Fragment.fromArray(items))
    .setNodeAttribute(pos, 'columns', columns);
  tr.setSelection(NodeSelection.create(tr.doc, pos));
  tr.setMeta(EDITOR_MENU_PREVIEW_META, true);
  dispatchDiscreteEdit(editor.view, tr);
  return true;
}
