import { Fragment, Slice, type Node, type Schema } from '@tiptap/pm/model';
import { Step, StepResult, type Mappable } from '@tiptap/pm/transform';
import { tableGrid } from './tableStructure';

type CellWidths = Array<Array<number[] | null>>;

/** Attribute-only batch: one tree replacement, an empty position map and one
 * undo entry. Repeated setNodeMarkup would walk the row prefix for every cell. */
export class TableColumnWidthsStep extends Step {
  constructor(readonly pos: number, readonly cells: CellWidths) { super(); }
  apply(doc: Node): StepResult {
    const table = doc.nodeAt(this.pos);
    if (table?.type.spec.tableRole !== 'table' || table.childCount !== this.cells.length) return StepResult.fail('Table structure changed');
    const rows: Node[] = [];
    for (let row = 0; row < table.childCount; row++) {
      const original = table.child(row), widths = this.cells[row];
      if (original.childCount !== widths.length) return StepResult.fail('Table columns changed');
      const cells: Node[] = [];
      let changed = false;
      for (let col = 0; col < original.childCount; col++) {
        const cell = original.child(col), width = widths[col];
        if (width && (width.length !== cell.attrs.colspan || width.some(value => !Number.isFinite(value) || value < 0 || value > 10000))) return StepResult.fail('Invalid column widths');
        const before = cell.attrs.colwidth as number[] | null;
        const same = before === width || (!!before && !!width && before.length === width.length && before.every((value, i) => value === width[i]));
        if (!same) changed = true;
        cells.push(same ? cell : cell.type.create({ ...cell.attrs, colwidth: width }, cell.content, cell.marks));
      }
      rows.push(changed ? original.copy(Fragment.fromArray(cells)) : original);
    }
    return StepResult.fromReplace(doc, this.pos, this.pos + table.nodeSize, new Slice(Fragment.from(table.copy(Fragment.fromArray(rows))), 0, 0));
  }
  invert(doc: Node) {
    const table = doc.nodeAt(this.pos)!;
    const cells: CellWidths = [];
    table.forEach(row => { const widths: Array<number[] | null> = []; row.forEach(cell => widths.push(cell.attrs.colwidth)); cells.push(widths); });
    return new TableColumnWidthsStep(this.pos, cells);
  }
  map(mapping: Mappable) {
    const position = mapping.mapResult(this.pos, 1);
    return position.deletedAcross ? null : new TableColumnWidthsStep(position.pos, this.cells);
  }
  toJSON() { return { stepType: 'noteboardTableColumnWidths', pos: this.pos, cells: this.cells }; }
  static fromJSON(_schema: Schema, json: { pos: number; cells: CellWidths }) {
    if (!Number.isInteger(json.pos) || !Array.isArray(json.cells) || json.cells.some(row => !Array.isArray(row) || row.some(cell => cell !== null && !Array.isArray(cell)))) throw new RangeError('Invalid table widths step');
    return new TableColumnWidthsStep(json.pos, json.cells);
  }
}
Step.jsonID('noteboardTableColumnWidths', TableColumnWidthsStep);

export function columnWidthsStep(pos: number, table: Node, widths: number[]): TableColumnWidthsStep {
  const grid = tableGrid(table), rows: CellWidths = grid.rows.map(() => []);
  const single = widths.map(width => [width]), spans = new Map<string, number[]>();
  for (const cell of grid.cells) {
    const count = cell.node.attrs.colspan;
    let values = single[cell.column] ?? [];
    if (count > 1) {
      const key = cell.column + ':' + count;
      values = spans.get(key)!;
      if (!values) { values = widths.slice(cell.column, cell.column + count); spans.set(key, values); }
    }
    rows[cell.row].push(values);
  }
  return new TableColumnWidthsStep(pos, rows);
}

/** Every boundary resizes its preceding logical column. The remaining columns
 * keep their widths and move with the boundary, so table width follows the drag.
 * Imported widths below the normal minimum must not jump on the first frame. */
export function resizedColumnWidth(start: number, delta: number, minimum = 40): number {
  const floor = Math.min(minimum, start);
  return Math.round(Math.max(floor, Math.min(10000, start + delta)));
}

/** Optional fixed-total mode exchanges space with the following column. The
 * final boundary still grows the table, and either column keeps its own floor. */
export function resizedColumnPair(widths: readonly number[], index: number, delta: number, minimum = 40): [number, number | undefined] {
  const start = widths[index], next = widths[index + 1];
  if (next === undefined) return [resizedColumnWidth(start, delta, minimum), undefined];
  const total = start + next;
  const floor = Math.max(Math.min(minimum, start), total - 10000);
  const ceiling = Math.min(10000, total - Math.min(minimum, next));
  const value = Math.round(Math.max(floor, Math.min(ceiling, start + delta)));
  return [value, total - value];
}
