import { getMagnifierRect, getOperationBounds } from './geometry';
import type { ArrowHead, ImageEditOperation, Point, Rect } from './model';

const EPSILON = 1e-9;
const boundsCache = new WeakMap<ImageEditOperation, Rect | null>();
const finitePoint = (point: Point): boolean => Number.isFinite(point.x) && Number.isFinite(point.y);
const dot = (a: Point, b: Point): number => a.x * b.x + a.y * b.y;
const subtract = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const cross = (a: Point, b: Point): number => a.x * b.y - a.y * b.x;

function pointSegmentDistanceSquared(point: Point, a: Point, b: Point): number {
  const edge = subtract(b, a), lengthSquared = dot(edge, edge);
  const fraction = lengthSquared ? Math.max(0, Math.min(1, dot(subtract(point, a), edge) / lengthSquared)) : 0;
  const dx = point.x - a.x - fraction * edge.x, dy = point.y - a.y - fraction * edge.y;
  return dx * dx + dy * dy;
}

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const ab = subtract(b, a), cd = subtract(d, c), denominator = cross(ab, cd);
  if (Math.abs(denominator) <= EPSILON) return false;
  const ca = subtract(c, a), t = cross(ca, cd) / denominator, u = cross(ca, ab) / denominator;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

function segmentDistanceSquared(a: Point, b: Point, c: Point, d: Point): number {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(pointSegmentDistanceSquared(a, c, d), pointSegmentDistanceSquared(b, c, d),
    pointSegmentDistanceSquared(c, a, b), pointSegmentDistanceSquared(d, a, b));
}

function touchesSegment(a: Point, b: Point, c: Point, d: Point, radius: number): boolean {
  return segmentDistanceSquared(a, b, c, d) <= radius * radius + EPSILON;
}

function rectCorners(rect: Rect): readonly Point[] {
  return [{ x: rect.x, y: rect.y }, { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height }, { x: rect.x, y: rect.y + rect.height }];
}

function validRect(rect: Rect): boolean {
  return [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) && rect.width >= 0 && rect.height >= 0;
}

function eraseBounds(operation: ImageEditOperation): Rect | null {
  const cached = boundsCache.get(operation);
  if (cached !== undefined) return cached;
  const bounds = getOperationBounds(operation);
  let pad = 0;
  if ('style' in operation) {
    if (!Number.isFinite(operation.style.width) || operation.style.width < 0) { boundsCache.set(operation, null); return null; }
    pad = operation.type === 'marker' && operation.appearance === 'filled' ? 0 : Math.max(.1, operation.style.width) / 2;
    if ('points' in operation && (operation.startHead && operation.startHead !== 'none' || operation.endHead && operation.endHead !== 'none')) {
      pad += Math.max(operation.style.width * 4, 10);
    }
  }
  if (!validRect(bounds)) { boundsCache.set(operation, null); return null; }
  const expanded = { x: bounds.x - pad, y: bounds.y - pad, width: bounds.width + 2 * pad, height: bounds.height + 2 * pad };
  boundsCache.set(operation, expanded);
  return expanded;
}

function sweepCanReachBounds(from: Point, to: Point, radius: number, bounds: Rect): boolean {
  return Math.max(from.x, to.x) + radius >= bounds.x && Math.min(from.x, to.x) - radius <= bounds.x + bounds.width
    && Math.max(from.y, to.y) + radius >= bounds.y && Math.min(from.y, to.y) - radius <= bounds.y + bounds.height;
}

function insideRect(point: Point, rect: Rect): boolean {
  return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
}

function touchesRectEdge(from: Point, to: Point, rect: Rect, radius: number): boolean {
  const corners = rectCorners(rect);
  for (let index = 0; index < 4; index++) if (touchesSegment(from, to, corners[index], corners[(index + 1) % 4], radius)) return true;
  return false;
}

function touchesRect(from: Point, to: Point, rect: Rect, radius: number, filled: boolean): boolean {
  return (filled && (insideRect(from, rect) || insideRect(to, rect))) || touchesRectEdge(from, to, rect, radius);
}

function ellipseValue(point: Point, center: Point, rx: number, ry: number): number {
  return ((point.x - center.x) / rx) ** 2 + ((point.y - center.y) / ry) ** 2;
}

function segmentCrossesEllipse(from: Point, to: Point, center: Point, rx: number, ry: number): boolean {
  const x = (from.x - center.x) / rx, y = (from.y - center.y) / ry;
  const dx = (to.x - from.x) / rx, dy = (to.y - from.y) / ry;
  const a = dx * dx + dy * dy, b = 2 * (x * dx + y * dy), c = x * x + y * y - 1;
  if (!a) return Math.abs(c) <= EPSILON;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return false;
  const root = Math.sqrt(discriminant);
  return (-b - root) / (2 * a) <= 1 && (-b + root) / (2 * a) >= 0;
}

/** Closest boundary point stays in the query point's quadrant. Minimize that smooth arc. */
function pointEllipseBoundaryDistanceSquared(point: Point, center: Point, rx: number, ry: number): number {
  const x = Math.abs(point.x - center.x), y = Math.abs(point.y - center.y);
  let low = 0, high = Math.PI / 2;
  const squared = (angle: number) => (rx * Math.cos(angle) - x) ** 2 + (ry * Math.sin(angle) - y) ** 2;
  for (let index = 0; index < 48 && (high - low) * Math.max(rx, ry) > 1e-5; index++) {
    const left = low + (high - low) / 3, right = high - (high - low) / 3;
    if (squared(left) < squared(right)) high = right; else low = left;
  }
  return Math.min(squared(0), squared(Math.PI / 2), squared((low + high) / 2));
}

function touchesEllipse(from: Point, to: Point, rect: Rect, radius: number, filled: boolean): boolean {
  const broadphase = { x: rect.x - radius, y: rect.y - radius, width: rect.width + 2 * radius, height: rect.height + 2 * radius };
  if (!touchesRect(from, to, broadphase, 0, true)) return false;
  const rx = rect.width / 2, ry = rect.height / 2;
  if (rx <= 0 || ry <= 0) return touchesRect(from, to, rect, radius, filled);
  const center = { x: rect.x + rx, y: rect.y + ry };
  if (rx === ry) {
    const closest = Math.sqrt(pointSegmentDistanceSquared(center, from, to));
    if (filled) return closest <= rx + radius + EPSILON;
    const farthest = Math.max(Math.hypot(from.x - center.x, from.y - center.y), Math.hypot(to.x - center.x, to.y - center.y));
    return closest <= rx + radius + EPSILON && farthest + radius + EPSILON >= rx;
  }
  const fromInside = ellipseValue(from, center, rx, ry) <= 1;
  const toInside = ellipseValue(to, center, rx, ry) <= 1;
  if (filled && (fromInside || toInside)) return true;
  if (from.x === to.x && from.y === to.y) return pointEllipseBoundaryDistanceSquared(from, center, rx, ry) <= radius * radius + EPSILON;
  if (segmentCrossesEllipse(from, to, center, rx, ry)) return true;
  const radiusSquared = radius * radius + EPSILON;
  if (fromInside && toInside) return Math.min(pointEllipseBoundaryDistanceSquared(from, center, rx, ry),
    pointEllipseBoundaryDistanceSquared(to, center, rx, ry)) <= radiusSquared;
  // Distance from an exterior segment to a convex ellipse is convex in segment position.
  let low = 0, high = 1;
  const distance = (fraction: number) => pointEllipseBoundaryDistanceSquared({
    x: from.x + (to.x - from.x) * fraction, y: from.y + (to.y - from.y) * fraction,
  }, center, rx, ry);
  const span = Math.hypot(to.x - from.x, to.y - from.y);
  for (let index = 0; index < 48 && (high - low) * span > 1e-5; index++) {
    const left = low + (high - low) / 3, right = high - (high - low) / 3;
    if (distance(left) < distance(right)) high = right; else low = left;
  }
  return Math.min(distance(0), distance(1), distance((low + high) / 2)) <= radiusSquared;
}

function touchesPolygon(from: Point, to: Point, vertices: readonly Point[], radius: number): boolean {
  for (let index = 0; index < vertices.length; index++) {
    if (touchesSegment(from, to, vertices[index], vertices[(index + 1) % vertices.length], radius)) return true;
  }
  const contains = (point: Point) => {
    let sign = 0;
    for (let index = 0; index < vertices.length; index++) {
      const side = cross(subtract(vertices[(index + 1) % vertices.length], vertices[index]), subtract(point, vertices[index]));
      if (Math.abs(side) <= EPSILON) continue;
      if (sign && Math.sign(side) !== sign) return false;
      sign = Math.sign(side);
    }
    return true;
  };
  return contains(from) || contains(to);
}

function touchesArrow(from: Point, to: Point, tip: Point, previous: Point, head: ArrowHead | undefined, width: number, radius: number): boolean {
  if (!head || head === 'none' || !finitePoint(tip) || !finitePoint(previous)) return false;
  const angle = Math.atan2(tip.y - previous.y, tip.x - previous.x), length = Math.max(width * 4, 10);
  const wing = (offset: number): Point => ({ x: tip.x - length * Math.cos(angle + offset), y: tip.y - length * Math.sin(angle + offset) });
  const left = wing(-Math.PI / 6), right = wing(Math.PI / 6);
  if (head === 'filled') return touchesPolygon(from, to, [left, tip, right], radius);
  return touchesSegment(from, to, left, tip, radius + width / 2) || touchesSegment(from, to, tip, right, radius + width / 2);
}

function touchesPath(from: Point, to: Point, operation: Extract<ImageEditOperation, { type: 'pen' | 'highlighter' | 'line' | 'polyline' | 'mosaic-brush' }>, radius: number): boolean {
  const { points } = operation;
  if (!points.length || points.some(point => !finitePoint(point))) return false;
  const width = operation.type === 'mosaic-brush' ? operation.width : operation.style.width;
  if (!Number.isFinite(width) || width < 0) return false;
  const reach = radius + Math.max(.1, width) / 2;
  if (points.length === 1) return touchesSegment(from, to, points[0], points[0], reach);
  for (let index = 1; index < points.length; index++) if (touchesSegment(from, to, points[index - 1], points[index], reach)) return true;
  if (operation.type === 'mosaic-brush') return false;
  return touchesArrow(from, to, points[0], points[1], operation.startHead, width, radius)
    || touchesArrow(from, to, points[points.length - 1], points[points.length - 2], operation.endHead, width, radius);
}

/** Tests the full circular eraser sweep against source-space annotation geometry. */
export function intersectsEraseSweep(operation: ImageEditOperation, from: Point, to: Point, radius: number): boolean {
  if (operation.type === 'eraser' || !finitePoint(from) || !finitePoint(to) || !Number.isFinite(radius) || radius < 0) return false;
  const bounds = eraseBounds(operation);
  if (!bounds || !sweepCanReachBounds(from, to, radius, bounds)) return false;
  if ('points' in operation) return touchesPath(from, to, operation, radius);
  if (operation.type === 'rectangle' || operation.type === 'ellipse') {
    if (!validRect(operation.rect) || !Number.isFinite(operation.style.width) || operation.style.width < 0) return false;
    const reach = radius + Math.max(.1, operation.style.width) / 2;
    return operation.type === 'rectangle'
      ? touchesRect(from, to, operation.rect, reach, Boolean(operation.fill))
      : touchesEllipse(from, to, operation.rect, reach, Boolean(operation.fill));
  }
  if (operation.type === 'marker') {
    if (!finitePoint(operation.center) || !Number.isFinite(operation.size) || operation.size < 0 || !Number.isFinite(operation.style.width)) return false;
    const rect = getOperationBounds(operation);
    const reach = radius + (operation.appearance === 'filled' ? 0 : Math.max(.1, operation.style.width) / 2);
    return operation.shape === 'circle' ? touchesEllipse(from, to, rect, reach, true) : touchesRect(from, to, rect, reach, true);
  }
  if (operation.type === 'magnifier') {
    const rect = getMagnifierRect(operation);
    if (!validRect(rect) || !Number.isFinite(operation.style.width) || operation.style.width < 0) return false;
    const reach = radius + Math.max(.1, operation.style.width) / 2;
    return operation.shape === 'rectangle' ? touchesRect(from, to, rect, reach, true) : touchesEllipse(from, to, rect, reach, true);
  }
  const rect = getOperationBounds(operation);
  if (!validRect(rect)) return false;
  if (operation.type === 'spotlight' && operation.shape === 'ellipse') return touchesEllipse(from, to, rect, radius, true);
  return touchesRect(from, to, rect, radius, true);
}
