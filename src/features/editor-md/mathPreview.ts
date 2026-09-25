import { observeNearby, viewportIsScrolling } from './nearViewport';
import { queueMath, refreshMathQueue, retireMath } from './mathRenderQueue';
import { matrixSource } from '../../core/math/structure';
import { mountMatrixPreview } from './matrixPreview';
import { checkMathSource, mathMarkupNodeCount, MATH_LIMITS } from './mathLimits';
import { registerMathPreview } from './mathPreviewSession';
import '../../core/math/wrapping.css';

let nextId = 0;
type Size = { width: number; height: number };
type Geometry = Size & { baseline?: number };
export interface MathPreviewController { dispose(preserveGeometry?: boolean): void; setEditing(editing: boolean): void }
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

/** Reuse observer-provided dimensions during both eviction and source changes.
 * No layout read or scroll restoration is needed while the next worker runs. */
function geometryPlaceholder(size: Geometry, display: boolean): HTMLElement {
  const strut = document.createElement('span'); strut.className = 'math-preview-placeholder'; strut.setAttribute('aria-hidden', 'true');
  strut.style.cssText = `display:block;width:${size.width}px;height:${size.height}px;font-size:0;line-height:0`;
  if (!display) {
    const baseline = document.createElement('span');
    baseline.style.cssText = `display:inline-block;width:0;height:${size.baseline}px;vertical-align:baseline`;
    strut.append(baseline);
  }
  return strut;
}

/** Owns only the empty preview host, outside React's node-view render cycle.
 * Viewport work never changes the document or editor selection. */
export function mountMathPreview(host: HTMLElement, latex: string, display: boolean, editing: boolean, owner: HTMLElement = host.closest<HTMLElement>('.ProseMirror') ?? host.parentElement ?? host): MathPreviewController {
  // Bound the structure-reader path as well as whole-formula KaTeX. The source
  // remains owned by the math node and its existing click-to-edit entry point.
  const refused = checkMathSource(latex, MATH_LIMITS.matrixSourceCharacters);
  if (refused) {
    const message = document.createElement('span'); message.setAttribute('role', 'status'); message.textContent = refused.error;
    host.replaceChildren(message); return { dispose: preserveGeometry => { host.replaceChildren(); if (!preserveGeometry) host.style.minHeight = ''; }, setEditing: next => { if (!next) host.style.minHeight = ''; } };
  }
  // Allocate a stable geometric placeholder before first paint. A thousand-row
  // matrix must never first appear as two source lines, then shift the document.
  if (latex.length > 1200 && latex.includes('\\begin{')) {
    try {
      const matrix = matrixSource(latex, { retainBarred: true });
      if (matrix && matrix.environment !== 'Bmatrix' && (matrix.rows.length > 64 || matrix.rows.length * matrix.columns > 512)) {
        const dispose = mountMatrixPreview(host, matrix);
        return { dispose: preserveGeometry => { dispose(); if (!preserveGeometry) host.style.minHeight = ''; }, setEditing: next => { if (!next) host.style.minHeight = ''; } };
      }
    } catch (error) { host.textContent = String(error); return { dispose: preserveGeometry => { host.replaceChildren(); if (!preserveGeometry) host.style.minHeight = ''; }, setEditing: next => { if (!next) host.style.minHeight = ''; } }; }
  }
  const id = `math-preview:${++nextId}`;
  let cancel: (() => void) | undefined, cancelRetirement: (() => void) | undefined;
  let live = true, mounted = false, near = false, visible = false, size: Geometry | undefined;
  let stopSize = () => {};
  const holdEditingHeight = () => {
    if (editing && size) host.style.minHeight = `${Math.max(Number.parseFloat(host.style.minHeight) || 0, size.height)}px`;
  };
  const placeholder = () => {
    const text = document.createElement('span'); text.style.color = 'var(--editor-text-muted)';
    text.textContent = latex ? (latex.length > 100 ? latex.slice(0, 100) + '…' : latex) : editing ? '输入 LaTeX 公式' : '点击输入公式';
    host.replaceChildren(text);
  };
  // A connected React node view can replace its source controller while keeping
  // the host. Preserve the previous formula's geometry until the new result is
  // ready, otherwise a tall matrix briefly becomes one line on every keystroke.
  if (!latex.trim() || !host.firstElementChild?.classList.contains('math-preview-placeholder')) placeholder();
  const show = () => {
    if (!live || !lease.isActive() || mounted || cancel || !latex.trim()) return;
    cancel = queueMath(id, { latex, display, priority: () => editing || visible ? 0 : near ? 1 : 2, isScrolling: () => !editing && viewportIsScrolling(host), done: result => {
      cancel = undefined; if (!live) return;
      const nodes = mathMarkupNodeCount(result.html) + 4;
      if (!lease.canMount(nodes)) return;
      const preview = document.createElement('span'); preview.className = 'math-preview'; preview.innerHTML = result.html;
      preview.style.cssText = `display:inline-block;width:max-content;${display ? 'min-width:100%;' : ''}`;
      host.replaceChildren(preview); mounted = true; size = undefined;
      lease.mounted(nodes);
      let lastLine = preview;
      if (result.error) {
        const error = document.createElement('span'); error.setAttribute('role', 'status');
        error.style.cssText = 'display:block;font-size:12px;color:var(--error-500);white-space:pre-wrap';
        error.textContent = result.error; host.append(error); lastLine = error;
      }
      // Inline-block's baseline comes from its last line, not its bottom edge.
      // A zero-size probe on that line lets the post-layout observer preserve it
      // without measuring between DOM writes or in a scroll handler.
      let baselineProbe: HTMLElement | undefined;
      if (!display) {
        baselineProbe = document.createElement('span'); baselineProbe.setAttribute('aria-hidden', 'true');
        baselineProbe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline'; lastLine.append(baselineProbe);
      }
      let previewWidth = 0, hostWidth = 0;
      const stopPreviewSize = display ? observeSize(preview, value => {
        previewWidth = value.width;
        if (mounted && size) size.width = Math.max(previewWidth, hostWidth);
      }) : () => {};
      const stopHostSize = observeSize(host, value => {
        if (!mounted || value.height <= 0) return;
        hostWidth = value.width;
        const baseline = baselineProbe ? baselineProbe.getBoundingClientRect().top - host.getBoundingClientRect().top : undefined;
        size = { width: Math.max(value.width, display ? previewWidth : 0), height: value.height, baseline };
        holdEditingHeight();
        lease.measured();
      });
      stopSize = () => { stopPreviewSize(); stopHostSize(); };
    } });
  };
  const lease = registerMathPreview(owner, {
    sourceLength: latex.length,
    prepare: show,
    cancelPreparation: () => { cancel?.(); cancel = undefined; },
    evict: () => {
      if (!mounted || !size || cancelRetirement || near || editing) return false;
      cancelRetirement = retireMath(id, () => {
      cancelRetirement = undefined;
      if (!live || !size) { lease.cancelRetirement(); return; }
      stopSize(); stopSize = () => {};
      // A block child adds no new host-font line box. Its zero-leading line
      // exports exactly the recorded baseline, including errors whose last line
      // uses a smaller font; explicit height preserves the remaining descent.
      host.replaceChildren(geometryPlaceholder(size, display));
      mounted = false;
      lease.released();
      });
      return true;
    },
  });
  const stopNear = observeNearby(host, (isNear, isVisible) => {
    near = isNear; visible = isVisible;
    if (near || editing) {
      cancelRetirement?.(); cancelRetirement = undefined; lease.cancelRetirement();
    }
    lease.nearby(near || editing); refreshMathQueue();
    if (near || editing) show();
    else if (!lease.preparesBackground()) { cancel?.(); cancel = undefined; }
  });
  if (editing) { lease.nearby(true); show(); }
  return {
    setEditing: next => {
      if (!live || editing === next) return;
      editing = next;
      // A temporarily invalid (or deliberately shorter) result must not shrink
      // the page underneath the focused source field. Release only on close.
      if (editing) holdEditingHeight(); else host.style.minHeight = '';
      if (near || editing) { cancelRetirement?.(); cancelRetirement = undefined; lease.cancelRetirement(); }
      lease.nearby(near || editing); refreshMathQueue();
      if (near || editing) show();
    },
    dispose: (preserveGeometry = false) => {
      live = false; cancel?.(); cancelRetirement?.(); stopNear(); stopSize();
      lease.dispose();
      if (!preserveGeometry) host.style.minHeight = '';
      if (preserveGeometry && size) host.replaceChildren(geometryPlaceholder(size, display));
      else if (!preserveGeometry || !host.firstElementChild?.classList.contains('math-preview-placeholder')) host.replaceChildren();
    },
  };
}
