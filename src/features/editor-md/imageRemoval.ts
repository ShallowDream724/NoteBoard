import { Fragment, type Node } from '@tiptap/pm/model';
import { NodeSelection, TextSelection, type EditorState } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { dispatchDiscreteEdit } from './discreteEdit';
import { imageCaptionParagraph, normalizeImageSlot } from './imageCaptions';
import { resolveImageCaptionRemoval } from './imageCaptionRemoval';

export function imageRemovalContent(state: EditorState, pos: number) {
  const image = state.doc.nodeAt(pos);
  if (image?.type.name !== 'image') return null;
  const at = state.doc.resolve(pos), inSlot = at.parent.type.name === 'imageSlot';
  const slot = inSlot ? normalizeImageSlot(at.parent) : null;
  const caption = slot ? (slot.lastChild?.type.name === 'paragraph' ? slot.lastChild : null) : imageCaptionParagraph(image, state.schema);
  return { image, at, inSlot, caption, hasCaption: !!caption?.content.size, hasAnnotations: !!image.attrs.annotationId || !!caption?.attrs.annotationId };
}

/** One structural edit owns the image and its caption; asset lifecycle observes it normally. */
export function imageRemovalTransaction(state: EditorState, pos: number, choice: 'remove' | 'keep') {
  const target = imageRemovalContent(state, pos); if (!target) return null;
  const { image, at, inSlot } = target;
  let caption = choice === 'keep' ? target.caption : null;
  let extraAnchor: Node | null = null;
  if (choice === 'keep' && image.attrs.annotationId) {
    caption ??= state.schema.nodes.paragraph.create();
    // Keeping the attachment must retain an anchor so orphan cleanup does not remove its body.
    if (caption.attrs.annotationId && caption.attrs.annotationId !== image.attrs.annotationId) extraAnchor = state.schema.nodes.paragraph.create({ annotationId: image.attrs.annotationId });
    else caption = caption.type.create({ ...caption.attrs, annotationId: image.attrs.annotationId }, caption.content, caption.marks);
  }
  const tr = state.tr;
  if (inSlot) {
    tr.replaceWith(at.before(), at.after(), at.parent.copy(caption ? Fragment.from(caption) : Fragment.empty));
    if (caption) tr.setSelection(TextSelection.create(tr.doc, at.start() + 1));
    else tr.setSelection(NodeSelection.create(tr.doc, at.before(at.depth - 1)));
    if (extraAnchor) tr.insert(tr.mapping.map(at.after(at.depth - 1), -1), extraAnchor);
  } else {
    if (caption) tr.replaceWith(pos, pos + image.nodeSize, caption);
    else tr.delete(pos, pos + image.nodeSize);
    tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(pos + (caption ? 1 : 0), tr.doc.content.size))));
  }
  return tr;
}

const pending = new WeakSet<EditorView>();
export async function requestImageRemoval(view: EditorView, pos: number | undefined): Promise<boolean> {
  if (pos === undefined || view.isDestroyed || !view.editable || pending.has(view)) return false;
  const target = imageRemovalContent(view.state, pos); if (!target) return false;
  pending.add(view);
  try {
    const choice = await resolveImageCaptionRemoval(target);
    if (!choice || view.isDestroyed || !view.editable) return false;
    // Immutable node identity follows unrelated edits without deleting a replacement image.
    let current: number | undefined;
    view.state.doc.descendants((node: Node, at: number) => { if (node === target.image) current = at; return current === undefined; });
    if (current === undefined) return false;
    const tr = imageRemovalTransaction(view.state, current, choice); if (!tr) return false;
    dispatchDiscreteEdit(view, tr.scrollIntoView()); view.focus(); return true;
  } finally { pending.delete(view); }
}
