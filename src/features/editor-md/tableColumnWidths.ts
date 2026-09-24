import { Fragment, Slice, type Node, type Schema } from '@tiptap/pm/model';
import { Step, StepResult, type Mappable } from '@tiptap/pm/transform';
import { buildLogicalTableGrid } from './tableGrid';

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
      for (let col = 0; col < original.childCount; col++) {
        const cell = original.child(col), width = widths[col];
        if (width && (width.length !== cell.attrs.colspan || width.some(value => !Number.isFinite(value) || value < 0 || value > 10000))) return StepResult.fail('Invalid column widths');
        const before = cell.attrs.colwidth as number[] | null;
        const same = before === width || (!!before && !!width && before.length === width.length && before.every((value, i) => value === width[i]));
        cells.push(same ? cell : cell.type.create({ ...cell.attrs, colwidth: width }, cell.content, cell.marks));
      }
      rows.push(original.copy(Fragment.fromArray(cells)));
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
  const rows: Node[][] = [];
  table.forEach(row => { const cells: Node[] = []; row.forEach(cell => cells.push(cell)); rows.push(cells); });
  const grid = buildLogicalTableGrid(rows, cell => cell.attrs);
  return new TableColumnWidthsStep(pos, grid.rows.map(row => row.map(cell => widths.slice(cell.column, cell.column + cell.colspan))));
}

/** Interior boundaries redistribute space; the outer boundary changes table
 * width. This leaves room for neighbouring labels and lets formulas reflow. */
export function resizedColumnPair(widths: readonly number[], index: number, delta: number, minimum = 40): [number, number | undefined] {
  const start = widths[index], next = widths[index + 1];
  const floor = next === undefined ? minimum : Math.min(minimum, (start + next) / 2);
  const value = Math.max(floor, Math.min(10000, next === undefined ? start + delta : Math.min(start + next - floor, start + delta)));
  return [Math.round(value), next === undefined ? undefined : start + next - Math.round(value)];
}
