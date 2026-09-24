import { useEffect, useRef, type RefObject } from 'react';
import type { Editor } from '@tiptap/core';

/** Portalled editing controls belong to the editor; the rest of the application doesn't. */
export function useEditorOverlayDismiss(editor: Editor, root: RefObject<HTMLElement | null>, dismiss: () => void) {
  const callback = useRef(dismiss);
  callback.current = dismiss;
  useEffect(() => {
    const outside = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Node) || editor.view.dom.contains(target) || root.current?.contains(target)
        || target instanceof Element && target.closest('[data-nb-editor-menu]')) return;
      callback.current();
    };
    const blur = () => callback.current();
    const visibility = () => { if (document.hidden) blur(); };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('focusin', outside, true);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('blur', blur);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('focusin', outside, true);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('blur', blur);
    };
  }, [editor, root]);
}
