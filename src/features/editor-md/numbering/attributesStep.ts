import { Fragment, type Node, type Schema } from '@tiptap/pm/model';
import { Step, StepResult, type Mappable } from '@tiptap/pm/transform';

export interface NumberingPatch { pos: number; attrs: Record<string, unknown> }
/** Changing a linked group rebuilds each ancestor once, rather than retaining
 * a whole new document root for every list fragment in a transaction/history. */
export class NumberingAttributesStep extends Step {
  readonly patches: NumberingPatch[];
  constructor(patches: NumberingPatch[]) { super(); this.patches = patches.slice().sort((a, b) => a.pos - b.pos); }
  apply(doc: Node) {
    for (const patch of this.patches) {
      const node = doc.nodeAt(patch.pos);
      if (node?.type.name !== 'orderedList' || Object.keys(patch.attrs).some(key => !['start', 'numbering', 'numberStyle'].includes(key))) return StepResult.fail('Invalid numbering patch');
    }
    let cursor = 0;
    const rewrite = (node: Node, pos: number): Node => {
      const own = this.patches[cursor]?.pos === pos ? this.patches[cursor++].attrs : null;
      let content = node.content;
      if (cursor < this.patches.length && this.patches[cursor].pos < pos + node.nodeSize) {
        const children: Node[] = []; let changed = false;
        node.forEach((child, offset) => {
          const at = pos + 1 + offset, pending = this.patches[cursor]?.pos;
          const next = pending !== undefined && pending >= at && pending < at + child.nodeSize ? rewrite(child, at) : child;
          children.push(next); changed ||= next !== child;
        });
        if (changed) content = Fragment.fromArray(children);
      }
      return own ? node.type.create({ ...node.attrs, ...own }, content, node.marks) : content === node.content ? node : node.copy(content);
    };
    return StepResult.ok(rewrite(doc, -1));
  }
  invert(doc: Node) { return new NumberingAttributesStep(this.patches.map(({ pos, attrs }) => ({ pos, attrs: Object.fromEntries(Object.keys(attrs).map(key => [key, doc.nodeAt(pos)!.attrs[key]])) }))); }
  map(mapping: Mappable) { const patches = this.patches.flatMap(patch => { const at = mapping.mapResult(patch.pos, 1); return at.deletedAfter ? [] : [{ ...patch, pos: at.pos }]; }); return patches.length ? new NumberingAttributesStep(patches) : null; }
  toJSON() { return { stepType: 'noteboardNumberingAttributes', patches: this.patches }; }
  static fromJSON(_schema: Schema, json: { patches: NumberingPatch[] }) {
    if (!Array.isArray(json.patches) || json.patches.some(patch => !Number.isInteger(patch.pos) || patch.pos < 0 || !patch.attrs || typeof patch.attrs !== 'object')) throw new RangeError('Invalid numbering patches');
    return new NumberingAttributesStep(json.patches);
  }
}
Step.jsonID('noteboardNumberingAttributes', NumberingAttributesStep);
