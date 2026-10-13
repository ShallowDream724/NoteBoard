import type { Editor } from '@tiptap/core';
import { useLayoutStore } from '../../stores/layoutStore';

export const BOOKMARK_PANEL_REVEAL = 'noteboard-bookmark-panel-reveal';
const pending = new WeakMap<Editor, string>();

/** Retain only until the panel mounts; inactive editors cannot keep each other alive. */
export function revealBookmarkInPanel(editor: Editor, id: string) {
  if (editor.isDestroyed) return;
  pending.set(editor, id);
  const layout = useLayoutStore.getState();
  layout.setNavigationTab('bookmarks');
  layout.setOutlineVisible(true);
  editor.view.dom.dispatchEvent(new Event(BOOKMARK_PANEL_REVEAL));
}

export function pendingBookmarkReveal(editor: Editor) { return pending.get(editor); }
export function consumeBookmarkReveal(editor: Editor) { pending.delete(editor); }
