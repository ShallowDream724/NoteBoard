import { createContext, useContext, useEffect, useId, useRef, useState, type PointerEvent, type KeyboardEvent } from 'react';
import './hoverMenu.css';
import { useEditorMenuActivity } from './EditorMenuScope';
import { dismissOtherHoverMenus, isMenuInput, retainHoverMenu } from './hoverMenuLifecycle';
type LeaveEvent = { relatedTarget: EventTarget | null };
export const HoverMenuContext = createContext<{ cancel: () => void; leave: (event?: LeaveEvent) => void; branch?: string; escape?: () => void } | null>(null);

/** Shared timing/focus contract for toolbar menus, including portal content. */
export function useHoverMenu(open: boolean, onOpenChange: (open: boolean) => void, disabled = false, exclusive = true,
  ownsExternal?: (target: EventTarget | null) => boolean) {
  const parent = useContext(HoverMenuContext);
  exclusive = exclusive && !parent;
  const id = useId();
  const branch = [parent?.branch, id].filter(Boolean).join(' ');
  useEditorMenuActivity(id, open);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const keyboard = useRef(false);
  const current = useRef({ open, onOpenChange, disabled, ownsExternal });
  current.current = { open, onOpenChange, disabled, ownsExternal };
  const [arming, setArming] = useState(false);
  const [pending, setPending] = useState(false);
  const cancelTimer = () => { clearTimeout(timer.current); timer.current = undefined; };
  const cancel = () => { cancelTimer(); setPending(false); setArming(false); };
  // A split trigger's main action and a portalled child panel are still inside
  // the same hover branch. Retain ancestors without opening the child menu.
  const keepAlive = () => { parent?.cancel(); cancel(); };
  const owns = (target: EventTarget | null) => Boolean(current.current.ownsExternal?.(target)) || (target instanceof Element
    && Boolean(target.closest('[data-nb-menu-branch]')?.getAttribute('data-nb-menu-branch')?.split(' ').includes(id)));
  const change = (next: boolean) => { cancel(); current.current.onOpenChange(next && !current.current.disabled); };
  const enter = (event?: PointerEvent) => {
    keepAlive();
    if (event?.pointerType === 'touch' || current.current.disabled) return;
    keyboard.current = false;
    if (current.current.open) return;
    setPending(true);
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
    if (!keyboard.current) {
      setPending(true);
      timer.current = setTimeout(() => {
        setPending(false);
        // Ordinary buttons can retain focus after a pointer click. Only an
        // editable field owns a pointer menu's lifetime after leaving it.
        if (!(owns(document.activeElement) && isMenuInput(document.activeElement))) change(false);
      }, 300);
    }
  };
  useEffect(() => {
    if (!open) cancel();
    if (open && exclusive) dismissOtherHoverMenus(id);
  }, [open, id, exclusive]);
  const activity = useRef({ owns, change, cancel }); activity.current = { owns, change, cancel };
  useEffect(() => {
    if (!open && !pending) return;
    return retainHoverMenu({ id, branch, exclusive,
      isOpen: () => current.current.open,
      owns: target => activity.current.owns(target),
      pointer: () => { keyboard.current = false; },
      dismiss: () => { activity.current.cancel(); if (current.current.open) activity.current.change(false); },
    });
  }, [open, pending, id, branch, exclusive]);
  useEffect(() => () => cancelTimer(), []);
  return {
    expanded: open || arming, keyboard, branch, cancel: keepAlive, keepAlive, change, enter, leave,
    escape: () => { keyboard.current = true; change(false); },
    triggerProps: {
      'data-nb-menu-trigger': id,
      'data-nb-menu-branch': branch,
      'data-menu-expanded': open || arming || undefined,
      onPointerEnter: enter, onPointerLeave: leave,
      onPointerDown: (event: PointerEvent) => { if (event.button === 0) { keyboard.current = false; event.preventDefault(); change(true); } },
      onClick: (event: { preventDefault(): void }) => { event.preventDefault(); change(true); },
      onKeyDown: (event: KeyboardEvent) => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
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
      onBlurCapture: (event: LeaveEvent) => { if (!owns(event.relatedTarget)) keyboard.current = false; leave(event); },
      onInteractOutside: (event: { detail: { originalEvent: Event }; preventDefault(): void }) => {
        const target = event.detail.originalEvent.target;
        if (owns(target)) event.preventDefault();
      },
      onEscapeKeyDown: (event: globalThis.KeyboardEvent) => {
        if (event.isComposing || event.keyCode === 229) event.preventDefault();
      },
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        cancel(); keyboard.current = true;
        if (event.defaultPrevented || isMenuInput(event.target)) return;
        if (event.key === 'ArrowLeft' && parent) { event.preventDefault(); event.stopPropagation(); change(false); return; }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
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
    onCloseAutoFocus: (event: Event) => {
      if (!keyboard.current) { event.preventDefault(); return; }
      // Anchor-based toolbar popovers have no Radix Trigger ref to return to.
      const trigger = Array.from(document.querySelectorAll<HTMLElement>('[data-nb-menu-trigger]')).find(element => element.getAttribute('data-nb-menu-trigger') === id);
      const target = trigger?.matches('button,[tabindex]') ? trigger : trigger?.querySelector<HTMLElement>('button,[tabindex]');
      if (target?.isConnected) { event.preventDefault(); target.focus({ preventScroll: true }); }
    },
  };
}
