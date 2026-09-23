import { findScrollContainer } from '../../core/dom/scrollContainer';

type Callback = (near: boolean, visible: boolean) => void;
interface Watch { callback: Callback; near: boolean; visible: boolean }
interface Pool { callbacks: Map<Element, Watch>; observer: IntersectionObserver; visible: IntersectionObserver; resize?: ResizeObserver; lastScroll: number; onScroll: () => void }
const pools = new Map<HTMLElement, Pool>();
const roots = new WeakMap<Element, HTMLElement>();

export function viewportIsScrolling(element: Element): boolean {
  const root = roots.get(element), lastScroll = root && pools.get(root)?.lastScroll;
  return lastScroll !== undefined && performance.now() - lastScroll < 80;
}

/** Shared near/visible observers, with two screens of vertical overscan. */
export function observeNearby(element: HTMLElement, callback: Callback): () => void {
  if (typeof IntersectionObserver === 'undefined') { callback(true, true); return () => {}; }
  const root = findScrollContainer(element);
  let pool = pools.get(root);
  if (!pool) {
    const callbacks = new Map<Element, Watch>();
    const notify = (entries: IntersectionObserverEntry[], visible: boolean) => {
      // Mode/tab hiding is not scrolling out of view. Keep the bounded nearby
      // set intact instead of tearing down and rebuilding every node on a toggle.
      if (!root.clientHeight) return;
      entries.forEach(entry => {
        const watch = callbacks.get(entry.target); if (!watch) return;
        const beforeNear = watch.near || watch.visible, beforeVisible = watch.visible;
        if (visible) watch.visible = entry.isIntersecting; else watch.near = entry.isIntersecting;
        if (beforeNear !== (watch.near || watch.visible) || beforeVisible !== watch.visible) watch.callback(watch.near || watch.visible, watch.visible);
      });
    };
    const create = () => new IntersectionObserver(entries => notify(entries, false), {
    // Horizontal overflow belongs to the document. Unloading a wide equation
    // while panning it would collapse scrollWidth and snap scrollLeft to zero.
      root, rootMargin: `${Math.max(800, root.clientHeight * 2)}px 1000000px`, threshold: 0 });
    let height = root.clientHeight;
    pool = { callbacks, lastScroll: -Infinity, onScroll: () => { const current = pools.get(root); if (current) current.lastScroll = performance.now(); }, observer: create(), visible: new IntersectionObserver(entries => notify(entries, true), { root, rootMargin: '0px 1000000px', threshold: 0 }), resize: typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => {
      if (!root.clientHeight || root.clientHeight === height) return;
      height = root.clientHeight;
      const current = pools.get(root);
      if (!current) return;
      current.observer.disconnect(); current.observer = create();
      callbacks.forEach((_, node) => current.observer.observe(node));
    }) };
    pools.set(root, pool); pool.resize?.observe(root); root.addEventListener('scroll', pool.onScroll, { passive: true });
  }
  roots.set(element, root); pool.callbacks.set(element, { callback, near: false, visible: false }); pool.observer.observe(element); pool.visible.observe(element);
  return () => {
    roots.delete(element); pool!.observer.unobserve(element); pool!.visible.unobserve(element); pool!.callbacks.delete(element);
    if (!pool!.callbacks.size) { pool!.observer.disconnect(); pool!.visible.disconnect(); pool!.resize?.disconnect(); root.removeEventListener('scroll', pool!.onScroll); pools.delete(root); }
  };
}
