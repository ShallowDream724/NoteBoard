import type { Editor } from '@tiptap/core';
import { Fragment, Slice, type Node, type Schema } from '@tiptap/pm/model';
import { CellSelection } from '@tiptap/pm/tables';
import { Step, StepResult, type Mappable } from '@tiptap/pm/transform';
import { dispatchDiscreteEdit, runDiscreteEdit } from '../editor-md/discreteEdit';

interface Patch { pos: number; content: Fragment }
interface MarkChange { type: string; attrs: Record<string, unknown> | null }
const BULK_CELL_THRESHOLD = 4;

/** Attribute/mark-only cell edits keep positions stable. One table copy avoids
 * repeated ancestor scans/copies for a large column selection. */
export class CellTextStyleStep extends Step {
  constructor(readonly pos: number, readonly patches: Patch[]) { super(); }
  apply(doc: Node) {
    const table = doc.nodeAt(this.pos);
    if (table?.type.spec.tableRole !== 'table') return StepResult.fail('Table moved');
    const patches = new Map(this.patches.map(patch => [patch.pos, patch.content]));
    const rows: Node[] = []; let valid = true;
    table.forEach((row, rowPos) => {
      const cells: Node[] = []; let changed = false;
      row.forEach((cell, cellPos) => {
        const pos = rowPos + 1 + cellPos, content = patches.get(pos);
        if (!content) { cells.push(cell); return; }
        patches.delete(pos);
        if (content.size !== cell.content.size || !cell.type.validContent(content)) valid = false;
        cells.push(cell.copy(content)); changed = true;
      });
      rows.push(changed ? row.copy(Fragment.fromArray(cells)) : row);
    });
    return valid && !patches.size ? StepResult.fromReplace(doc, this.pos, this.pos + table.nodeSize,
      new Slice(Fragment.from(table.copy(Fragment.fromArray(rows))), 0, 0)) : StepResult.fail('Invalid cell content style');
  }
  invert(doc: Node) {
    const wanted = new Set(this.patches.map(patch => patch.pos)), patches: Patch[] = [];
    doc.nodeAt(this.pos)!.forEach((row, rowPos) => row.forEach((cell, cellPos) => {
      const pos = rowPos + 1 + cellPos; if (wanted.has(pos)) patches.push({ pos, content: cell.content });
    }));
    return new CellTextStyleStep(this.pos, patches);
  }
  map(mapping: Mappable) { const result = mapping.mapResult(this.pos, 1); return result.deletedAcross ? null : new CellTextStyleStep(result.pos, this.patches); }
  toJSON() { return { stepType: 'noteboardCellTextStyle', pos: this.pos, patches: this.patches.map(patch => ({ pos: patch.pos, content: patch.content.toJSON() })) }; }
  static fromJSON(schema: Schema, json: { pos: number; patches: Array<{ pos: number; content: unknown }> }) {
    if (!Number.isInteger(json.pos) || !Array.isArray(json.patches) || json.patches.some(patch => !Number.isInteger(patch.pos))) throw new RangeError('Invalid cell text style');
    return new CellTextStyleStep(json.pos, json.patches.map(patch => ({ pos: patch.pos, content: Fragment.fromJSON(schema, patch.content) })));
  }
}
Step.jsonID('noteboardCellTextStyle', CellTextStyleStep);

/** null delegates non-cell selections to ordinary text commands. */
export function styleSelectedCells(editor: Editor, marks: MarkChange[], math?: Record<string, unknown>): boolean | null {
  const { state } = editor, { selection } = state;
  if (!(selection instanceof CellSelection) || selection.ranges.length <= BULK_CELL_THRESHOLD) return null;
  const tableStart = selection.$anchorCell.start(-1), patches: Patch[] = [];
  const changes = marks.map(change => ({ type: state.schema.marks[change.type], attrs: change.attrs }));
  const visit = (node: Node, parent: Node): Node => {
    if (node.type.spec.code) return node;
    let next = node;
    if (node.isInline) {
      let result = node.marks;
      for (const change of changes) {
        if (!change.type || !parent.type.allowsMarkType(change.type)) continue;
        result = change.attrs === null ? change.type.removeFromSet(result) : change.type.create(change.attrs).addToSet(result);
      }
      next = node.mark(result);
    }
    if (node.type.name === 'mathBlock' && math && Object.entries(math).some(([key, value]) => node.attrs[key] !== value)) next = node.type.create({ ...node.attrs, ...math }, node.content, node.marks);
    if (node.childCount) {
      const children: Node[] = []; let changed = false;
      node.forEach(child => { const styled = visit(child, node); children.push(styled); changed ||= styled !== child; });
      if (changed) next = next.copy(Fragment.fromArray(children));
    }
    return next;
  };
  for (const { $from } of selection.ranges) {
    const cell = $from.parent, styled = visit(cell, cell);
    if (styled !== cell) patches.push({ pos: $from.before() - tableStart, content: styled.content });
  }
  if (!patches.length) return false;
  dispatchDiscreteEdit(editor.view, state.tr.step(new CellTextStyleStep(tableStart - 1, patches)));
  editor.view.focus(); return true;
}

export function toggleSelectedCellMark(editor: Editor, type: string): boolean | null {
  if (!(editor.state.selection instanceof CellSelection)) return null;
  if (editor.state.selection.ranges.length <= BULK_CELL_THRESHOLD) return runDiscreteEdit(editor, chain => chain.focus().toggleMark(type));
  const mark = editor.schema.marks[type]; if (!mark) return false;
  let eligible = false, allMarked = true;
  for (const { $from } of editor.state.selection.ranges) $from.parent.descendants((node, _pos, parent) => {
    if (node.type.spec.code) return false;
    if (node.isInline && parent?.type.allowsMarkType(mark)) { eligible = true; allMarked &&= !!mark.isInSet(node.marks); }
  });
  return eligible && styleSelectedCells(editor, [{ type, attrs: allMarked ? null : {} }]);
}
