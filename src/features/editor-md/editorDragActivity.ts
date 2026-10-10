import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

export const EDITOR_DRAG_ACTIVITY = 'nb-editor-drag-activity';
const activities = new WeakMap<EditorView, Set<symbol>>();

export function isEditorDragging(view: EditorView): boolean {
  return !!activities.get(view)?.size || !!view.dragging;
}

/** One lease per actual gesture, never per pointer frame or document node.
 * Releasing a cancelled/old gesture cannot clear another gesture's ownership. */
export function beginEditorDrag(view: EditorView): () => void {
  const owners = activities.get(view) ?? new Set<symbol>();
  activities.set(view, owners);
  const lease = Symbol();
  owners.add(lease);
  if (owners.size === 1) {
    view.dom.classList.add('nb-editor-dragging');
    view.dom.dispatchEvent(new Event(EDITOR_DRAG_ACTIVITY));
    if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta('bubbleMenu', 'hide').setMeta('addToHistory', false));
  }
  return () => {
    if (activities.get(view) !== owners || !owners.delete(lease) || owners.size) return;
    activities.delete(view);
    view.dom.classList.remove('nb-editor-dragging');
    view.dom.dispatchEvent(new Event(EDITOR_DRAG_ACTIVITY));
  };
}

/** Native text/image drags share the same gate as pointer-based block/table
 * gestures. DOM ownership is temporary and is released when the view dies. */
export const EditorDragActivity = Extension.create({
  name: 'editorDragActivity',
  addProseMirrorPlugins() {
    return [new Plugin({ view(view) {
      const document = view.dom.ownerDocument;
      let end: (() => void) | undefined;
      const start = () => { end?.(); end = beginEditorDrag(view); };
      const finish = () => {
        if (!end) return;
        // Outside drop/blur may never reach ProseMirror's own drop handler.
        // Clear its native drag slice before notifying presentation listeners.
        view.dragging = null;
        end(); end = undefined;
      };
      view.dom.addEventListener('dragstart', start);
      document.addEventListener('dragend', finish);
      document.addEventListener('drop', finish);
      document.defaultView?.addEventListener('blur', finish);
      return { destroy() {
        finish(); activities.delete(view); view.dom.classList.remove('nb-editor-dragging');
        view.dom.removeEventListener('dragstart', start);
        document.removeEventListener('dragend', finish);
        document.removeEventListener('drop', finish);
        document.defaultView?.removeEventListener('blur', finish);
      } };
    } })];
  },
});
