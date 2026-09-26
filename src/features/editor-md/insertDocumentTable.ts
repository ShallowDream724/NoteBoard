import type { Editor, Range } from '@tiptap/core';
import { createTable } from '@tiptap/extension-table';
import { TextSelection } from '@tiptap/pm/state';
import { dispatchDiscreteEdit } from './discreteEdit';
import { revealEditorBlock } from './editorViewport';
import { ensureDisclosureTail } from './rich-content/disclosureEditing';

/** Toolbar and slash insertion share one edit and one viewport owner. TipTap's
 * insertTable command requests caret scrolling, so use its public node factory
 * while retaining explicit control over focus and table-sized visibility. */
export function insertDocumentTable(editor: Editor, rows: number, cols: number, range?: Range): boolean {
  if (editor.isDestroyed || !editor.isEditable || !Number.isInteger(rows) || !Number.isInteger(cols) || rows < 1 || cols < 1) return false;
  const { state, view } = editor;
  if (range && (range.from < 0 || range.to < range.from || range.to > state.doc.content.size)) return false;
  const table = createTable(state.schema, rows, cols, true);
  const tr = state.tr, originalPos = range?.from ?? state.selection.from;
  if (range) tr.delete(range.from, range.to).setSelection(TextSelection.near(tr.doc.resolve(range.from)));
  const mapIndex = tr.mapping.maps.length;
  tr.replaceSelectionWith(table);
  let tablePos: number | undefined;
  // Only inspect the inserted range, never the surrounding document.
  tr.mapping.maps[mapIndex]?.forEach((_from, _to, from, to) => {
    tr.doc.nodesBetween(from, to, (node, pos) => {
      if (tablePos !== undefined) return false;
      if (node.type.name === 'table') { tablePos = pos; return false; }
    });
  });
  if (tablePos === undefined) return false;
  tr.setSelection(TextSelection.near(tr.doc.resolve(tablePos + 1)));
  ensureDisclosureTail(tr, originalPos, false);
  dispatchDiscreteEdit(view, tr);
  view.focus();
  revealEditorBlock(view, tablePos);
  return true;
}
