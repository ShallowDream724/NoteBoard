import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { AnnotationAnchor } from './model';

export const ANNOTATION_UNDERLINE_LIMIT = 100;
export interface AnnotationGroup { id: string; anchors: AnnotationAnchor[]; last: AnnotationAnchor }

/** Structural boundaries and empty paragraphs do not split a continuous selection.
 * Unreferenced text/atoms do: a reused note still needs an entrance at each location. */
function contentBetween(doc: ProseMirrorNode, from: number, to: number): boolean {
  if (from >= to) return false;
  let found = false;
  doc.nodesBetween(from, to, node => {
    if (found) return false;
    if (node.isText || node.isLeaf || node.type.name === 'annotationStore') found = true;
    return !found;
  });
  return found;
}

/** A view projection only. Never merge the stored anchors used by delete/undo. */
export function annotationGroups(doc: ProseMirrorNode, anchors: readonly AnnotationAnchor[]): AnnotationGroup[] {
  const groups: AnnotationGroup[] = [];
  for (const anchor of anchors) {
    const previous = groups.at(-1);
    if (previous?.id === anchor.id && !contentBetween(doc, previous.last.to, anchor.from)) {
      previous.anchors.push(anchor);
      if (anchor.to > previous.last.to) previous.last = anchor;
    } else groups.push({ id: anchor.id, anchors: [anchor], last: anchor });
  }
  return groups;
}

/** Count code points, not UTF-16 units; avoid copying long selected paragraphs. */
export function shortAnnotationRange(doc: ProseMirrorNode, group: AnnotationGroup): boolean {
  if (group.anchors.length !== 1 || group.last.block) return false;
  const { from, to } = group.last;
  if (to - from > ANNOTATION_UNDERLINE_LIMIT * 2) return false;
  const start = doc.resolve(from), end = doc.resolve(to);
  if (!start.sameParent(end) || !start.parent.isTextblock || start.parent.type.name === 'codeBlock') return false;
  const length = Array.from(doc.textBetween(from, to, '', '\uFFFC')).length;
  return length > 0 && length <= ANNOTATION_UNDERLINE_LIMIT;
}
