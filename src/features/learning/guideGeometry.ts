export interface GuideRect { left: number; top: number; width: number; height: number }
export const right = (r: GuideRect) => r.left + r.width;
export const bottom = (r: GuideRect) => r.top + r.height;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(Math.max(min, max), value));
const separation = (a: GuideRect, b: GuideRect) => Math.hypot(Math.max(0, a.left - right(b), b.left - right(a)), Math.max(0, a.top - bottom(b), b.top - bottom(a)));
/** Point to a real visible line/control, not the empty space in a union box. */
export function nearestGuideTarget(card: GuideRect, rects: GuideRect[]): GuideRect | null {
  return rects.reduce<GuideRect | null>((best, rect) => !best || separation(card, rect) < separation(card, best) ? rect : best, null);
}
export function intersectionArea(a: GuideRect, b: GuideRect): number {
  return Math.max(0, Math.min(right(a), right(b)) - Math.max(a.left, b.left)) * Math.max(0, Math.min(bottom(a), bottom(b)) - Math.max(a.top, b.top));
}
export function unionRects(rects: GuideRect[]): GuideRect | null {
  if (!rects.length) return null;
  const left = Math.min(...rects.map(r => r.left)), top = Math.min(...rects.map(r => r.top));
  return { left, top, width: Math.max(...rects.map(right)) - left, height: Math.max(...rects.map(bottom)) - top };
}
/** Rank around the real target and keep both it and existing popovers usable. */
export function placeGuideCard(target: GuideRect, size: { width: number; height: number }, viewport: { width: number; height: number }, obstacles: GuideRect[] = []) {
  const width = Math.min(size.width, viewport.width - 24), height = Math.min(size.height, viewport.height - 24), gap = 56;
  const middle = target.top + target.height / 2 - height / 2;
  const candidates = [
    { left: right(target) + gap, top: middle },
    { left: target.left - width - gap, top: middle },
    { left: target.left + target.width / 2 - width / 2, top: bottom(target) + gap },
    { left: target.left + target.width / 2 - width / 2, top: target.top - height - gap },
  ].map(p => ({ left: clamp(p.left, 12, viewport.width - width - 12), top: clamp(p.top, 12, viewport.height - height - 12), width, height }));
  const score = (r: GuideRect) => {
    const distance = separation(r, target);
    return intersectionArea(r, { left: target.left - 8, top: target.top - 8, width: target.width + 16, height: target.height + 16 }) * 20
      + obstacles.reduce((sum, obstacle) => sum + intersectionArea(r, obstacle), 0)
      + Math.max(0, 40 - distance) ** 2;
  };
  return candidates.reduce((best, candidate) => score(candidate) < score(best) ? candidate : best);
}
/** Arrow endpoints lie on the card and target edges, never inside editable text. */
export function guideArrow(card: GuideRect, target: GuideRect) {
  const cx = card.left + card.width / 2, cy = card.top + card.height / 2;
  const tx = target.left + target.width / 2, ty = target.top + target.height / 2;
  if (right(card) <= target.left || card.left >= right(target)) {
    const start = { x: cx < tx ? right(card) : card.left, y: clamp(ty, card.top + 20, bottom(card) - 20) };
    const end = { x: cx < tx ? target.left - 6 : right(target) + 6, y: ty };
    return { start, end, path: `M ${start.x} ${start.y} L ${end.x} ${end.y}` };
  }
  const start = { x: clamp(tx, card.left + 20, right(card) - 20), y: cy < ty ? bottom(card) : card.top };
  const end = { x: tx, y: cy < ty ? target.top - 6 : bottom(target) + 6 };
  return { start, end, path: `M ${start.x} ${start.y} L ${end.x} ${end.y}` };
}
