/** Keep native pinch delivery enabled, while leaving scaling to local viewers.
 * Keyboard zoom is a fallback after the focused editor has handled its keys. */
export function installMediaGestureBoundary(target: Document): () => void {
  const wheel = (event: WheelEvent) => { if (event.ctrlKey || event.metaKey) event.preventDefault(); };
  const keydown = (event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && ['+', '=', '-', '0'].includes(event.key)) event.preventDefault();
  };
  target.addEventListener('wheel', wheel, { capture: true, passive: false });
  target.addEventListener('keydown', keydown);
  return () => { target.removeEventListener('wheel', wheel, true); target.removeEventListener('keydown', keydown); };
}
