import { Fragment, Slice, type Node, type Schema } from '@tiptap/pm/model';
import { Step, StepResult, type Mappable } from '@tiptap/pm/transform';

export function applyNodeAttributes(doc: Node, pos: number, attrs: Record<string, unknown>): StepResult {
  const node = doc.nodeAt(pos);
  if (!node || node.isText || Object.keys(attrs).some(key => !Object.hasOwn(node.attrs, key))) return StepResult.fail('Invalid node attributes');
  const next = node.type.create({ ...node.attrs, ...attrs }, node.content, node.marks);
  return StepResult.fromReplace(doc, pos, pos + node.nodeSize, new Slice(Fragment.from(next), 0, 0));
}

/** Update a node's attributes with empty position maps and shared child content.
 * Upstream AttrStep rebuilds non-leaf fragments, invalidating container caches. */
export class NodeAttributesStep extends Step {
  constructor(readonly pos: number, readonly attrs: Record<string, unknown>) { super(); }
  apply(doc: Node) { return applyNodeAttributes(doc, this.pos, this.attrs); }
  invert(doc: Node) { return new NodeAttributesStep(this.pos, doc.nodeAt(this.pos)!.attrs); }
  map(mapping: Mappable) {
    const mapped = mapping.mapResult(this.pos, 1);
    return mapped.deletedAfter ? null : new NodeAttributesStep(mapped.pos, this.attrs);
  }
  toJSON() { return { stepType: 'noteboardNodeAttributes', pos: this.pos, attrs: this.attrs }; }
  static fromJSON(_schema: Schema, json: { pos: number; attrs: Record<string, unknown> }) {
    if (!Number.isInteger(json.pos) || json.pos < 0 || !json.attrs || typeof json.attrs !== 'object' || Array.isArray(json.attrs)) throw new RangeError('Invalid node attributes step');
    return new NodeAttributesStep(json.pos, json.attrs);
  }
}
Step.jsonID('noteboardNodeAttributes', NodeAttributesStep);
