/** Small overlay/docked panels share the same resize lifecycle. Live width is
 * local DOM state; the application preference is published only on commit. */
export function bindEdgePanelResize(panel: HTMLElement, handle: HTMLElement, options: {
  preferredWidth: () => number;
  limits: () => { min: number; max: number };
  commit: (width: number) => void;
}) {
  const win = panel.ownerDocument.defaultView!;
  let frame = 0, width = options.preferredWidth();
  let drag: { pointerId: number; x: number; width: number; next: number; cursor: string; select: string } | null = null;
  const paint = (requested: number) => {
    const { min, max } = options.limits();
    width = Math.round(Math.max(Math.min(min, max), Math.min(max, requested)));
    panel.style.setProperty('--edge-panel-width', `${width}px`);
    handle.setAttribute('aria-valuemin', String(Math.min(min, max)));
    handle.setAttribute('aria-valuemax', String(max));
    handle.setAttribute('aria-valuenow', String(width));
    handle.setAttribute('aria-valuetext', `${width} 像素`);
  };
  const refresh = () => {
    if (frame) return;
    frame = win.requestAnimationFrame(() => { frame = 0; paint(drag?.next ?? options.preferredWidth()); });
  };
  const finish = (commit: boolean) => {
    if (!drag) return;
    const current = drag; drag = null;
    win.cancelAnimationFrame(frame); frame = 0;
    win.removeEventListener('pointermove', move);
    win.removeEventListener('pointerup', up);
    win.removeEventListener('pointercancel', cancel);
    win.removeEventListener('keydown', escape, true);
    win.removeEventListener('blur', cancel);
    panel.ownerDocument.body.style.cursor = current.cursor;
    panel.ownerDocument.body.style.userSelect = current.select;
    delete panel.dataset.resizing;
    if (handle.hasPointerCapture?.(current.pointerId)) handle.releasePointerCapture(current.pointerId);
    paint(commit ? current.next : options.preferredWidth());
    if (commit && width !== current.width) options.commit(width);
  };
  const move = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag.next = drag.width + drag.x - event.clientX;
    refresh();
  };
  const up = (event: PointerEvent) => { if (event.pointerId === drag?.pointerId) finish(true); };
  const cancel = () => finish(false);
  const escape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.preventDefault(); event.stopPropagation(); finish(false);
  };
  const start = (event: PointerEvent) => {
    if (event.button !== 0 || drag) return;
    event.preventDefault(); event.stopPropagation();
    handle.focus({ preventScroll: true });
    const body = panel.ownerDocument.body;
    drag = { pointerId: event.pointerId, x: event.clientX, width, next: width, cursor: body.style.cursor, select: body.style.userSelect };
    body.style.cursor = 'col-resize'; body.style.userSelect = 'none'; panel.dataset.resizing = 'true';
    handle.setPointerCapture?.(event.pointerId);
    win.addEventListener('pointermove', move);
    win.addEventListener('pointerup', up);
    win.addEventListener('pointercancel', cancel);
    win.addEventListener('keydown', escape, true);
    win.addEventListener('blur', cancel);
  };
  const keyboard = (event: KeyboardEvent) => {
    if (drag || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const limits = options.limits(), step = event.shiftKey ? 40 : 10;
    paint(event.key === 'Home' ? limits.min : event.key === 'End' ? limits.max : width + (event.key === 'ArrowLeft' ? step : -step));
    options.commit(width);
  };
  handle.addEventListener('pointerdown', start);
  handle.addEventListener('keydown', keyboard);
  handle.addEventListener('lostpointercapture', cancel);
  win.addEventListener('resize', refresh);
  const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(refresh);
  if (panel.parentElement) resize?.observe(panel.parentElement);
  const mode = new MutationObserver(() => { finish(false); refresh(); });
  if (panel.parentElement) mode.observe(panel.parentElement, { attributes: true, attributeFilter: ['data-navigation-mode'] });
  paint(options.preferredWidth());
  return { refresh, destroy() {
    finish(false); win.cancelAnimationFrame(frame); resize?.disconnect(); mode.disconnect();
    handle.removeEventListener('pointerdown', start); handle.removeEventListener('keydown', keyboard);
    handle.removeEventListener('lostpointercapture', cancel); win.removeEventListener('resize', refresh);
    panel.style.removeProperty('--edge-panel-width');
  } };
}
