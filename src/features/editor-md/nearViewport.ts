import { findScrollContainer } from '../../core/dom/scrollContainer';

type Callback = (near: boolean) => void;
interface Pool { callbacks: Map<Element, Callback>; observer: IntersectionObserver; resize?: ResizeObserver }
const pools = new Map<HTMLElement, Pool>();

/** One observer per actual scroll container, with two screens of overscan. */
export function observeNearby(element: HTMLElement, callback: Callback): () => void {
  if (typeof IntersectionObserver === 'undefined') { callback(true); return () => {}; }
  const root = findScrollContainer(element);
  let pool = pools.get(root);
  if (!pool) {
    const callbacks = new Map<Element, Callback>();
    const create = () => new IntersectionObserver(entries => {
      // Mode/tab hiding is not scrolling out of view. Keep the bounded nearby
      // set intact instead of tearing down and rebuilding every node on a toggle.
      if (!root.clientHeight) return;
      entries.forEach(entry => callbacks.get(entry.target)?.(entry.isIntersecting));
    // Horizontal overflow belongs to the document. Unloading a wide equation
    // while panning it would collapse scrollWidth and snap scrollLeft to zero.
    }, { root, rootMargin: `${Math.max(400, root.clientHeight * 2)}px 1000000px`, threshold: 0 });
    let height = root.clientHeight;
    pool = { callbacks, observer: create(), resize: typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => {
      if (!root.clientHeight || root.clientHeight === height) return;
      height = root.clientHeight;
      const current = pools.get(root);
      if (!current) return;
      current.observer.disconnect(); current.observer = create();
      callbacks.forEach((_, node) => current.observer.observe(node));
    }) };
    pools.set(root, pool); pool.resize?.observe(root);
  }
  pool.callbacks.set(element, callback); pool.observer.observe(element);
  return () => {
    pool!.observer.unobserve(element); pool!.callbacks.delete(element);
    if (!pool!.callbacks.size) { pool!.observer.disconnect(); pool!.resize?.disconnect(); pools.delete(root); }
  };
}
