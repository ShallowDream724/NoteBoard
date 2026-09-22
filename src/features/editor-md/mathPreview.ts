import { observeNearby, viewportIsScrolling } from './nearViewport';
import { queueMath, refreshMathQueue } from './mathRenderQueue';
import { matrixSource } from '../../core/math/structure';
import { mountMatrixPreview } from './matrixPreview';
import { checkMathSource, MATH_LIMITS } from './mathLimits';

let nextId = 0;
type Size = { width: number; height: number };
const sizes = new Map<Element, (size: Size) => void>();
let resize: ResizeObserver | undefined;
function observeSize(element: HTMLElement, callback: (size: Size) => void) {
  if (typeof ResizeObserver === 'undefined') return () => {};
  resize ??= new ResizeObserver(entries => {
    // Geometry has already been computed by the browser. Never measure each
    // formula from a scroll handler or between individual React commits.
    for (const entry of entries) sizes.get(entry.target)?.({ width: entry.contentRect.width, height: entry.contentRect.height });
  });
  sizes.set(element, callback); resize.observe(element);
  return () => { if (!sizes.delete(element)) return; resize?.unobserve(element); if (!sizes.size) { resize?.disconnect(); resize = undefined; } };
}

/** Owns only the empty preview host, outside React's node-view render cycle.
 * Viewport work never changes the document or editor selection. */
export function mountMathPreview(host: HTMLElement, latex: string, display: boolean, editing: boolean) {
  // Bound the structure-reader path as well as whole-formula KaTeX. The source
  // remains owned by the math node and its existing click-to-edit entry point.
  const refused = checkMathSource(latex, MATH_LIMITS.matrixSourceCharacters);
  if (refused) {
    const message = document.createElement('span'); message.setAttribute('role', 'status'); message.textContent = refused.error;
    host.replaceChildren(message); return () => host.replaceChildren();
  }
  // Allocate a stable geometric placeholder before first paint. A thousand-row
  // matrix must never first appear as two source lines, then shift the document.
  if (latex.length > 1200 && latex.includes('\\begin{')) {
    try {
      const matrix = matrixSource(latex, { retainBarred: true });
      if (matrix && matrix.environment !== 'Bmatrix' && (matrix.rows.length > 64 || matrix.rows.length * matrix.columns > 512)) return mountMatrixPreview(host, matrix);
    } catch (error) { host.textContent = String(error); return () => host.replaceChildren(); }
  }
  const id = `math-preview:${++nextId}`;
  let cancel: (() => void) | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  let live = true, mounted = false, visible = false, size: Size | undefined;
  let stopSize = () => {};
  const placeholder = () => {
    const text = document.createElement('span'); text.style.color = 'var(--editor-text-muted)';
    text.textContent = latex ? (latex.length > 100 ? latex.slice(0, 100) + '…' : latex) : editing ? '输入 LaTeX 公式' : '点击输入公式';
    host.replaceChildren(text);
  };
  placeholder();
  const show = () => {
    if (timer) { clearTimeout(timer); timer = undefined; }
    if (mounted || cancel || !latex.trim()) return;
    cancel = queueMath(id, { latex, display, priority: () => editing || visible ? 0 : 1, isScrolling: () => !editing && viewportIsScrolling(host), done: result => {
      cancel = undefined; if (!live) return;
      const preview = document.createElement('span'); preview.className = 'math-preview'; preview.innerHTML = result.html;
      preview.style.cssText = `display:inline-block;width:max-content;${display ? 'min-width:100%;' : ''}`;
      host.replaceChildren(preview); host.style.removeProperty('width'); host.style.removeProperty('height'); mounted = true;
      const stopPreviewSize = observeSize(preview, value => { if (mounted && value.height > 0) size = { width: value.width, height: size?.height ?? value.height }; });
      const stopHostSize = observeSize(host, value => { if (mounted && value.height > 0) size = { width: size?.width ?? value.width, height: value.height }; });
      stopSize = () => { stopPreviewSize(); stopHostSize(); };
      if (result.error) {
        const error = document.createElement('span'); error.setAttribute('role', 'status');
        error.style.cssText = 'display:block;font-size:12px;color:var(--error-500);white-space:pre-wrap';
        error.textContent = result.error; host.append(error);
      }
    } });
  };
  const stopNear = observeNearby(host, (near, isVisible) => {
    visible = isVisible;
    refreshMathQueue();
    if (near || editing) { show(); return; }
    cancel?.(); cancel = undefined;
    // Hysteresis avoids rebuilding formulas at the overscan boundary during
    // quick direction changes. Lifetime remains bounded, not scroll-accumulated.
    if (!mounted || timer) return;
    timer = setTimeout(() => {
      timer = undefined; if (!live) return;
      stopSize();
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
