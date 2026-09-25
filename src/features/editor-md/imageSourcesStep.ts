import { Fragment, type Node, type Schema } from '@tiptap/pm/model';
import { Step, StepResult, type Mappable } from '@tiptap/pm/transform';

interface ImagePatch { pos: number; src: string }
/** One attribute-only tree pass. Empty position mapping keeps selections and
 * prior undo events stable even in a flat document containing many images. */
export class ImageSourcesStep extends Step {
  constructor(readonly patches: readonly ImagePatch[]) { super(); }
  apply(doc: Node): StepResult {
    const patches = new Map(this.patches.map(patch => [patch.pos, patch.src]));
    const update = (node: Node, pos: number): Node => {
      const src = patches.get(pos);
      if (node.type.name === 'image' && src !== undefined) { patches.delete(pos); return node.type.create({ ...node.attrs, src }, node.content, node.marks); }
      if (!node.childCount) return node;
      let changed = false; const children: Node[] = [];
      node.forEach((child, offset) => { const next = update(child, pos + 1 + offset); children.push(next); changed ||= child !== next; });
      return changed ? node.copy(Fragment.fromArray(children)) : node;
    };
    const updated = update(doc, -1);
    return patches.size ? StepResult.fail('图片位置已改变') : StepResult.ok(updated);
  }
  invert(doc: Node): ImageSourcesStep {
    const positions = new Set(this.patches.map(patch => patch.pos)), patches: ImagePatch[] = [];
    doc.descendants((node, pos) => { if (positions.has(pos)) patches.push({ pos, src: node.attrs.src }); });
    return new ImageSourcesStep(patches);
  }
  map(mapping: Mappable): ImageSourcesStep | null {
    const patches: ImagePatch[] = [];
    for (const patch of this.patches) { const position = mapping.mapResult(patch.pos, 1); if (!position.deletedAcross) patches.push({ ...patch, pos: position.pos }); }
    return patches.length ? new ImageSourcesStep(patches) : null;
  }
  toJSON() { return { stepType: 'noteboardImageSources', patches: this.patches }; }
  static fromJSON(_schema: Schema, json: { patches: ImagePatch[] }) {
    if (!Array.isArray(json.patches) || json.patches.some(patch => !Number.isInteger(patch.pos) || typeof patch.src !== 'string')) throw new RangeError('Invalid image source step');
    return new ImageSourcesStep(json.patches);
  }
}
Step.jsonID('noteboardImageSources', ImageSourcesStep);
