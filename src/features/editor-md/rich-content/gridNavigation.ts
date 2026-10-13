import type { Node } from '@tiptap/pm/model';
import { NodeSelection, Selection, TextSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { imageGridColumns } from '../../../core/document/imageGrid';

type Direction = -1 | 1;
export type GridControlStop = { slotPos: number; part: 'image' | 'caption' };
type Slot = { node: Node; pos: number; imagePos: number | null; captionPos: number | null };
type Grid = { node: Node; pos: number; slots: Slot[]; index: number; part: 'image' | 'caption' | 'collection' };

function currentGrid(view: EditorView, control?: GridControlStop): Grid | null {
  const { selection, doc } = view.state;
  const at = control ? doc.resolve(Math.min(control.slotPos, doc.content.size)) : selection.$from;
  let node: Node | null = null, pos = 0, slotPos: number | null = control?.slotPos ?? null;
  if (!control && selection instanceof NodeSelection && selection.node.type.name === 'imageCollection') {
    node = selection.node; pos = selection.from;
  } else {
    for (let depth = at.depth; depth > 0; depth--) {
      if (at.node(depth).type.name === 'imageSlot') slotPos = at.before(depth);
      if (at.node(depth).type.name === 'imageCollection') { node = at.node(depth); pos = at.before(depth); break; }
    }
    if (!control && selection instanceof NodeSelection && selection.node.type.name === 'imageSlot') slotPos = selection.from;
  }
  if (!node || node.attrs.layout !== 'grid') return null;
  const slots: Slot[] = [];
  node.forEach((slot, offset) => {
    const start = pos + 1 + offset;
    slots.push({ node: slot, pos: start,
      imagePos: slot.firstChild?.type.name === 'image' ? start + 1 : null,
      captionPos: slot.lastChild?.type.name === 'paragraph' ? start + slot.nodeSize - 1 - slot.lastChild.nodeSize : null });
  });
  const index = slots.findIndex(slot => slot.pos === slotPos);
  const part = control?.part ?? (index < 0 ? 'collection' : selection instanceof TextSelection ? 'caption' : 'image');
  return { node, pos, slots, index, part };
}

function select(view: EditorView, selection: Selection): boolean {
  view.dispatch(view.state.tr.setSelection(selection).scrollIntoView());
  view.focus();
  return true;
}

function focusControl(view: EditorView, slot: Slot, part: GridControlStop['part']): boolean {
  const dom = view.nodeDOM(slot.pos);
  const button = dom instanceof HTMLElement
    ? dom.querySelector<HTMLButtonElement>(part === 'image' ? '.nb-image-slot-empty' : '.nb-image-caption-add') : null;
  if (!button || button.hidden) return false;
  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, slot.imagePos ?? slot.pos)).scrollIntoView());
  button.focus({ preventScroll: true });
  return true;
}

function imageStop(view: EditorView, slot: Slot): boolean {
  return slot.imagePos !== null
    ? select(view, NodeSelection.create(view.state.doc, slot.imagePos))
    : focusControl(view, slot, 'image') || select(view, NodeSelection.create(view.state.doc, slot.pos));
}

function captionStop(view: EditorView, slot: Slot, direction: Direction): boolean {
  if (slot.captionPos !== null) {
    const caption = view.state.doc.nodeAt(slot.captionPos)!;
    return select(view, TextSelection.create(view.state.doc, slot.captionPos + 1 + (direction < 0 ? caption.content.size : 0)));
  }
  return slot.imagePos !== null && focusControl(view, slot, 'caption');
}

/** Leave the grid without manufacturing writing paragraphs or visiting metadata. */
function leaveGrid(view: EditorView, grid: Grid, direction: Direction): boolean {
  const boundary = direction < 0 ? grid.pos : grid.pos + grid.node.nodeSize;
  const selection = Selection.findFrom(view.state.doc.resolve(boundary), direction);
  if (selection) {
    const at = selection.$from;
    for (let depth = at.depth; depth > 0; depth--) if (at.node(depth).type.name === 'annotationStore') return true;
    if (!(selection instanceof NodeSelection && selection.node.type.name === 'annotationStore')) return select(view, selection);
  }
  return true;
}

/** Grid navigation follows visual axes; carousel paging remains owned by its view.
 * Absent captions use the existing add-caption control as a transient stop. Only
 * activating that control writes a paragraph. No navigation state is persisted. */
export function handleImageGridNavigation(view: EditorView, event: KeyboardEvent, control?: GridControlStop): boolean {
  if (!view.editable || view.composing || event.defaultPrevented || event.isComposing || event.keyCode === 229
    || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey
    || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return false;
  const { selection } = view.state;
  if (!control && (!(selection instanceof NodeSelection) && (!(selection instanceof TextSelection) || !selection.empty))) return false;
  const grid = currentGrid(view, control);
  if (!grid) return false;
  const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight';
  const direction: Direction = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
  if (grid.part === 'collection') {
    if (!horizontal) return leaveGrid(view, grid, direction);
    const slot = grid.slots[direction > 0 ? 0 : grid.slots.length - 1];
    return slot ? imageStop(view, slot) : true;
  }
  const slot = grid.slots[grid.index];
  if (!slot) return false;
  if (grid.part === 'caption' && !control) {
    const at = selection.$from;
    const edge = direction < 0 ? 0 : at.parent.content.size;
    if (at.parentOffset !== edge && (horizontal || !view.endOfTextblock(direction < 0 ? 'up' : 'down'))) return false;
  }
  if (horizontal) {
    if (grid.part === 'caption' && direction < 0) return imageStop(view, slot);
    const next = grid.slots[grid.index + direction];
    return next ? imageStop(view, next) : leaveGrid(view, grid, direction);
  }
  if (grid.part === 'caption' && direction < 0) return imageStop(view, slot);
  if (grid.part === 'image' && direction > 0 && captionStop(view, slot, direction)) return true;
  const next = grid.slots[grid.index + direction * imageGridColumns(grid.node.attrs.columns)];
  if (!next) return leaveGrid(view, grid, direction);
  return direction < 0 && captionStop(view, next, direction) || imageStop(view, next);
}
