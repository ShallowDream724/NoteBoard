import { Fragment, type Node as PMNode } from '@tiptap/pm/model';
import { TableMap, CellSelection } from '@tiptap/pm/tables';
import type { EditorView } from '@tiptap/pm/view';
import { dispatchDiscreteEdit } from './discreteEdit';

export type TableAxis = 'row' | 'column';
interface Cell { row: number; column: number; node: PMNode }
interface Boundaries { before: Int32Array; after: Int32Array }
interface Grid { map: TableMap; cells: Cell[]; rows: PMNode[]; rowBoundaries: Boundaries; columnBoundaries: Boundaries }
const grids = new WeakMap<PMNode, Grid>();
function indexedBoundaries(safe: boolean[]): Boundaries {
  const before = new Int32Array(safe.length), after = new Int32Array(safe.length);
  for (let i = 0, last = 0; i < safe.length; i++) before[i] = last = safe[i] ? i : last;
  for (let i = safe.length - 1, last = i; i >= 0; i--) after[i] = last = safe[i] ? i : last;
  return { before, after };
}

/** One linear pass, reused for the entire gesture. No nodeAt/findCell per cell. */
export function tableGrid(table: PMNode): Grid {
  const cached = grids.get(table); if (cached) return cached;
  const map = TableMap.get(table), nodes = new Map<number, PMNode>(), rows: PMNode[] = [];
  table.forEach((row, pos) => { rows.push(row); row.forEach((node, cellPos) => nodes.set(pos + cellPos + 1, node)); });
  const cells: Cell[] = [], seen = new Set<number>();
  const rowBoundaries = Array(map.height + 1).fill(true), columnBoundaries = Array(map.width + 1).fill(true);
  for (let row = 0; row < map.height; row++) for (let column = 0; column < map.width; column++) {
    const index = row * map.width + column, pos = map.map[index];
    if (!seen.has(pos)) { seen.add(pos); const node = nodes.get(pos); if (node) cells.push({ row, column, node }); }
    if (row && pos === map.map[index - map.width]) rowBoundaries[row] = false;
    if (column && pos === map.map[index - 1]) columnBoundaries[column] = false;
  }
  const result = { map, cells, rows, rowBoundaries: indexedBoundaries(rowBoundaries), columnBoundaries: indexedBoundaries(columnBoundaries) };
  grids.set(table, result); return result;
}

export function tableAxisRange(table: PMNode, axis: TableAxis, index: number): { from: number; to: number } {
  const grid = tableGrid(table), boundaries = axis === 'row' ? grid.rowBoundaries : grid.columnBoundaries;
  return { from: boundaries.before[index], to: boundaries.after[index + 1] };
}
export function safeTableBoundary(table: PMNode, axis: TableAxis, boundary: number, forward: boolean): number {
  const grid = tableGrid(table), boundaries = axis === 'row' ? grid.rowBoundaries : grid.columnBoundaries;
  const at = Math.max(0, Math.min(boundary, boundaries.before.length - 1));
  return forward ? boundaries.after[at] : boundaries.before[at];
}

function assemble(table: PMNode, rows: PMNode[], width: number, cells: Cell[]): PMNode {
  // Column width is a table-axis property. New/pasted rows inherit existing
  // widths in one pass instead of relying on a later repair transaction.
  const widths = new Int32Array(width);
  for (const { column, node } of cells) for (let c = 0; c < node.attrs.colspan; c++) widths[column + c] ||= node.attrs.colwidth?.[c] ?? 0;
  const slots: Array<PMNode | true | undefined> = new Array(rows.length * width);
  for (const cell of cells) {
    for (let r = cell.row; r < cell.row + cell.node.attrs.rowspan; r++) {
      for (let c = cell.column; c < cell.column + cell.node.attrs.colspan; c++) slots[r * width + c] = true;
    }
    const values = Array.from(widths.subarray(cell.column, cell.column + cell.node.attrs.colspan));
    const colwidth = values.some(Boolean) ? values : null;
    const same = colwidth === null ? !cell.node.attrs.colwidth : colwidth.every((value, index) => value === cell.node.attrs.colwidth?.[index]);
    slots[cell.row * width + cell.column] = same ? cell.node : cell.node.type.create({ ...cell.node.attrs, colwidth }, cell.node.content, cell.node.marks);
  }
  const empty = table.type.schema.nodes.tableCell.createAndFill()!;
  return table.copy(Fragment.fromArray(rows.map((row, index) => {
    const content: PMNode[] = [];
    for (let column = 0; column < width; column++) {
      const value = slots[index * width + column];
      if (value !== true) content.push(value ?? (widths[column] ? empty.type.create({ ...empty.attrs, colwidth: [widths[column]] }, empty.content) : empty));
    }
    return row.copy(Fragment.fromArray(content));
  })));
}

/** Reuses cell nodes, so all cell/text styles and merged shapes travel intact. */
export function reorderedTable(table: PMNode, axis: TableAxis, index: number, boundary: number): { table: PMNode; from: number; to: number } | null {
  const grid = tableGrid(table), range = tableAxisRange(table, axis, index);
  boundary = safeTableBoundary(table, axis, boundary, boundary > index);
  if (boundary >= range.from && boundary <= range.to) return null;
  const length = axis === 'row' ? grid.map.height : grid.map.width;
  const remaining = Array.from({ length }, (_, i) => i), moving = remaining.splice(range.from, range.to - range.from);
  const inserted = boundary > range.to ? boundary - moving.length : boundary;
  const order = remaining.slice(0, inserted).concat(moving, remaining.slice(inserted));
  const mapping = new Int32Array(length); order.forEach((old, next) => { mapping[old] = next; });
  const rows = axis === 'row' ? order.map(i => grid.rows[i]) : grid.rows;
  const cells = grid.cells.map(cell => ({ ...cell, row: axis === 'row' ? mapping[cell.row] : cell.row, column: axis === 'column' ? mapping[cell.column] : cell.column }));
  return { table: assemble(table, rows, grid.map.width, cells), from: inserted, to: inserted + moving.length };
}

export function moveTableAxis(view: EditorView, pos: number, table: PMNode, axis: TableAxis, index: number, boundary: number): boolean {
  if (view.state.doc.nodeAt(pos) !== table) return false;
  const moved = reorderedTable(table, axis, index, boundary); if (!moved) return false;
  const tr = view.state.tr.replaceWith(pos, pos + table.nodeSize, moved.table), map = TableMap.get(moved.table), start = pos + 1;
  const at = (r: number, c: number) => tr.doc.resolve(start + map.map[r * map.width + c]);
  tr.setSelection(axis === 'row' ? CellSelection.rowSelection(at(moved.from, 0), at(moved.to - 1, map.width - 1))
    : CellSelection.colSelection(at(0, moved.from), at(map.height - 1, moved.to - 1)));
  dispatchDiscreteEdit(view, tr); view.focus(); return true;
}

/** Structural clipboard insertion never overwrites the destination row/column. */
export function insertTablePart(table: PMNode, source: PMNode, axis: TableAxis, boundary: number): PMNode {
  const target = tableGrid(table), part = tableGrid(source);
  boundary = safeTableBoundary(table, axis, boundary, false);
  if (axis === 'row') {
    const rows = [...target.rows.slice(0, boundary), ...part.rows, ...target.rows.slice(boundary)];
    return assemble(table, rows, Math.max(target.map.width, part.map.width), [
      ...target.cells.map(cell => ({ ...cell, row: cell.row >= boundary ? cell.row + part.map.height : cell.row })),
      ...part.cells.map(cell => ({ ...cell, row: cell.row + boundary })),
    ]);
  }
  const rows = target.rows.slice();
  while (rows.length < part.map.height) rows.push(table.type.schema.nodes.tableRow.create());
  return assemble(table, rows, target.map.width + part.map.width, [
    ...target.cells.map(cell => ({ ...cell, column: cell.column >= boundary ? cell.column + part.map.width : cell.column })),
    ...part.cells.map(cell => ({ ...cell, column: cell.column + boundary })),
  ]);
}
