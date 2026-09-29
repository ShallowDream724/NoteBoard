import { CONTENT_VIEW_CHANGED } from '../../core/dom/contentViewport';
import { mathContentWidth, reflowMathToWidth, type MathMarkup } from '../../core/math/layout';
import { queueMath } from './mathRenderQueue';
import { viewportIsScrolling } from './nearViewport';

type Notify = () => void;
const owners = new Map<HTMLElement, Set<Notify>>();
const sizes = new Map<Element, Set<Notify>>();
const fonts = new Set<Notify>();
const fontsChanged = () => fonts.forEach(notify => notify());
let observer: ResizeObserver | undefined;
function watch(owner: HTMLElement, block: HTMLElement, notify: Notify, fontChanged: Notify) {
  if (!fonts.size) document.fonts?.addEventListener('loadingdone', fontsChanged);
  fonts.add(fontChanged);
  let callbacks = owners.get(owner);
  if (!callbacks) { callbacks = new Set(); owners.set(owner, callbacks); owner.addEventListener(CONTENT_VIEW_CHANGED, changed); }
  callbacks.add(notify);
  let resizes = sizes.get(block);
  if (!resizes) {
    resizes = new Set(); sizes.set(block, resizes);
    if (typeof ResizeObserver !== 'undefined') {
      observer ??= new ResizeObserver(entries => { const batch = new Set<Notify>(); entries.forEach(e => sizes.get(e.target)?.forEach(fn => batch.add(fn))); batch.forEach(fn => fn()); });
      observer.observe(block);
    }
  }
  resizes.add(notify);
  return () => {
    fonts.delete(fontChanged); if (!fonts.size) document.fonts?.removeEventListener('loadingdone', fontsChanged);
    callbacks!.delete(notify); if (!callbacks!.size) { owners.delete(owner); owner.removeEventListener(CONTENT_VIEW_CHANGED, changed); }
    resizes!.delete(notify); if (!resizes!.size) { sizes.delete(block); observer?.unobserve(block); }
    if (!sizes.size) { observer?.disconnect(); observer = undefined; }
  };
}
function changed(event: Event) { owners.get(event.currentTarget as HTMLElement)?.forEach(fn => fn()); }
let nextId = 0;

/** Presentation-only width adaptation. Only mounted, nearby formulas subscribe;
 * scroll does not trigger TeX reflow. The shared render queue bounds work, and an
 * epoch cancels old candidates on mode/source/width changes or eviction. */
export function mountMathReadingLayout(options: {
  host: HTMLElement; preview: HTMLElement; owner: HTMLElement; display: boolean;
  latex?: string; original?: MathMarkup; apply?: (result: MathMarkup) => boolean;
}) {
  const { host, preview, owner, display } = options;
  const node = host.closest<HTMLElement>('.math-node');
  // React's inline NodeView shell is an inline span: clientWidth is zero and
  // its bounding box follows the formula itself. Constrain against the text
  // block, never the renderer shell or the formula's current intrinsic width.
  const block = (display ? node : node?.closest<HTMLElement>('p,h1,h2,h3,h4,h5,h6,td,th,li,blockquote')) ?? owner;
  const id = `math-layout:${++nextId}`;
  let active = false, editing = false, disposed = false, frame = 0, revision = 0;
  let stop = () => {}, cancel = () => {}, key = '', changedMarkup = false;
  const invalidate = () => { key = ''; schedule(); };
  const currentMode = () => owner.dataset.formulaReading ?? 'expand';
  const apply = (result: MathMarkup) => {
    if (options.apply) return options.apply(result);
    preview.innerHTML = result.html; return true;
  };
  const restore = () => {
    preview.style.zoom = '';
    if (changedMarkup && options.original) { apply(options.original); changedMarkup = false; }
  };
  const update = () => {
    frame = 0; if (disposed || !active) return;
    const mode = currentMode(), wrap = !editing && !node?.classList.contains('math-node-editing') && (mode === 'wrap' || !display && mode === 'scroll');
    const style = getComputedStyle(block), rect = block.getBoundingClientRect();
    const scale = block.offsetWidth ? rect.width / block.offsetWidth : 1;
    const width = Math.max(0, (block.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0)) * scale);
    const font = getComputedStyle(host);
    const signature = `${mode}:${wrap}:${Math.round(width)}:${font.fontSize}:${font.fontFamily}:${options.latex ? '' : preview.offsetWidth}`;
    if (key === signature) return;
    key = signature; const epoch = ++revision; cancel(); cancel = () => {}; restore();
    if (!wrap || width <= 1) return;
    const measured = () => { const math = preview.querySelector<HTMLElement>('.katex-html'); return math ? mathContentWidth(math) : preview.getBoundingClientRect().width; };
    if (measured() <= width + 1) return;
    const current = () => !disposed && active && !editing && revision === epoch && currentMode() === mode;
    const fit = () => {
      if (!current()) return;
      const measuredWidth = measured();
      // Atomic/unknown structures retain their complete semantics. Screen fitting
      // has no pagination limit; edit/expand always gives access at natural size.
      if (measuredWidth > width + 1) preview.style.zoom = String(width / measuredWidth);
    };
    if (!options.latex || options.original?.error) { fit(); return; }
    void reflowMathToWidth({ element: preview, latex: options.latex, available: width, fontPixels: (parseFloat(font.fontSize) || 16) * scale,
      current,
      render: source => new Promise(resolve => {
        const stopRequest = queueMath(id, { latex: source, display, priority: () => 1, isScrolling: () => viewportIsScrolling(host), done: value => { cancel = () => {}; resolve(value); } });
        cancel = () => { stopRequest(); resolve(null); };
      }),
      apply: result => { if (!current() || !apply(result)) return false; changedMarkup = true; return true; },
    }).then(fit);
  };
  function schedule() { if (active && !disposed && !frame) frame = requestAnimationFrame(update); }
  return {
    nearby(value: boolean) {
      if (active === value) return;
      active = value; stop(); stop = () => {};
      if (active) { stop = watch(owner, block, schedule, invalidate); invalidate(); }
      else { revision++; cancel(); cancel = () => {}; cancelAnimationFrame(frame); frame = 0; }
    },
    editing(value: boolean) { if (editing !== value) { editing = value; invalidate(); } },
    invalidate,
    dispose() { disposed = true; revision++; cancel(); stop(); cancelAnimationFrame(frame); preview.style.zoom = ''; },
  };
}
