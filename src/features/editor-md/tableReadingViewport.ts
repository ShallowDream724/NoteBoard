import { contentViewport } from '../../core/dom/contentViewport';
/** Selection, drag scrolling and overlays share the actual reading viewport. */
export function tableReadingScroll(table: HTMLTableElement, documentScroll: HTMLElement, axis: 'x' | 'y' = 'y'): HTMLElement {
  const viewport = contentViewport(table, documentScroll);
  return axis === 'x' ? viewport.scrollX : viewport.scrollY;
}

export function tableReadingBounds(table: HTMLTableElement, documentScroll: HTMLElement) {
  return contentViewport(table, documentScroll).bounds;
}
