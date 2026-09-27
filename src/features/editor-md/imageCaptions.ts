import { Fragment, Slice, type Node, type Schema } from '@tiptap/pm/model';
import { NodeSelection, type EditorState } from '@tiptap/pm/state';
import { figureCaptionContent, figureCaptionText } from './figureCaption';

/** A standalone image owns attribute captions; a collection slot owns one paragraph. */
export function imageCaptionParagraph(image: Node, schema: Schema): Node | null {
  const content = figureCaptionContent(image.attrs.caption, image.attrs.captionContent);
  return content.length ? schema.nodes.paragraph.create(null, content.map(node => schema.nodeFromJSON(node))) : null;
}

export function normalizeImageSlot(slot: Node): Node {
  const image = slot.firstChild?.type.name === 'image' ? slot.firstChild : null;
  if (!image || (image.attrs.caption == null && image.attrs.captionContent == null)) return slot;
  const source = imageCaptionParagraph(image, slot.type.schema);
  let caption = slot.lastChild?.type.name === 'paragraph' ? slot.lastChild : null;
  if (source) {
    if (!caption?.content.size) caption = source;
    else if (caption.textContent === source.textContent && !caption.content.toJSON()?.some((node: { marks?: unknown[] }) => node.marks?.length)) caption = caption.copy(source.content);
    else if (caption.textContent !== source.textContent) {
      const separator = slot.type.schema.nodes.hardBreak?.create();
      caption = caption.copy(caption.content.append(separator ? Fragment.from(separator) : Fragment.from(slot.type.schema.text(' '))).append(source.content));
    }
  }
  const cleanImage = image.type.create({ ...image.attrs, caption: null, captionContent: null }, image.content, image.marks);
  return slot.copy(Fragment.from(caption ? [cleanImage, caption] : [cleanImage]));
}

export function normalizeImageSlots(node: Node): Node {
  if (node.type.name === 'imageSlot') return normalizeImageSlot(node);
  if (node.isLeaf) return node;
  let changed = false;
  const children: Node[] = [];
  node.forEach(child => { const next = normalizeImageSlots(child); changed ||= next !== child; children.push(next); });
  return changed ? node.copy(Fragment.from(children)) : node;
}

/** Copying just the image still carries the slot's formatted caption. */
export function imageSelectionSlice(state: EditorState): Slice {
  const { selection } = state;
  if (!(selection instanceof NodeSelection) || selection.node.type.name !== 'image' || selection.$from.parent.type.name !== 'imageSlot') return selection.content();
  const caption = selection.$from.parent.lastChild;
  if (caption?.type.name !== 'paragraph' || !caption.content.size) return selection.content();
  const content = caption.content.toJSON();
  const image = selection.node;
  return new Slice(Fragment.from(image.type.create({ ...image.attrs, caption: figureCaptionText(content), captionContent: content }, image.content, image.marks)), 0, 0);
}
