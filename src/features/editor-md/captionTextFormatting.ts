import type { Transaction } from '@tiptap/pm/state';
import { clearedFigureCaption } from './figureCaption';
import { BlockMetadataStep } from './blockMetadataStep';

/** Captions stored outside PM content still belong to a completely selected
 * figure. A cell rectangle excludes the table's outside caption. */
export function clearSelectedCaptionStyles(tr: Transaction): void {
  for (const { $from, $to } of tr.selection.ranges) tr.doc.nodesBetween($from.pos, $to.pos, (node, pos) => {
    if (node.type.name === 'annotationStore') return false;
    if (pos < $from.pos || pos + node.nodeSize > $to.pos || !['image', 'table'].includes(node.type.name)) return;
    const content = clearedFigureCaption(node.attrs);
    if (content) tr.step(new BlockMetadataStep(pos, 'captionContent', content));
  });
}
