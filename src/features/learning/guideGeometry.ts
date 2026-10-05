export interface GuideRect { left: number; top: number; width: number; height: number }
export type GuideSide = 'top' | 'bottom' | 'left' | 'right';
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
    const line = lines.find(r => Math.min(bottom(r), bottom(rect)) - Math.max(r.top, rect.top) >= Math.min(r.height, rect.height) * .75
      && Math.abs(r.top + r.height / 2 - rect.top - rect.height / 2) <= Math.max(2, Math.min(r.height, rect.height) * .25)
      && rect.left <= right(r) + 2 && right(rect) >= r.left - 2);
    if (line) Object.assign(line, unionRects([line, rect]));
    else lines.push({ ...rect });
  }
  return lines;
}

export function clipGuideRect(rect: GuideRect, bounds: GuideRect): GuideRect | null {
  const left = Math.max(rect.left, bounds.left), top = Math.max(rect.top, bounds.top);
  const width = Math.min(right(rect), right(bounds)) - left, height = Math.min(bottom(rect), bottom(bounds)) - top;
  return width > 0 && height > 0 ? { left, top, width, height } : null;
}

/** An empty line has no text range. Mark a short writing area at its real
 * insertion position, preserving the caret at either aligned edge. */
export function guideInsertionRect(caret: GuideRect, line: GuideRect, fontSize: number): GuideRect | null {
  if (caret.height <= 0 || line.width <= 0 || !Number.isFinite(fontSize) || fontSize <= 0) return null;
  const width = Math.min(line.width, fontSize * 5);
  const left = Math.max(line.left, Math.min(caret.left, right(line) - width));
  return { left, top: caret.top, width, height: caret.height };
}

/** Keep a multiline cue attached to a real edge line. If neither side fits,
 * the whole occupied range remains the collision boundary for Radix to flip. */
export function guideAnchor(rects: GuideRect[], bounds: GuideRect, cardHeight = 160): { rect: GuideRect | null; side: 'top' | 'bottom' } {
  if (!rects.length) return { rect: null, side: 'top' };
  const first = rects[0], last = rects[rects.length - 1];
  const above = first.top - bounds.top, below = bottom(bounds) - bottom(last);
  if (above >= cardHeight + 18) return { rect: first, side: 'top' };
  if (below >= cardHeight + 18) return { rect: last, side: 'bottom' };
  return { rect: unionRects(rects), side: above >= below ? 'top' : 'bottom' };
}

/** A formatting control and the text it acts on are one interaction context.
 * Prefer the side away from that text; Radix still owns viewport collisions. */
export function guideControlAnchor(rects: GuideRect[], contextRects: GuideRect[], bounds: GuideRect, card: { width: number; height: number }): { rect: GuideRect | null; side: GuideSide; align?: 'start' | 'end' } {
  const target = unionRects(rects), context = unionRects(contextRects);
  if (!target || !context) return guideAnchor(rects, bounds, card.height);
  const textAbove = bottom(context) <= target.top, textBelow = context.top >= bottom(target);
  if (textAbove && bottom(bounds) - bottom(target) >= card.height + 18) return { rect: target, side: 'bottom' };
  if (textBelow && target.top - bounds.top >= card.height + 18) return { rect: target, side: 'top' };
  if (textAbove || textBelow) {
    const left = target.left - bounds.left, rightSpace = right(bounds) - right(target);
    const side = rightSpace >= card.width + 18 || rightSpace >= left ? 'right' : 'left';
    return { rect: target, side, align: textAbove ? 'start' : 'end' };
  }
  return guideAnchor(rects, bounds, card.height);
}
