import { findScrollContainer } from '../../core/dom/scrollContainer';

/** Only the active inline preview needs positioning. Reuse its existing DOM and
 * measure this anchor in a frame, never the document's other formulas. */
export function positionInlineMathPreview(preview: HTMLElement): () => void {
  const anchor = preview.parentElement!;
  const scroller = findScrollContainer(anchor);
  const paragraph = anchor.closest<HTMLElement>('p,h1,h2,h3,h4,h5,h6') ?? anchor.parentElement!;
  let frame = 0;
  const update = () => {
    frame = 0;
    // Anchor the whole source, not its moving caret. A wrapped source gets one
    // preview below its last line, centered inside the paragraph's line width.
    const source = (anchor.querySelector<HTMLElement>('.formula-source-inline') ?? anchor).getBoundingClientRect();
    const viewport = scroller.getBoundingClientRect();
    const line = paragraph.getBoundingClientRect(), style = getComputedStyle(paragraph);
    const pixels = (value: string) => Number.parseFloat(value) || 0;
    const left = Math.max(8, viewport.left, line.left + pixels(style.paddingLeft) + pixels(style.borderLeftWidth));
    const right = Math.min(window.innerWidth - 8, viewport.right, line.right - pixels(style.paddingRight) - pixels(style.borderRightWidth));
    const top = source.bottom + 6, bottom = Math.min(window.innerHeight - 8, viewport.bottom - 4);
    // Layout containment (large tables) and transforms establish a local fixed
    // containing block. Convert viewport coordinates through the actual origin
    // instead of assuming every fixed element is attached to the window.
    preview.style.setProperty('--math-preview-left', '0px');
    preview.style.setProperty('--math-preview-top', '0px');
    const origin = preview.getBoundingClientRect();
    const scale = origin.width / pixels(getComputedStyle(preview).width) || 1;
    preview.style.setProperty('--math-preview-width', `${Math.max(0, right - left) / scale}px`);
    preview.style.setProperty('--math-preview-height', `${Math.max(0, bottom - top) / scale}px`);
    const box = preview.getBoundingClientRect();
    const x = Math.max(left, Math.min((source.left + source.right - box.width) / 2, right - box.width));
    preview.style.setProperty('--math-preview-left', `${(x - origin.left) / scale}px`);
    preview.style.setProperty('--math-preview-top', `${(top - origin.top) / scale}px`);
    preview.style.setProperty('--math-preview-bottom', 'auto');
    preview.style.setProperty('--math-preview-visibility', right > left && bottom - top >= 24 && source.bottom >= viewport.top ? 'visible' : 'hidden');
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
  const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule);
  observer?.observe(paragraph); observer?.observe(preview); observer?.observe(scroller);
  scroller.addEventListener('scroll', schedule, { passive: true });
  anchor.addEventListener('input', schedule);
  anchor.ownerDocument.addEventListener('selectionchange', schedule);
  window.addEventListener('resize', schedule);
  schedule();
  return () => {
    cancelAnimationFrame(frame); observer?.disconnect();
    scroller.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule);
    anchor.removeEventListener('input', schedule);
    anchor.ownerDocument.removeEventListener('selectionchange', schedule);
    for (const name of ['width', 'left', 'top', 'bottom', 'height', 'visibility']) preview.style.removeProperty(`--math-preview-${name}`);
  };
}
