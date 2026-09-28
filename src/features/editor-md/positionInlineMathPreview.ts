import { findScrollContainer } from '../../core/dom/scrollContainer';

/** Only the active inline preview needs positioning. Reuse its existing DOM and
 * measure this anchor in a frame, never the document's other formulas. */
export function positionInlineMathPreview(preview: HTMLElement): () => void {
  const anchor = preview.parentElement!;
  const scroller = findScrollContainer(anchor);
  let frame = 0;
  const update = () => {
    frame = 0;
    const source = anchor.getBoundingClientRect(), viewport = scroller.getBoundingClientRect();
    const left = Math.max(8, viewport.left + 8), right = Math.min(window.innerWidth - 8, viewport.right - 8);
    const top = Math.max(8, viewport.top + 8), bottom = Math.min(window.innerHeight - 8, viewport.bottom - 8);
    preview.style.setProperty('--math-preview-width', `${Math.max(80, right - left)}px`);
    const box = preview.getBoundingClientRect();
    preview.style.setProperty('--math-preview-left', `${Math.max(left - source.left, Math.min(0, right - source.left - box.width))}px`);
    const above = bottom - source.bottom < box.height + 5 && source.top - top > bottom - source.bottom;
    preview.style.setProperty('--math-preview-top', above ? 'auto' : 'calc(100% + 5px)');
    preview.style.setProperty('--math-preview-bottom', above ? 'calc(100% + 5px)' : 'auto');
    preview.style.setProperty('--math-preview-height', `${Math.max(40, (above ? source.top - top : bottom - source.bottom) - 5)}px`);
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
  const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule);
  observer?.observe(anchor); observer?.observe(preview); observer?.observe(scroller);
  scroller.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  schedule();
  return () => {
    cancelAnimationFrame(frame); observer?.disconnect();
    scroller.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule);
    for (const name of ['width', 'left', 'top', 'bottom', 'height']) preview.style.removeProperty(`--math-preview-${name}`);
  };
}
