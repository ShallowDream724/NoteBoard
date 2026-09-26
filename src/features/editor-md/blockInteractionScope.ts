import type { Node, ResolvedPos } from '@tiptap/pm/model';
import type { Selection } from '@tiptap/pm/state';

/** Inspect only the ancestor path, never the surrounding document. */
export function disclosureDepth(at: ResolvedPos): number {
  let count = 0;
  for (let depth = at.depth; depth > 0; depth--) if (at.node(depth).type.name === 'disclosure') count++;
  return count;
}
export function selectionAllowsAuxiliaryControls(selection: Selection): boolean {
  return disclosureDepth(selection.$from) <= 1 && disclosureDepth(selection.$to) <= 1;
}
/** -1 is the document; null is an unsupported nested editing scope. */
export function blockInteractionScope(at: ResolvedPos): number | null {
  let scope = -1;
  for (let depth = 1; depth <= at.depth; depth++) {
    const name = at.node(depth).type.name;
    if (name === 'disclosure') {
      if (scope !== -1) return null;
      scope = at.before(depth);
    } else if (!['bulletList', 'orderedList', 'taskList', 'listItem', 'taskItem'].includes(name)) return null;
  }
  return scope;
}
export function isBlockInteractionTarget(doc: Node, pos: number): boolean {
  if (pos < 0 || pos >= doc.content.size) return false;
  const at = doc.resolve(pos), node = doc.nodeAt(pos);
  if (!node?.isBlock || ['documentPresentation', 'annotationStore'].includes(node.type.name)) return false;
  const scope = blockInteractionScope(at);
  if (scope === null || node.type.name === 'disclosure' && scope !== -1) return false;
  return at.depth === 0 || at.parent.type.name === 'disclosure' || ['listItem', 'taskItem'].includes(node.type.name);
}
export function isEmptyParagraph(node: Node | null | undefined): boolean {
  return node?.type.name === 'paragraph' && node.content.size === 0;
}
