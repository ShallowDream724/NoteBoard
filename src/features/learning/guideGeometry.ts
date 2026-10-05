export interface GuideRect { left: number; top: number; width: number; height: number }
const right = (r: GuideRect) => r.left + r.width;
const bottom = (r: GuideRect) => r.top + r.height;
export function unionRects(rects: GuideRect[]): GuideRect | null {
  if (!rects.length) return null;
  const left = Math.min(...rects.map(r => r.left)), top = Math.min(...rects.map(r => r.top));
  return { left, top, width: Math.max(...rects.map(right)) - left, height: Math.max(...rects.map(bottom)) - top };
}
/** One outline per visual text line, even when marks split it into many nodes. */
export function mergeTextRects(rects: GuideRect[]): GuideRect[] {
  const lines: GuideRect[] = [];
  for (const rect of rects.filter(r => r.width > 0 && r.height > 0).sort((a, b) => a.top - b.top || a.left - b.left)) {
    const line = lines.find(r => Math.abs(r.top - rect.top) <= 2 && Math.abs(bottom(r) - bottom(rect)) <= 2
      && rect.left <= right(r) + 2 && right(rect) >= r.left - 2);
    if (line) Object.assign(line, unionRects([line, rect]));
    else lines.push({ ...rect });
  }
  return lines;
}
