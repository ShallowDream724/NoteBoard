import { observeNearby } from './nearViewport';
import { queueMath } from './mathRenderQueue';

let nextId = 0;
type Size = { width: number; height: number };
const sizes = new Map<Element, (size: Size) => void>();
let resize: ResizeObserver | undefined;
function observeSize(element: HTMLElement, callback: (size: Size) => void) {
  if (typeof ResizeObserver === 'undefined') return () => {};
  resize ??= new ResizeObserver(entries => {
    // Geometry has already been computed by the browser. Never measure each
    // formula from a scroll handler or between individual React commits.
    for (const entry of entries) sizes.get(entry.target)?.({ width: Math.max(entry.contentRect.width, (entry.target as HTMLElement).scrollWidth), height: entry.contentRect.height });
  });
  sizes.set(element, callback); resize.observe(element);
  return () => { resize!.unobserve(element); sizes.delete(element); if (!sizes.size) { resize!.disconnect(); resize = undefined; } };
}

/** Owns only the empty preview host, outside React's node-view render cycle.
 * Viewport work never changes the document or editor selection. */
export function mountMathPreview(host: HTMLElement, latex: string, display: boolean, editing: boolean) {
  const id = `math-preview:${++nextId}`;
  let cancel: (() => void) | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  let live = true, mounted = false, size: Size | undefined;
  const placeholder = () => {
    const text = document.createElement('span'); text.style.color = 'var(--editor-text-muted)';
    text.textContent = latex ? (latex.length > 100 ? latex.slice(0, 100) + '…' : latex) : editing ? '输入 LaTeX 公式' : '点击输入公式';
    host.replaceChildren(text);
  };
  placeholder();
  const stopSize = observeSize(host, value => { if (mounted && value.height > 0) size = value; });
  const show = () => {
    if (timer) { clearTimeout(timer); timer = undefined; }
    if (mounted || cancel || !latex.trim()) return;
    cancel = queueMath(id, { latex, display, done: result => {
      cancel = undefined; if (!live) return;
      const preview = document.createElement('span'); preview.className = 'math-preview'; preview.innerHTML = result.html;
      host.replaceChildren(preview); host.style.removeProperty('width'); host.style.removeProperty('height'); mounted = true;
      if (result.error) {
        const error = document.createElement('span'); error.setAttribute('role', 'status');
        error.style.cssText = 'display:block;font-size:12px;color:var(--error-500);white-space:pre-wrap';
        error.textContent = result.error; host.append(error);
      }
    } });
  };
  const stopNear = observeNearby(host, near => {
    if (near || editing) { show(); return; }
    cancel?.(); cancel = undefined;
    // Hysteresis avoids rebuilding formulas at the overscan boundary during
    // quick direction changes. Lifetime remains bounded, not scroll-accumulated.
    if (!mounted || timer) return;
    timer = setTimeout(() => {
      timer = undefined; if (!live) return;
      if (size) { host.style.width = `${size.width}px`; host.style.height = `${size.height}px`; host.replaceChildren(); }
      else placeholder();
      mounted = false;
    }, 180);
  });
  if (editing) show();
  return () => {
    live = false; cancel?.(); if (timer) clearTimeout(timer); stopNear(); stopSize();
    host.replaceChildren(); host.style.removeProperty('width'); host.style.removeProperty('height');
  };
}
