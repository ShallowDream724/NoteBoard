import { findScrollContainer } from './scrollContainer';

export const CONTENT_VIEW_CHANGED = 'nb-content-view-changed';
const scrolling = /^(auto|scroll|overlay)$/;
const clipping = /^(auto|scroll|overlay|hidden|clip)$/;
export interface ViewportBounds { left: number; right: number; top: number; bottom: number; width: number; height: number }

/** Client box in screen coordinates, excluding borders and scrollbar gutters. */
export function clientBounds(element: HTMLElement): ViewportBounds {
  const win = element.ownerDocument.defaultView!;
  if (element === element.ownerDocument.documentElement) return { left: 0, top: 0, right: win.innerWidth, bottom: win.innerHeight, width: win.innerWidth, height: win.innerHeight };
  const box = element.getBoundingClientRect(), x = box.width / (element.offsetWidth || box.width || 1), y = box.height / (element.offsetHeight || box.height || 1);
  const left = box.left + element.clientLeft * x, top = box.top + element.clientTop * y;
  const width = element.offsetWidth ? element.clientWidth * x : box.width;
  const height = element.offsetHeight ? element.clientHeight * y : box.height;
  return { left, top, right: left + width, bottom: top + height, width, height };
}

/** One geometry contract for virtualization and controls. The document scroll
 * owner is a boundary; nested scroll/clip ancestors further constrain its box.
 * Cost depends on ancestor depth, never on document rows or formula cells. */
export function contentViewport(element: HTMLElement, boundary = findScrollContainer(element)) {
  const win = element.ownerDocument.defaultView!, outer = clientBounds(boundary);
  let left = Math.max(0, outer.left), right = Math.min(win.innerWidth, outer.right);
  let top = Math.max(0, outer.top), bottom = Math.min(win.innerHeight, outer.bottom);
  let scrollX = boundary, scrollY = boundary, foundX = false, foundY = false;
  for (let parent = element.parentElement; parent && parent !== boundary; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    const clipX = clipping.test(style.overflowX), clipY = clipping.test(style.overflowY);
    if (!clipX && !clipY) continue;
    const box = clientBounds(parent);
    if (clipX) { left = Math.max(left, box.left); right = Math.min(right, box.right); }
    if (clipY) { top = Math.max(top, box.top); bottom = Math.min(bottom, box.bottom); }
    if (!foundX && scrolling.test(style.overflowX)) { scrollX = parent; foundX = true; }
    if (!foundY && scrolling.test(style.overflowY)) { scrollY = parent; foundY = true; }
  }
  return { bounds: { left, right, top, bottom, width: Math.max(0, right - left), height: Math.max(0, bottom - top) }, outer, scrollX, scrollY };
}

type Notify = () => void;
const listeners = new Map<HTMLElement, { callbacks: Set<Notify>; notify: Notify }>();
let resize: ResizeObserver | undefined;
function listen(element: HTMLElement, callback: Notify) {
  let entry = listeners.get(element);
  if (!entry) {
    const callbacks = new Set<Notify>(), notify = () => callbacks.forEach(next => next());
    entry = { callbacks, notify }; listeners.set(element, entry);
    element.addEventListener('scroll', notify, { passive: true });
    element.addEventListener(CONTENT_VIEW_CHANGED, notify);
    if (typeof ResizeObserver !== 'undefined') {
      resize ??= new ResizeObserver(entries => { const callbacks = new Set<Notify>(); entries.forEach(item => listeners.get(item.target as HTMLElement)?.callbacks.forEach(next => callbacks.add(next))); callbacks.forEach(next => next()); });
      resize.observe(element);
    }
  }
  entry.callbacks.add(callback);
  return () => {
    entry!.callbacks.delete(callback);
    if (entry!.callbacks.size) return;
    element.removeEventListener('scroll', entry!.notify); element.removeEventListener(CONTENT_VIEW_CHANGED, entry!.notify);
    resize?.unobserve(element); listeners.delete(element);
    if (!listeners.size) { resize?.disconnect(); resize = undefined; }
  };
}

/** Watch the ancestor chain, including currently non-scrolling hosts: changing
 * reading mode can introduce a local scroller without replacing the content. */
export function observeContentViewport(element: HTMLElement, notify: Notify, boundary = findScrollContainer(element)) {
  const stops: Notify[] = [];
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    stops.push(listen(parent, notify)); if (parent === boundary) break;
  }
  const win = element.ownerDocument.defaultView!;
  win.addEventListener('resize', notify);
  return () => { stops.forEach(stop => stop()); win.removeEventListener('resize', notify); };
}
