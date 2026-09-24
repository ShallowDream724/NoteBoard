export interface TabBounds { start: number; end: number }
export const TAB_EDGE_INSET = 12;
const MIN_EXPOSED_TAB = 48;

/** Sorted, untransformed geometry; O(log n) reads, no scan during scrolling. */
export function trailingTabEdge(count: number, measure: (index: number) => TabBounds,
  scrollLeft: number, width: number) {
  const none = { hidden: -1, last: -1, trim: 0 };
  const right = scrollLeft + width;
  let low = 0, high = count;
  // Include a following active tab's concave shoulder, even before its box enters.
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (measure(mid).start < right + TAB_EDGE_INSET) low = mid + 1;
    else high = mid;
  }
  const index = low - 1;
  if (index <= 0) return none;
  const current = measure(index), previous = measure(index - 1);
  const exposed = right - current.start;
  if (exposed >= MIN_EXPOSED_TAB || current.end <= right ||
      previous.end - Math.max(scrollLeft, previous.start) < MIN_EXPOSED_TAB) return none;
  return { hidden: index, last: index - 1,
    trim: Math.max(0, right - previous.end - TAB_EDGE_INSET) };
}
