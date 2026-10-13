import { useCallback, useEffect, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { bookmarkKey } from './extension';
import { removeBookmark } from './commands';
import { BookmarkContextMenu, type BookmarkMenuAnchor } from './BookmarkContextMenu';
import { revealBookmarkInPanel } from './panelNavigation';

/** One delegated listener set per active editor, never one subscription per marker. */
export function BookmarkMarkerLayer({ editor }: { editor: Editor }) {
  const [menu, setMenu] = useState<BookmarkMenuAnchor | null>(null);
  const close = useCallback(() => setMenu(null), []);
  useEffect(() => {
    const dom = editor.view.dom;
    const marker = (event: Event) => event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>('.nb-bookmark-button[data-bookmark-id]') : null;
    const pointer = (event: PointerEvent) => { if (marker(event)) { event.preventDefault(); event.stopPropagation(); } };
    const click = (event: MouseEvent) => {
      const button = marker(event); if (!button) return;
      event.preventDefault(); event.stopPropagation(); close();
      revealBookmarkInPanel(editor, button.dataset.bookmarkId!);
    };
    const context = (event: MouseEvent) => {
      const button = marker(event); if (!button) return;
      event.preventDefault(); event.stopPropagation();
      const bounds = button.getBoundingClientRect();
      setMenu({ id: button.dataset.bookmarkId!, trigger: button,
        x: event.clientX || bounds.left, y: event.clientY || bounds.bottom });
    };
    const key = (event: KeyboardEvent) => {
      const button = marker(event); if (!button) return;
      if (event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey) {
        event.preventDefault(); event.stopPropagation(); const bounds = button.getBoundingClientRect();
        setMenu({ id: button.dataset.bookmarkId!, trigger: button, x: bounds.left, y: bounds.bottom });
      }
    };
    const update = () => setMenu(current => current && !bookmarkKey.getState(editor.state)?.some(record => record.id === current.id) ? null : current);
    dom.addEventListener('pointerdown', pointer, true); dom.addEventListener('mousedown', pointer as EventListener, true);
    dom.addEventListener('click', click, true); dom.addEventListener('contextmenu', context, true); dom.addEventListener('keydown', key, true);
    editor.on('transaction', update);
    return () => {
      dom.removeEventListener('pointerdown', pointer, true); dom.removeEventListener('mousedown', pointer as EventListener, true);
      dom.removeEventListener('click', click, true); dom.removeEventListener('contextmenu', context, true); dom.removeEventListener('keydown', key, true);
      editor.off('transaction', update);
    };
  }, [editor, close]);
  const record = menu && bookmarkKey.getState(editor.state)?.find(record => record.id === menu.id);
  return menu && record ? <BookmarkContextMenu anchor={menu} record={record} onClose={close}
    onNavigate={() => revealBookmarkInPanel(editor, record.id)}
    onRemove={() => removeBookmark(editor, record.id)}/> : null;
}
