import type { EditorView } from '@tiptap/pm/view';
import type { FileDropPoint } from '../../core/editor/fileDropTargets';

export interface ImageDropTarget { position: number; slot?: HTMLElement; line?: number; block?: HTMLElement }
/** Always test the visible hit element, so an overlay or another editor cannot claim the slot below it. */
export function imageSlotAtPoint(view: EditorView, point: FileDropPoint): ImageDropTarget | undefined {
  const hit = view.dom.ownerDocument.elementFromPoint(point.x, point.y);
  if (!hit || hit.closest('.ProseMirror') !== view.dom) return;
  const slot = hit.closest<HTMLElement>('[data-image-slot], [data-nb-image-slot]');
  if (!slot || !view.dom.contains(slot)) return;
  try {
    const pos = view.posAtDOM(slot, 0), $pos = view.state.doc.resolve(pos);
    const position = $pos.parent.type.name === 'imageSlot' ? pos : pos + 1;
    if (view.state.doc.resolve(position).parent.type.name === 'imageSlot') return { position, slot };
  } catch { /* A node view may have been removed between the hit and its position lookup. */ }
}
export function imageDropTargetAtPoint(view: EditorView, point: FileDropPoint): ImageDropTarget | undefined {
  const hitElement = view.dom.ownerDocument.elementFromPoint(point.x, point.y);
  if (!view.editable || view.dom.closest('[inert]') || hitElement?.closest('.ProseMirror') !== view.dom) return;
  const slot = imageSlotAtPoint(view, point); if (slot) return slot;
  // Text inputs and embedded editors own their own editing semantics.
  if (hitElement.closest('input, textarea, [role="textbox"]:not(.ProseMirror)')) return;
  const hit = view.posAtCoords({ left: point.x, top: point.y }); if (!hit) return;
  const { doc } = view.state;
  const at = doc.resolve(hit.pos);
  // Only walk the hit's ancestors. A visual line is never an insertion boundary;
  // lists, tables and code stay intact. First-level disclosures keep local drops.
  let depth = 1;
  if (at.depth > 1 && at.node(1).type.name === 'disclosure') depth = 2;
  let start = at.depth >= depth ? at.before(depth) : hit.pos;
  if (start === doc.content.size && start > 0) start -= doc.lastChild!.nodeSize;
  const node = doc.nodeAt(start), block = view.nodeDOM(start);
  if (!node?.isBlock || !(block instanceof HTMLElement)) return;
  const box = block.getBoundingClientRect();
  const after = point.y >= (box.top + box.bottom) / 2;
  return { position: after ? start + node.nodeSize : start, line: after ? box.bottom : box.top, block };
}
export function createImageDropIndicator(view: EditorView) {
  let marker: HTMLElement | null = null;
  const clear = () => { marker?.remove(); marker = null; };
  return { clear, show(target: ImageDropTarget) {
    clear(); const box = (target.slot ?? target.block ?? view.dom).getBoundingClientRect();
    marker = view.dom.ownerDocument.createElement('div');
    marker.dataset.imageDropIndicator = target.slot ? 'slot' : 'block';
    marker.setAttribute('role', 'status');
    const label = target.slot ? target.slot.dataset.empty === 'false' ? '释放图片以添加到后续空位' : '释放图片以填入此处' : '释放图片以插入文档';
    marker.setAttribute('aria-label', label);
    if (target.slot) marker.textContent = label;
    marker.style.cssText = `position:fixed;pointer-events:none;z-index:9999;box-sizing:border-box;left:${box.left}px;top:${target.slot ? box.top : target.line}px;width:${box.width}px;${target.slot ? `height:${box.height}px;border:2px solid var(--editor-accent);background:color-mix(in srgb,var(--editor-accent) 10%,transparent);display:flex;align-items:center;justify-content:center;overflow:hidden;color:var(--editor-accent);font-size:12px;padding:4px 8px;` : 'height:0;border-top:2px solid var(--editor-accent);'}`;
    view.dom.ownerDocument.body.append(marker);
  } };
}

/** Coordinates expire on leaving the document/window; paste rechecks what is actually visible there. */
export function trackImagePastePointer(view: EditorView): { slot(): ImageDropTarget | undefined; destroy(): void } {
  const doc = view.dom.ownerDocument, win = doc.defaultView;
  let point: FileDropPoint | null = null;
  const move = (event: PointerEvent) => { point = { x: event.clientX, y: event.clientY }; };
  const leave = () => { point = null; };
  const out = (event: PointerEvent) => { if (!event.relatedTarget) leave(); };
  doc.addEventListener('pointermove', move, true); doc.addEventListener('pointerover', move, true);
  doc.addEventListener('pointerout', out, true); doc.addEventListener('pointerleave', leave); win?.addEventListener('blur', leave);
  return { slot: () => {
    const target = point ? imageSlotAtPoint(view, point) : undefined;
    // Hover is an explicit insertion target only for an empty slot. Existing
    // images and caption text must not redirect another caret's paste.
    return target?.slot?.dataset.empty === 'true' ? target : undefined;
  }, destroy() {
    doc.removeEventListener('pointermove', move, true); doc.removeEventListener('pointerover', move, true);
    doc.removeEventListener('pointerout', out, true); doc.removeEventListener('pointerleave', leave); win?.removeEventListener('blur', leave);
  } };
}
