import { findScrollContainer } from '../../core/dom/scrollContainer';

export interface CodeViewport { top: number; bottom: number; left: number; right: number }
export interface CodeVisibility { visible: boolean; viewport: CodeViewport }
type Callback = (sample: CodeVisibility) => void;
interface Pool { add(element: HTMLElement, callback: Callback): () => void }
const pools = new WeakMap<HTMLElement, Pool>();

/** Code visibility is a layout fact, independent of focus and observer history. */
export function observeCodeVisibility(editor: HTMLElement, element: HTMLElement, callback: Callback): () => void {
  let pool = pools.get(editor);
  if (!pool) { pool = createPool(editor); pools.set(editor, pool); }
  return pool.add(element, callback);
}

function createPool(editor: HTMLElement): Pool {
  const doc = editor.ownerDocument, win = doc.defaultView!;
  const entries = new Map<HTMLElement, Set<Callback>>();
  let frame = 0, root: HTMLElement | undefined;
  let ancestors: HTMLElement[] = [];
  const schedule = () => { if (!frame) frame = win.requestAnimationFrame(measure); };
  const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule);
  // Parked tabs can move back onscreen without changing their dimensions. Watch
  // only the editor's ancestor attributes, never every syntax span in its body.
  const attributes = typeof MutationObserver === 'undefined' ? undefined : new MutationObserver(schedule);
  function connectRoot() {
    const next = findScrollContainer(editor);
    const chain: HTMLElement[] = [];
    for (let parent: HTMLElement | null = editor; parent; parent = parent.parentElement) chain.push(parent);
    if (root !== next) {
      root?.removeEventListener('scroll', schedule);
      if (root) resize?.unobserve(root);
      root = next; root.addEventListener('scroll', schedule, { passive: true }); resize?.observe(root);
    }
    if (chain.length !== ancestors.length || chain.some((node, i) => node !== ancestors[i])) {
      ancestors = chain; attributes?.disconnect();
      for (const node of chain) attributes?.observe(node, { attributes: true, attributeFilter: ['style', 'class', 'hidden', 'aria-hidden'] });
    }
  }
  function measure() {
    frame = 0; connectRoot();
    const box = root!.getBoundingClientRect();
    const documentRoot = root === doc.documentElement || root === doc.body;
    const viewport: CodeViewport = {
      top: Math.max(0, documentRoot ? 0 : box.top), bottom: Math.min(win.innerHeight, documentRoot ? win.innerHeight : box.bottom),
      left: Math.max(0, documentRoot ? 0 : box.left), right: Math.min(win.innerWidth, documentRoot ? win.innerWidth : box.right),
    };
    // Test ancestor visibility as well: a descendant may explicitly set
    // visibility:visible inside an otherwise hidden parked editor.
    const shown = editor.isConnected && viewport.bottom > viewport.top && viewport.right > viewport.left
      && !ancestors.some(node => node.hidden || node.getAttribute('aria-hidden') === 'true'
        || win.getComputedStyle(node).visibility === 'hidden' || win.getComputedStyle(node).display === 'none');
    // Finish geometry reads before consumers schedule any decoration writes.
    const samples = [...entries].map(([node, callbacks]) => {
      const rect = shown ? node.getBoundingClientRect() : undefined;
      const visible = !!rect && rect.width > 0 && rect.height > 0 && rect.bottom > viewport.top && rect.top < viewport.bottom
        && rect.right > viewport.left && rect.left < viewport.right;
      return { callbacks: [...callbacks], sample: { visible, viewport } };
    });
    for (const { callbacks, sample } of samples) for (const notify of callbacks) notify(sample);
  }
  connectRoot(); resize?.observe(editor); win.addEventListener('resize', schedule);
  // Capturing scroll covers nested code scrolling and a scroll owner that was
  // attached after the initially empty editor mounted. One listener per editor.
  editor.addEventListener('scroll', schedule, true);
  return { add(element, callback) {
    let callbacks = entries.get(element);
    if (!callbacks) { callbacks = new Set(); entries.set(element, callbacks); resize?.observe(element); }
    callbacks.add(callback); schedule();
    return () => {
      const current = entries.get(element); current?.delete(callback);
      if (!current?.size) { entries.delete(element); resize?.unobserve(element); }
      if (entries.size) return;
      if (frame) win.cancelAnimationFrame(frame);
      resize?.disconnect(); attributes?.disconnect(); root?.removeEventListener('scroll', schedule);
      editor.removeEventListener('scroll', schedule, true); win.removeEventListener('resize', schedule); pools.delete(editor);
    };
  } };
}
