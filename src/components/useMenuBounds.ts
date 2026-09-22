import { useLayoutEffect, type RefObject } from 'react';
import './contextMenu.css';

/** Shared viewport/scroll behavior for custom context menus and submenus.
 * Measure only while a menu is open, on content/window resize, never on scroll. */
export function useMenuBounds(ref: RefObject<HTMLElement | null>, open: boolean, x: number, y: number) {
  useLayoutEffect(() => {
    const menu = ref.current; if (!open || !menu) return;
    const update = () => {
      const margin = 8, width = Math.max(0, window.innerWidth - margin * 2), height = Math.max(0, window.innerHeight - margin * 2);
      menu.style.maxHeight = `${Math.min(460, height)}px`;
      menu.style.maxWidth = `${width}px`;
      menu.style.minWidth = `min(${menu.dataset.menuMinWidth ?? menu.style.minWidth}, ${width}px)`;
      menu.style.overflowY = 'auto'; menu.style.overflowX = 'hidden';
      menu.style.overscrollBehavior = 'contain';
      const bounds = menu.getBoundingClientRect();
      menu.style.left = `${Math.max(margin, Math.min(x, window.innerWidth - bounds.width - margin))}px`;
      menu.style.top = `${Math.max(margin, Math.min(y, window.innerHeight - bounds.height - margin))}px`;
    };
    menu.dataset.menuMinWidth ??= menu.style.minWidth || '0px';
    menu.classList.add('nb-bounded-menu');
    update();
    const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update);
    resize?.observe(menu); window.addEventListener('resize', update);
    return () => { resize?.disconnect(); window.removeEventListener('resize', update); };
  }, [ref, open, x, y]);
}
