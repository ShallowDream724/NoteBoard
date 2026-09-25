import type { Editor } from '@tiptap/core';
import { Fragment, Slice, type Node, type Schema } from '@tiptap/pm/model';
import { Step, StepResult, type Mappable } from '@tiptap/pm/transform';
import { CellSelection, isInTable, selectedRect } from '@tiptap/pm/tables';
import { dispatchDiscreteEdit, runDiscreteEdit } from './discreteEdit';
import { documentTableStyle } from './documentPresentation';
import { tableFill } from './tableCellPresentation';
import { columnWidthsStep } from './tableColumnWidths';
import { tableGrid } from './tableStructure';

export type TableFillScope = 'cells' | 'row' | 'column';
interface CellPatch { pos: number; background?: string | null; header?: boolean; textAlign?: string | null; verticalAlign?: string | null }
function validAlignment(patch: CellPatch) {
  return (patch.textAlign == null || ['left','center','right'].includes(patch.textAlign)) && (patch.verticalAlign == null || ['top','middle','bottom'].includes(patch.verticalAlign));
}
const indexes = new WeakMap<Node, Map<number, Node>>();
function cellIndex(table: Node) {
  let index = indexes.get(table);
  if (!index) {
    index = new Map();
    table.forEach((row, rowPos) => row.forEach((cell, cellPos) => index!.set(rowPos + 1 + cellPos, cell)));
    indexes.set(table, index);
  }
  return index;
}

/** One bounded table traversal and one undo step; content/positions stay intact. */
export class TablePresentationStep extends Step {
  constructor(readonly pos: number, readonly patches: CellPatch[]) { super(); }
  apply(doc: Node) {
    const table = doc.nodeAt(this.pos);
    if (table?.type.spec.tableRole !== 'table') return StepResult.fail('Table moved');
    const changes = new Map(this.patches.map(patch => [patch.pos, patch]));
    let valid = true;
    const rows: Node[] = [];
    table.forEach((row, rowPos) => {
      const cells: Node[] = []; let changed = false;
      row.forEach((cell, cellPos) => {
        const patch = changes.get(rowPos + 1 + cellPos);
        if (!patch) { cells.push(cell); return; }
        changes.delete(patch.pos);
        if (patch.background !== undefined && patch.background !== null && !tableFill(patch.background)) valid = false;
        if (!validAlignment(patch)) valid = false;
        const type = patch.header === undefined ? cell.type : doc.type.schema.nodes[patch.header ? 'tableHeader' : 'tableCell'];
        const attrs = { ...cell.attrs, ...(patch.background !== undefined ? { background: tableFill(patch.background) } : {}),
          ...(patch.textAlign !== undefined ? { align: patch.textAlign } : {}), ...(patch.verticalAlign !== undefined ? { verticalAlign: patch.verticalAlign } : {}) };
        cells.push(type.create(attrs, cell.content, cell.marks)); changed = true;
      });
      rows.push(changed ? row.copy(Fragment.fromArray(cells)) : row);
    });
    if (!valid || changes.size) return StepResult.fail('Invalid table presentation');
    return StepResult.fromReplace(doc, this.pos, this.pos + table.nodeSize, new Slice(Fragment.from(table.copy(Fragment.fromArray(rows))), 0, 0));
  }
  invert(doc: Node) {
    const table = doc.nodeAt(this.pos)!;
    const index = cellIndex(table);
    return new TablePresentationStep(this.pos, this.patches.map(patch => {
      const cell = index.get(patch.pos)!;
      return { pos: patch.pos, ...(patch.background !== undefined ? { background: cell.attrs.background } : {}),
        ...(patch.textAlign !== undefined ? { textAlign: cell.attrs.align ?? null } : {}), ...(patch.verticalAlign !== undefined ? { verticalAlign: cell.attrs.verticalAlign } : {}),
        ...(patch.header !== undefined ? { header: cell.type.name === 'tableHeader' } : {}) };
    }));
  }
  map(mapping: Mappable) {
    const result = mapping.mapResult(this.pos, 1);
    return result.deletedAcross ? null : new TablePresentationStep(result.pos, this.patches);
  }
  toJSON() { return { stepType: 'noteboardTablePresentation', pos: this.pos, patches: this.patches }; }
  static fromJSON(_schema: Schema, json: { pos: number; patches: CellPatch[] }) {
    if (!Number.isInteger(json.pos) || !Array.isArray(json.patches) || json.patches.some(patch => !patch || !Number.isInteger(patch.pos)
      || (patch.background !== undefined && patch.background !== null && !tableFill(patch.background))
      || !validAlignment(patch) || (patch.header !== undefined && typeof patch.header !== 'boolean'))) throw new RangeError('Invalid table presentation step');
    return new TablePresentationStep(json.pos, json.patches);
  }
}
Step.jsonID('noteboardTablePresentation', TablePresentationStep);

export function tableSelection(editor: Editor) {
  return !editor.isDestroyed && isInTable(editor.state) ? selectedRect(editor.state) : null;
}
export function selectTableScope(editor: Editor, scope: TableFillScope) {
  const rect = tableSelection(editor); if (!rect) return false;
  const selection = CellSelection.create(editor.state.doc, rect.tableStart + rect.map.map[rect.top * rect.map.width + rect.left],
    rect.tableStart + rect.map.map[(rect.bottom - 1) * rect.map.width + rect.right - 1]);
  const expanded = scope === 'row' ? CellSelection.rowSelection(selection.$anchorCell, selection.$headCell)
    : scope === 'column' ? CellSelection.colSelection(selection.$anchorCell, selection.$headCell) : selection;
  editor.view.dispatch(editor.state.tr.setSelection(expanded));
  editor.view.focus(); return true;
}
export function fillTableSelection(editor: Editor, scope: TableFillScope, value: string | null) {
  const rect = tableSelection(editor), color = tableFill(value);
  if (!rect || (value !== null && !color) || documentTableStyle(editor.state.doc) === 'three-line') return false;
  const area = scope === 'row' ? { ...rect, left: 0, right: rect.map.width }
    : scope === 'column' ? { ...rect, top: 0, bottom: rect.map.height } : rect;
  const index = cellIndex(rect.table);
  const patches = rect.map.cellsInRect(area).flatMap(pos => {
    const cell = index.get(pos)!;
    return cell.type.name === 'tableHeader' || cell.attrs.background === color ? [] : [{ pos, background: color }];
  });
  if (!patches.length) return false;
  dispatchDiscreteEdit(editor.view, editor.state.tr.step(new TablePresentationStep(rect.tableStart - 1, patches)));
  return true;
}

export function alignTableSelection(editor: Editor, change: Pick<CellPatch, 'textAlign' | 'verticalAlign'>) {
  const rect = tableSelection(editor); if (!rect || !validAlignment({ pos: 0, ...change })) return false;
  const patches = rect.map.cellsInRect(rect).map(pos => ({ pos, ...change }));
  dispatchDiscreteEdit(editor.view, editor.state.tr.step(new TablePresentationStep(rect.tableStart - 1, patches)));
  editor.view.focus(); return true;
}
export function distributeTableColumns(editor: Editor) {
  const rect = tableSelection(editor); if (!rect) return false;
  const saved: number[] = Array(rect.map.width).fill(0);
  let column = 0;
  rect.table.firstChild?.forEach(cell => {
    for (let i = 0; i < cell.attrs.colspan; i++) saved[column++] = cell.attrs.colwidth?.[i] ?? 0;
  });
  const widths = saved.slice();
  if (saved.some(width => !width)) {
    const dom = editor.view.nodeDOM(rect.tableStart - 1);
    const table = dom instanceof HTMLTableElement ? dom : dom instanceof Element ? dom.querySelector('table') : null;
    if (!table) return false;
    const columns = table.querySelector(':scope > colgroup')?.children;
    const scale = table.getBoundingClientRect().width / table.offsetWidth || 1;
    for (const cell of tableGrid(rect.table).cells)
      (cell.node.attrs.colwidth as number[] | null)?.forEach((width, offset) => { if (width > 0) saved[cell.column + offset] ||= width; });
    for (let i = 0; i < widths.length; i++) widths[i] = saved[i] || Math.max(40, Math.round(columns?.length === rect.map.width ? columns[i].getBoundingClientRect().width / scale : table.offsetWidth / rect.map.width));
  }
  const from = editor.state.selection instanceof CellSelection ? rect.left : 0;
  const to = editor.state.selection instanceof CellSelection ? rect.right : rect.map.width;
  const width = Math.max(40, Math.round(widths.slice(from, to).reduce((a, b) => a + b, 0) / (to - from)));
  for (let index = from; index < to; index++) widths[index] = width;
  if (widths.every((value, index) => value === saved[index])) return false;
  dispatchDiscreteEdit(editor.view, editor.state.tr.step(columnWidthsStep(rect.tableStart - 1, rect.table, widths)));
  return true;
}

export function distributeTableRows(editor: Editor) {
  const rect = tableSelection(editor); if (!rect) return false;
  const dom = editor.view.nodeDOM(rect.tableStart - 1);
  const table = dom instanceof HTMLTableElement ? dom : dom instanceof Element ? dom.querySelector('table') : null;
  if (!table) return false;
  const from = editor.state.selection instanceof CellSelection ? rect.top : 0;
  const to = editor.state.selection instanceof CellSelection ? rect.bottom : rect.map.height;
  let sum = 0;
  for (let index = from; index < to; index++) sum += rect.table.child(index).attrs.height || table.rows[index]?.offsetHeight || 24;
  const height = Math.max(24, Math.round(sum / (to - from)));
  const heights = Array.from({ length: to - from }, (_, index) => ({ index: from + index, height: Math.min(10000, height) }));
  if (heights.every(row => rect.table.child(row.index).attrs.height === row.height)) return false;
  dispatchDiscreteEdit(editor.view, editor.state.tr.step(new TableRowHeightsStep(rect.tableStart - 1, heights)));
  return true;
}

export function tableDistributionState(editor: Editor) {
  const selection = editor.state.selection;
  return { columns: selection instanceof CellSelection && selection.isRowSelection(),
    rows: selection instanceof CellSelection && selection.isColSelection() };
}

/** Row attributes do not change positions. One table traversal avoids one
 * whole-table copy per selected row and retains the cell selection. */
class TableRowHeightsStep extends Step {
  constructor(readonly pos: number, readonly heights: Array<{ index: number; height: number | null }>) { super(); }
  apply(doc: Node) {
    const table = doc.nodeAt(this.pos);
    if (table?.type.spec.tableRole !== 'table') return StepResult.fail('Table moved');
    const changes = new Map(this.heights.map(row => [row.index, row.height]));
    if (this.heights.some(row => !Number.isInteger(row.index) || row.index < 0 || row.index >= table.childCount
      || row.height !== null && (!Number.isFinite(row.height) || row.height < 0 || row.height > 10000))) return StepResult.fail('Invalid row height');
    const rows: Node[] = [];
    table.forEach((row, _pos, index) => rows.push(changes.has(index) && changes.get(index) !== row.attrs.height ? row.type.create({ ...row.attrs, height: changes.get(index) }, row.content, row.marks) : row));
    return StepResult.fromReplace(doc, this.pos, this.pos + table.nodeSize, new Slice(Fragment.from(table.copy(Fragment.fromArray(rows))), 0, 0));
  }
  invert(doc: Node) { const table = doc.nodeAt(this.pos)!; return new TableRowHeightsStep(this.pos, this.heights.map(row => ({ index: row.index, height: table.child(row.index).attrs.height }))); }
  map(mapping: Mappable) { const mapped = mapping.mapResult(this.pos, 1); return mapped.deletedAcross ? null : new TableRowHeightsStep(mapped.pos, this.heights); }
  toJSON() { return { stepType: 'noteboardTableRowHeights', pos: this.pos, heights: this.heights }; }
  static fromJSON(_schema: Schema, json: { pos: number; heights: Array<{ index: number; height: number | null }> }) {
    if (!Number.isInteger(json.pos) || !Array.isArray(json.heights)) throw new RangeError('Invalid row heights step');
    return new TableRowHeightsStep(json.pos, json.heights);
  }
}
Step.jsonID('noteboardTableRowHeights', TableRowHeightsStep);

export function tableDeleteScope(editor: Editor): 'table' | 'row' | 'column' | 'cells' {
  const selection = editor.state.selection;
  if (selection instanceof CellSelection) {
    if (selection.isRowSelection() && selection.isColSelection()) return 'table';
    if (selection.isRowSelection()) return 'row';
    if (selection.isColSelection()) return 'column';
  }
  return 'cells';
}
export function deleteTableSelection(editor: Editor): boolean {
  const scope = tableDeleteScope(editor);
  if (scope === 'row') return runDiscreteEdit(editor, chain => chain.deleteRow());
  if (scope === 'column') return runDiscreteEdit(editor, chain => chain.deleteColumn());
  if (scope === 'table') return runDiscreteEdit(editor, chain => chain.deleteTable());
  if (!(editor.state.selection instanceof CellSelection)) selectTableScope(editor, 'cells');
  return runDiscreteEdit(editor, chain => chain.deleteSelection());
}

/** Header controls exist only at the corresponding outer edge; merged cells
 * crossing that edge cannot become a partial header. */
export function tableHeaderState(editor: Editor) {
  const rect = tableSelection(editor); if (!rect) return null;
  if ((rect.top !== 0 || rect.bottom !== 1) && (rect.left !== 0 || rect.right !== 1)) {
    return { rect, row: [], column: [], rowHeader: false, columnHeader: false, canRow: false, canColumn: false };
  }
  const index = cellIndex(rect.table);
  const row = rect.map.cellsInRect({ left: 0, right: rect.map.width, top: 0, bottom: 1 });
  const column = rect.map.cellsInRect({ left: 0, right: 1, top: 0, bottom: rect.map.height });
  return { rect, row, column,
    rowHeader: row.every(pos => index.get(pos)!.type.name === 'tableHeader'),
    columnHeader: column.every(pos => index.get(pos)!.type.name === 'tableHeader'),
    canRow: rect.top === 0 && rect.bottom === 1 && row.every(pos => index.get(pos)!.attrs.rowspan === 1),
    canColumn: rect.left === 0 && rect.right === 1 && column.every(pos => index.get(pos)!.attrs.colspan === 1),
  };
}
export function setSelectedTableHeader(editor: Editor, axis: 'row' | 'column') {
  const info = tableHeaderState(editor); if (!info || !(axis === 'row' ? info.canRow : info.canColumn)) return false;
  const enabled = !(axis === 'row' ? info.rowHeader : info.columnHeader);
  const otherHeader = axis === 'row' ? info.columnHeader : info.rowHeader;
  const other = new Set(axis === 'row' ? info.column : info.row);
  const patches = info[axis].map(pos => ({ pos, header: enabled || (otherHeader && other.has(pos)) }));
  dispatchDiscreteEdit(editor.view, editor.state.tr.step(new TablePresentationStep(info.rect.tableStart - 1, patches)));
  return true;
}
