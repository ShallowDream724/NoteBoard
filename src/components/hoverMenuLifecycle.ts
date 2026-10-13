interface ActiveMenu {
  id: string;
  branch: string;
  exclusive: boolean;
  isOpen(): boolean;
  owns(target: EventTarget | null): boolean;
  pointer(): void;
  dismiss(): void;
}

/** Only active menus/hover intentions lease these document-wide listeners. */
const active = new Map<string, ActiveMenu>();
let detach: (() => void) | undefined;

export function retainHoverMenu(menu: ActiveMenu) {
  active.set(menu.id, menu);
  if (!detach) {
    const dismiss = () => [...active.values()].forEach(item => item.dismiss());
    const pointer = (event: PointerEvent) => {
      for (const item of [...active.values()]) {
        item.pointer();
        if (!item.owns(event.target)) item.dismiss();
      }
    };
    const escape = (event: KeyboardEvent) => {
      // Radix and editable draft handlers get first refusal. A hover panel can
      // still be dismissed when focus stayed in the document behind it.
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
      const item = [...active.values()].filter(item => item.isOpen()).sort((a, b) => b.branch.split(' ').length - a.branch.split(' ').length)[0];
      item?.dismiss();
    };
    const visibility = () => { if (document.hidden) dismiss(); };
    window.addEventListener('blur', dismiss);
    window.addEventListener('pagehide', dismiss);
    document.addEventListener('visibilitychange', visibility);
    document.addEventListener('pointerdown', pointer, true);
    document.addEventListener('keydown', escape);
    detach = () => {
      window.removeEventListener('blur', dismiss);
      window.removeEventListener('pagehide', dismiss);
      document.removeEventListener('visibilitychange', visibility);
      document.removeEventListener('pointerdown', pointer, true);
      document.removeEventListener('keydown', escape);
    };
  }
  return () => {
    if (active.get(menu.id) !== menu) return;
    active.delete(menu.id);
    if (!active.size) { detach?.(); detach = undefined; }
  };
}

export function dismissOtherHoverMenus(id: string) {
  for (const item of [...active.values()]) if (item.exclusive && item.id !== id) item.dismiss();
}

export function isMenuInput(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])'));
}
