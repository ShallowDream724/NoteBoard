import { Fragment, Slice, type Node } from '@tiptap/pm/model';
import { TextSelection, type EditorState, type Selection } from '@tiptap/pm/state';
import { normalizeImageSlot } from './imageCaptions';

export function imageSlotPosition(state: EditorState, position: number): number | undefined {
  const at = state.doc.resolve(Math.max(0, Math.min(position, state.doc.content.size)));
  for (let depth = at.depth; depth > 0; depth--) if (at.node(depth).type.name === 'imageSlot' && at.node(depth - 1).type.name === 'imageCollection') return at.start(depth);
}

/** Recognize a picture payload without stripping real text or collection layout. */
export function imageOnlySlice(slice: Slice): Node[] | null {
  const images: Node[] = []; let valid = true;
  slice.content.forEach(node => {
    if (node.type.name === 'image') images.push(node);
    else if (node.type.name === 'paragraph' && !node.content.size) { /* HTML image wrappers may leave an empty paragraph. */ }
    else valid = false;
  });
  return valid && images.length ? images : null;
}

/** All picture sources use these structural insertion rules. A slot's image and
 * caption are never handed to ProseMirror's generic slice fitting algorithm. */
export function imageInsertionTransaction(state: EditorState, images: Node[], selection: Selection, position?: number) {
  const tr = state.tr, raw = Math.max(0, Math.min(position ?? selection.from, tr.doc.content.size));
  const at = tr.doc.resolve(raw); let firstImage: number | undefined;
  let slotDepth = -1;
  for (let depth = at.depth; depth > 0; depth--) if (at.node(depth).type.name === 'imageSlot') { slotDepth = depth; break; }
  if (slotDepth >= 0 && at.node(slotDepth - 1).type.name === 'imageCollection') {
    const collection = at.node(slotDepth - 1), start = at.before(slotDepth - 1), slotIndex = at.index(slotDepth - 1);
    const appended = []; let next = 0, offset = 0;
    for (let index = 0; index < collection.childCount; index++) {
      const slot = collection.child(index);
      if (index >= slotIndex && next < images.length && slot.firstChild?.type.name !== 'image') {
        const pos = start + 1 + offset, mapped = tr.mapping.map(pos, 1);
        tr.replaceWith(mapped, tr.mapping.map(pos + slot.nodeSize, -1), normalizeImageSlot(slot.copy(Fragment.from(images[next++]).append(slot.content))));
        firstImage ??= mapped + 1;
      }
      offset += slot.nodeSize;
    }
    const appendAt = tr.mapping.map(start + collection.nodeSize - 1, -1);
    while (next < images.length) appended.push(normalizeImageSlot(state.schema.nodes.imageSlot.create(null, images[next++])));
    if (appended.length) { tr.insert(appendAt, appended); firstImage ??= appendAt + 1; }
    // Keep the caret/caption selection where it was; targeting a slot must not
    // turn the next paste into replacement of the just-inserted image.
  } else {
    const content = Fragment.from(images);
    const blank = at.parent.type.name === 'paragraph' && !at.parent.content.size && at.depth > 0;
    if (blank && (position !== undefined || selection.empty)) tr.replaceWith(at.before(), at.after(), content);
    else if (position !== undefined && at.parent.canReplace(at.index(), at.index(), content)) tr.insert(raw, content);
    else tr.setSelection(selection).replaceSelection(new Slice(content, 0, 0));
    tr.mapping.maps[0]?.forEach((_from, _to, from, to) => {
      tr.doc.nodesBetween(from, to, (node, pos) => {
        if (firstImage !== undefined) return false;
        if (node.type.name === 'image') { firstImage = pos; return false; }
      });
    });
    if (firstImage !== undefined) {
      // An image insertion always leaves a writable line below the final image.
      // Reuse an existing paragraph created by splitting text or paste at an end.
      let after = firstImage;
      for (const image of images) after += image.nodeSize;
      const next = tr.doc.nodeAt(after);
      if (next?.type.name !== 'paragraph') tr.insert(after, state.schema.nodes.paragraph.create());
      tr.setSelection(TextSelection.create(tr.doc, after + 1));
    }
  }
  return { tr, firstImage, inCollection: slotDepth >= 0 };
}
