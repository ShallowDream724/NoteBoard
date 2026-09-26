import type { Node } from '@tiptap/pm/model';
import { TextSelection, type Transaction } from '@tiptap/pm/state';

const terminalBlocks = new Set(['image', 'imageCollection', 'table', 'mathBlock', 'mermaidBlock', 'plantumlBlock', 'infographicBlock', 'horizontalRule', 'disclosure']);
export function needsDisclosureTail(node: Node): boolean {
  return node.type.name === 'disclosure' && !!node.lastChild && terminalBlocks.has(node.lastChild.type.name);
}
export function appendDisclosureParagraph(tr: Transaction, pos: number, focus = true): boolean {
  const node = tr.doc.nodeAt(pos);
  if (!node || !needsDisclosureTail(node)) return false;
  const end = pos + node.nodeSize - 1;
  tr.insert(end, tr.doc.type.schema.nodes.paragraph.create());
  if (focus) tr.setSelection(TextSelection.create(tr.doc, end + 1));
  return true;
}
/** Keep an insertion in its original disclosure, even if PM moved its new
 * selection outside an ending atom. Touch one ancestor path, not the document. */
export function ensureDisclosureTail(tr: Transaction, originalPos: number, focus = true): boolean {
  const at = tr.before.resolve(Math.max(0, Math.min(originalPos, tr.before.content.size)));
  for (let depth = at.depth; depth > 0; depth--) if (at.node(depth).type.name === 'disclosure') {
    const mapped = tr.mapping.mapResult(at.before(depth), 1);
    return !mapped.deletedAcross && appendDisclosureParagraph(tr, mapped.pos, focus);
  }
  return false;
}
