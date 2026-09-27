import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

/** A picture's context menu belongs to that picture, not a stale selection. */
export function selectContextMenuTarget(view: EditorView, target: EventTarget | null, point: { x: number; y: number }): void {
  const element = target instanceof Element ? target : null;
  const image = element?.closest('.nb-image, img');
  if (image && view.dom.contains(image) && !element?.closest('[data-caption-host], [data-image-caption]')) {
    const pos = view.posAtDOM(image, 0);
    for (const at of [pos, pos - 1]) if (at >= 0 && view.state.doc.nodeAt(at)?.type.name === 'image') {
      view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, at))); return;
    }
  }
  if (!view.state.selection.empty) return;
  const found = view.posAtCoords({ left: point.x, top: point.y });
  if (found) view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(found.pos))));
}
