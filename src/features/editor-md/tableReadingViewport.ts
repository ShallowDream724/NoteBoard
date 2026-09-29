/** Selection, drag scrolling and overlays share the actual reading viewport. */
export function tableReadingScroll(table: HTMLTableElement, documentScroll: HTMLElement): HTMLElement {
  const wrapper = table.parentElement;
  return wrapper?.dataset.blockReading === 'scroll' ? wrapper : documentScroll;
}

export function tableReadingBounds(table: HTMLTableElement, documentScroll: HTMLElement) {
  const owner = documentScroll.getBoundingClientRect();
  const local = tableReadingScroll(table, documentScroll);
  const box = local === documentScroll ? owner : local.getBoundingClientRect();
  const left = Math.max(0, owner.left, box.left), top = Math.max(0, owner.top, box.top);
  const right = Math.min(window.innerWidth, owner.right, box.right), bottom = Math.min(window.innerHeight, owner.bottom, box.bottom);
  return { left, right, top, bottom, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}
