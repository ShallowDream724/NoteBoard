/** Last ordered position <= target; O(log n) position reads, O(1) memory. */
export function lastAtOrBefore(length: number, position: (index: number) => number, target: number): number {
  let low = 0, high = length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (position(middle) <= target) low = middle + 1;
    else high = middle;
  }
  return low - 1;
}
