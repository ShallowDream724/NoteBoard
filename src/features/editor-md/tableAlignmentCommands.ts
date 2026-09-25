import type { Editor } from '@tiptap/core';
import { Fragment, Slice, type Node, type Schema } from '@tiptap/pm/model';
import { Step, StepResult, type Mappable } from '@tiptap/pm/transform';
import { runWithDocumentCapability } from '../document-format/featureGate';
import { dispatchDiscreteEdit } from './discreteEdit';
import { tableAlignment, type TableAlignment } from './tableAlignment';

/** AttrStep rebuilds an open node's Fragment. Replacing this closed table while
 * keeping an empty position map preserves rows, selection and layout caches. */
export class TableAlignmentStep extends Step {
  constructor(readonly pos: number, readonly value: TableAlignment | null) { super(); }
  apply(doc: Node) {
    const table = doc.nodeAt(this.pos);
    if (table?.type.name !== 'table' || this.value !== null && !tableAlignment(this.value)) return StepResult.fail('Invalid table alignment');
    const aligned = table.type.create({ ...table.attrs, tableAlign: this.value }, table.content, table.marks);
    return StepResult.fromReplace(doc, this.pos, this.pos + table.nodeSize, new Slice(Fragment.from(aligned), 0, 0));
  }
  invert(doc: Node) { return new TableAlignmentStep(this.pos, tableAlignment(doc.nodeAt(this.pos)?.attrs.tableAlign)); }
  map(mapping: Mappable) {
    const mapped = mapping.mapResult(this.pos, 1);
    return mapped.deletedAfter ? null : new TableAlignmentStep(mapped.pos, this.value);
  }
  toJSON() { return { stepType: 'noteboardTableAlignment', pos: this.pos, value: this.value }; }
  static fromJSON(_schema: Schema, json: { pos: number; value: unknown }) {
    if (!Number.isInteger(json.pos) || json.pos < 0 || json.value !== null && !tableAlignment(json.value)) throw new RangeError('Invalid table alignment step');
    return new TableAlignmentStep(json.pos, tableAlignment(json.value));
  }
}
Step.jsonID('noteboardTableAlignment', TableAlignmentStep);

/** The block position targets one table even when the caret is in another block. */
export function setTableAlignment(editor: Editor, pos: number, alignment: TableAlignment): boolean {
  if (editor.isDestroyed || !tableAlignment(alignment) || editor.state.doc.nodeAt(pos)?.type.name !== 'table') return false;
  return runWithDocumentCapability(editor, 'tableAlignment', next => {
    const table = next.state.doc.nodeAt(pos);
    if (table?.type.name !== 'table' || table.attrs.tableAlign === alignment) return false;
    dispatchDiscreteEdit(next.view, next.state.tr.step(new TableAlignmentStep(pos, alignment)));
    next.view.focus();
    return true;
  });
}
