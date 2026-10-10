import type { Node } from '@tiptap/pm/model';
import type { EditorState, Selection } from '@tiptap/pm/state';
import { CellSelection } from '@tiptap/pm/tables';

export interface PresentationTarget { node: Node; pos: number }
export interface SelectionPresentation {
  cells: boolean;
  textBlocks: PresentationTarget[];
  indentBlocks: PresentationTarget[];
  mathBlocks: PresentationTarget[];
  cellBlocks: PresentationTarget[];
  inline: boolean;
  blockText: boolean;
}
const scopes = new WeakMap<EditorState, SelectionPresentation>();
const textTypes = new Set(['paragraph', 'heading']);
export const INDENT_BLOCK_TYPES = ['paragraph', 'heading', 'horizontalRule'];

/** Selection ranges, rather than the CellSelection's bounding interval, are
 * authoritative. Cache one bounded walk for all controls in the same state. */
export function selectionPresentation(state: EditorState, selectionOverride?: Selection): SelectionPresentation {
  const cached = selectionOverride ? undefined : scopes.get(state); if (cached) return cached;
  const selection = selectionOverride ?? state.selection;
  let cells = selection instanceof CellSelection;
  for (let depth = selection.$from.depth; !cells && depth > 0; depth--) cells = selection.$from.node(depth).type.spec.tableRole === 'table';
  const scope: SelectionPresentation = { cells, textBlocks: [], indentBlocks: [], mathBlocks: [], cellBlocks: [], inline: false, blockText: false };
  const seen = new Set<number>();
  const visit = (node: Node, pos: number) => {
      if (seen.has(pos)) return !node.isTextblock && !node.isAtom;
      seen.add(pos);
      const target = { node, pos };
      if (node.type.spec.tableRole === 'cell' || node.type.spec.tableRole === 'header_cell') scope.cellBlocks.push(target);
      if (textTypes.has(node.type.name)) scope.textBlocks.push(target);
      if (INDENT_BLOCK_TYPES.includes(node.type.name)) scope.indentBlocks.push(target);
      if (node.type.name === 'mathBlock') scope.mathBlocks.push(target);
      if (node.isTextblock) scope.blockText = true;
      if (node.isTextblock && !node.type.spec.code) scope.inline = true;
      return !node.isTextblock && !node.isAtom;
  };
  if (selection instanceof CellSelection) {
    // ProseMirror has already resolved each range into its cell. Starting from
    // the document (or table.nodeAt) once per range would rescan preceding rows.
    for (const { $from } of selection.ranges) {
      const cell = $from.parent, pos = $from.before();
      visit(cell, pos);
      cell.descendants((node, offset) => visit(node, pos + 1 + offset));
    }
  } else if (selection.empty) {
    for (let depth = selection.$from.depth; depth > 0; depth--) visit(selection.$from.node(depth), selection.$from.before(depth));
  } else {
    for (const { $from, $to } of selection.ranges) {
      if ($from.sameParent($to) && $from.parent.isTextblock) visit($from.parent, $from.before());
      else state.doc.nodesBetween($from.pos, $to.pos, visit);
    }
  }
  if (!selectionOverride) scopes.set(state, scope); return scope;
}

export function commonPresentationValue(targets: PresentationTarget[], key: string, fallback: string): string | null {
  if (!targets.length) return null;
  const value = targets[0].node.attrs[key] ?? fallback;
  return targets.every(({ node }) => (node.attrs[key] ?? fallback) === value) ? value : null;
}
