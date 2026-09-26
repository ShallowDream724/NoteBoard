import { Fragment, Slice, type Node, type Schema } from '@tiptap/pm/model';
import { Step, StepResult, type Mappable } from '@tiptap/pm/transform';
import { annotationId } from './annotations/model';
import { validateFigureCaption, validateFigureCaptionContent } from './figureCaption';

type MetadataAttribute = 'annotationId' | 'caption' | 'captionContent';
function valid(attr: string, value: unknown): boolean {
  if (attr === 'annotationId') return value === null || annotationId(value) !== null;
  if (!['caption', 'captionContent'].includes(attr)) return false;
  try { (attr === 'caption' ? validateFigureCaption : validateFigureCaptionContent)(value); return true; } catch { return false; }
}

/** Preserve a closed block's content identity and positions for metadata edits.
 * AttrStep rebuilds the open fragment, invalidating large-table row caches. */
export class BlockMetadataStep extends Step {
  constructor(readonly pos: number, readonly attr: MetadataAttribute, readonly value: unknown) { super(); }
  apply(doc: Node) {
    const block = doc.nodeAt(this.pos);
    if (!block?.isBlock || !Object.hasOwn(block.attrs, this.attr) || !valid(this.attr, this.value)) return StepResult.fail('Invalid block metadata');
    const updated = block.type.create({ ...block.attrs, [this.attr]: this.value }, block.content, block.marks);
    return StepResult.fromReplace(doc, this.pos, this.pos + block.nodeSize, new Slice(Fragment.from(updated), 0, 0));
  }
  invert(doc: Node) { return new BlockMetadataStep(this.pos, this.attr, doc.nodeAt(this.pos)!.attrs[this.attr]); }
  map(mapping: Mappable) {
    const mapped = mapping.mapResult(this.pos, 1);
    return mapped.deletedAfter ? null : new BlockMetadataStep(mapped.pos, this.attr, this.value);
  }
  toJSON() { return { stepType: 'noteboardBlockMetadata', pos: this.pos, attr: this.attr, value: this.value }; }
  static fromJSON(_schema: Schema, json: { pos: number; attr: MetadataAttribute; value: unknown }) {
    if (!Number.isInteger(json.pos) || json.pos < 0 || !valid(json.attr, json.value)) throw new RangeError('Invalid block metadata step');
    return new BlockMetadataStep(json.pos, json.attr, json.value);
  }
}
Step.jsonID('noteboardBlockMetadata', BlockMetadataStep);
