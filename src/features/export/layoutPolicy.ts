/** Geometry-only policy. DOM measurement and PDF I/O stay outside this module. */
export interface ColumnBand { from: number; to: number }
export interface TablePlan { scale: number; bands: ColumnBand[]; score: number }

/** Ordered column bands, repeating column zero. Bounded look-back prevents a
 * quadratic search on pathological inputs; ordinary printable bands are small.
 * Four scale candidates, O(columns * 128) worst case, O(columns) working space. */
export function planTableColumns(widths: readonly number[], available: number, minimumScale: number): TablePlan | null {
  if (widths.length < 2 || !Number.isFinite(available) || available <= 0 || widths.some(width => !Number.isFinite(width) || width <= 0)) return null;
  let best: TablePlan | null = null;
  const floor = Math.max(.1, Math.min(1, minimumScale));
  const scales = [...new Set([1, .92, .85, floor].filter(scale => scale >= floor))];
  for (const scale of scales) {
    const limit = available / scale - widths[0], count = widths.length;
    if (widths.slice(1).some(width => width > limit + .01)) continue;
    const costs = new Float64Array(count + 1); costs.fill(Infinity); costs[1] = 0;
    const previous = new Int32Array(count + 1);
    for (let end = 2; end <= count; end++) {
      let used = 0;
      for (let start = end - 1; start >= Math.max(1, end - 128); start--) {
        used += widths[start]; if (used > limit + .01) break;
        const slack = Math.max(0, (limit - used) / limit);
        const score = costs[start] + 5 + slack * slack;
        if (score < costs[end]) { costs[end] = score; previous[end] = start; }
      }
    }
    if (!Number.isFinite(costs[count])) continue;
    const score = costs[count] + 6 * ((1 - scale) / Math.max(.01, 1 - floor)) ** 2;
    if (!best || score < best.score) {
      const bands: ColumnBand[] = [];
      for (let end = count; end > 1;) { const from = previous[end]; bands.push({ from, to: end }); end = from; }
      best = { scale, bands: bands.reverse(), score };
    }
  }
  return best;
}

export interface MathGeometry { width: number; height: number; wrappedWidth: number; wrappedHeight: number; availableWidth: number; availableHeight: number; minimumScale: number }
export interface MathPlan { wrap: boolean; scale: number; readable: boolean }
export function planMath(input: MathGeometry): MathPlan {
  const fit = (width: number, height: number) => Math.min(1, input.availableWidth / Math.max(1, width), input.availableHeight / Math.max(1, height));
  const plain = fit(input.width, input.height), wrapped = fit(input.wrappedWidth, input.wrappedHeight);
  // Prefer unscaled wrapping; a tiny shrink may avoid a disproportionately tall block.
  if (plain >= .94 && input.wrappedHeight > input.height * 2) return { wrap: false, scale: plain, readable: plain >= input.minimumScale };
  if (wrapped >= input.minimumScale) return { wrap: true, scale: wrapped, readable: true };
  if (plain >= input.minimumScale) return { wrap: false, scale: plain, readable: true };
  return { wrap: wrapped >= plain, scale: 1, readable: false };
}
