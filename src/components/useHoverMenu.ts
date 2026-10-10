import { createContext, useContext, useEffect, useId, useRef, useState, type PointerEvent, type KeyboardEvent } from 'react';
import './hoverMenu.css';
import { useEditorMenuActivity } from './EditorMenuScope';
type LeaveEvent = { relatedTarget: EventTarget | null };
export const HoverMenuContext = createContext<{ cancel: () => void; leave: (event?: LeaveEvent) => void; branch?: string } | null>(null);

/** Shared timing/focus contract for toolbar menus, including portal content. */
export function useHoverMenu(open: boolean, onOpenChange: (open: boolean) => void, disabled = false, exclusive = true) {
  const parent = useContext(HoverMenuContext);
  exclusive = exclusive && !parent;
  const id = useId();
  const branch = [parent?.branch, id].filter(Boolean).join(' ');
  useEditorMenuActivity(id, open);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const keyboard = useRef(false);
  const current = useRef({ open, onOpenChange, disabled });
  current.current = { open, onOpenChange, disabled };
  const [arming, setArming] = useState(false);
  const cancel = () => { clearTimeout(timer.current); timer.current = undefined; };
  // A split trigger's main action and a portalled child panel are still inside
  // the same hover branch. Retain ancestors without opening the child menu.
  const keepAlive = () => { parent?.cancel(); cancel(); };
  const owns = (target: EventTarget | null) => target instanceof Element
    && Boolean(target.closest('[data-nb-menu-branch]')?.getAttribute('data-nb-menu-branch')?.split(' ').includes(id));
  const change = (next: boolean) => { cancel(); setArming(false); current.current.onOpenChange(next && !current.current.disabled); };
  const enter = (event?: PointerEvent) => {
    keepAlive();
    if (event?.pointerType === 'touch' || current.current.disabled || current.current.open) return;
    keyboard.current = false;
    timer.current = setTimeout(() => {
      setArming(true);
      timer.current = setTimeout(() => change(true), 90);
    }, 180);
  };
  const leave = (event?: LeaveEvent) => {
    // Moving between rows or into a portalled descendant never leaves the
    // ancestor branch. A focused editor inside a panel owns its lifetime too.
    if (event && owns(event.relatedTarget)) { keepAlive(); return; }
    parent?.leave(event);
    cancel();
    if (!current.current.open) setArming(false);
    if (!keyboard.current) timer.current = setTimeout(() => {
      if (!owns(document.activeElement)) change(false);
    }, 300);
  };
  useEffect(() => {
    if (!open) { cancel(); setArming(false); }
    if (open && exclusive) document.dispatchEvent(new CustomEvent('nb-hover-menu-open', { detail: id }));
  }, [open, id, exclusive]);
  useEffect(() => {
    const dismiss = () => change(false);
    const other = (event: Event) => { if ((event as CustomEvent).detail !== id) dismiss(); };
    const visibility = () => { if (document.hidden) dismiss(); };
    const pointer = () => { keyboard.current = false; };
    window.addEventListener('blur', dismiss);
    if (exclusive) document.addEventListener('nb-hover-menu-open', other);
    document.addEventListener('visibilitychange', visibility);
    document.addEventListener('pointerdown', pointer, true);
    return () => {
      cancel();
      window.removeEventListener('blur', dismiss);
      document.removeEventListener('nb-hover-menu-open', other);
      document.removeEventListener('visibilitychange', visibility);
      document.removeEventListener('pointerdown', pointer, true);
    };
  }, [id, exclusive]);
  return {
    expanded: open || arming, keyboard, branch, cancel: keepAlive, keepAlive, change, enter, leave,
    triggerProps: {
      'data-nb-menu-trigger': id,
      'data-nb-menu-branch': branch,
      'data-menu-expanded': open || arming || undefined,
      onPointerEnter: enter, onPointerLeave: leave,
      onPointerDown: (event: PointerEvent) => { if (event.button === 0) { event.preventDefault(); change(true); } },
      onClick: (event: { preventDefault(): void }) => { event.preventDefault(); change(true); },
      onKeyDown: (event: KeyboardEvent) => {
        if (['ArrowDown', 'Enter', ' '].includes(event.key)) { cancel(); keyboard.current = true; }
        if (event.key === 'ArrowDown') { event.preventDefault(); change(true); }
        if (event.key === 'Escape') change(false);
      },
    },
    contentProps: {
      'data-nb-editor-menu': true,
      'data-nb-menu-branch': branch,
      onPointerEnter: () => { keepAlive(); keyboard.current = false; },
      onPointerLeave: leave,
      onFocusCapture: keepAlive,
      onBlurCapture: leave,
      onInteractOutside: (event: { detail: { originalEvent: Event }; preventDefault(): void }) => {
        const target = event.detail.originalEvent.target;
        if (owns(target)) event.preventDefault();
      },
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
        cancel(); keyboard.current = true;
        if (event.defaultPrevented || (event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable="true"]')) || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),[role="menuitem"]:not([aria-disabled="true"])'));
        if (!items.length) return;
        event.preventDefault();
        const index = items.indexOf(document.activeElement as HTMLElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      },
    },
    onOpenAutoFocus: (event: Event) => { if (!keyboard.current) event.preventDefault(); },
    onCloseAutoFocus: (event: Event) => { if (!keyboard.current) event.preventDefault(); },
  };
}
