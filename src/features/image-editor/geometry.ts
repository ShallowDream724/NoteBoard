import type { ImageEditOperation, ImageEditRecipe, MagnifierOperation, Point, Rect } from './model';
import { measureTextLayout } from './textMetrics';

export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export const RESIZE_HANDLES: readonly ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export function normalizeRect(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

/** Clamp a source-space crop and optionally fit a width/height ratio into it. */
export function constrainCrop(rect: Rect, sourceWidth: number, sourceHeight: number, aspectRatio?: number): Rect {
  const x = Math.max(0, Math.min(sourceWidth - 1, rect.x));
  const y = Math.max(0, Math.min(sourceHeight - 1, rect.y));
  let width = Math.max(1, Math.min(sourceWidth - x, rect.width));
  let height = Math.max(1, Math.min(sourceHeight - y, rect.height));
  if (aspectRatio && Number.isFinite(aspectRatio) && aspectRatio > 0) {
    if (width / height > aspectRatio) width = height * aspectRatio;
    else height = width / aspectRatio;
  }
  return { x, y, width, height };
}

export function getOutputSize(recipe: ImageEditRecipe): { width: number; height: number } {
  return recipe.rotation % 2 ? { width: recipe.crop.height, height: recipe.crop.width } : { width: recipe.crop.width, height: recipe.crop.height };
}

export function sourceToOutput(point: Point, recipe: ImageEditRecipe): Point {
  const { crop, rotation, flipX, flipY } = recipe;
  const sx = point.x - crop.x, sy = point.y - crop.y;
  let x = sx, y = sy;
  if (rotation === 1) { x = crop.height - sy; y = sx; }
  else if (rotation === 2) { x = crop.width - sx; y = crop.height - sy; }
  else if (rotation === 3) { x = sy; y = crop.width - sx; }
  const size = getOutputSize(recipe);
  return { x: flipX ? size.width - x : x, y: flipY ? size.height - y : y };
}

export function outputToSource(point: Point, recipe: ImageEditRecipe): Point {
  const { crop, rotation } = recipe, size = getOutputSize(recipe);
  const x = recipe.flipX ? size.width - point.x : point.x;
  const y = recipe.flipY ? size.height - point.y : point.y;
  if (rotation === 1) return { x: crop.x + y, y: crop.y + crop.height - x };
  if (rotation === 2) return { x: crop.x + crop.width - x, y: crop.y + crop.height - y };
  if (rotation === 3) return { x: crop.x + crop.width - y, y: crop.y + x };
  return { x: crop.x + x, y: crop.y + y };
}

export function getSourceTransform(recipe: ImageEditRecipe): readonly [number, number, number, number, number, number] {
  const origin = sourceToOutput({ x: 0, y: 0 }, recipe);
  const x = sourceToOutput({ x: 1, y: 0 }, recipe), y = sourceToOutput({ x: 0, y: 1 }, recipe);
  return [x.x - origin.x, x.y - origin.y, y.x - origin.x, y.y - origin.y, origin.x, origin.y];
}

export function getMagnifierRect(operation: MagnifierOperation): Rect {
  return operation.rect ?? { x: operation.center.x - operation.radius, y: operation.center.y - operation.radius, width: operation.radius * 2, height: operation.radius * 2 };
}

export function getOperationBounds(operation: ImageEditOperation): Rect {
  if (operation.type === 'magnifier') return getMagnifierRect(operation);
  if ('rect' in operation) return operation.rect;
  if (operation.type === 'marker') return { x: operation.center.x - operation.size / 2, y: operation.center.y - operation.size / 2, width: operation.size, height: operation.size };
  if (operation.type === 'text') {
    const layout = measureTextLayout(operation);
    return { ...operation.position, width: layout.width, height: layout.height };
  }
  const points = 'points' in operation ? operation.points : [];
  if (!points.length) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const point of points) { minX = Math.min(minX, point.x); minY = Math.min(minY, point.y); maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y); }
  const pad = (operation.type === 'eraser' || operation.type === 'mosaic-brush' ? operation.width : 'style' in operation ? operation.style.width : 1) / 2;
  return { x: minX - pad, y: minY - pad, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 };
}

function distanceToSegment(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y, lengthSq = dx * dx + dy * dy;
  const ratio = lengthSq ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq)) : 0;
  return Math.hypot(point.x - a.x - ratio * dx, point.y - a.y - ratio * dy);
}

export function hitTestOperation(point: Point, operation: ImageEditOperation, tolerance = 6): boolean {
  if (operation.type === 'eraser') return false;
  if ('points' in operation) return operation.points.some((p, index) => distanceToSegment(point, operation.points[Math.max(0, index - 1)], p) <= tolerance + (operation.type === 'mosaic-brush' ? operation.width : operation.style.width) / 2);
  const rect = getOperationBounds(operation);
  if ((operation.type === 'rectangle' || operation.type === 'ellipse') && !operation.fill) {
    const band = tolerance + operation.style.width / 2;
    if (operation.type === 'rectangle') {
      const outer = point.x >= rect.x - band && point.x <= rect.x + rect.width + band && point.y >= rect.y - band && point.y <= rect.y + rect.height + band;
      const inner = point.x > rect.x + band && point.x < rect.x + rect.width - band && point.y > rect.y + band && point.y < rect.y + rect.height - band;
      return outer && !inner;
    }
    const rx = Math.max(.001, rect.width / 2), ry = Math.max(.001, rect.height / 2), cx = rect.x + rx, cy = rect.y + ry;
    const angle = Math.atan2((point.y - cy) / ry, (point.x - cx) / rx);
    const edge = { x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) };
    return Math.hypot(point.x - edge.x, point.y - edge.y) <= band;
  }
  if (operation.type === 'ellipse' || (operation.type === 'magnifier' && operation.shape !== 'rectangle') || (operation.type === 'marker' && operation.shape === 'circle')) {
    const rx = rect.width / 2 + tolerance, ry = rect.height / 2 + tolerance;
    return ((point.x - rect.x - rect.width / 2) / rx) ** 2 + ((point.y - rect.y - rect.height / 2) / ry) ** 2 <= 1;
  }
  return point.x >= rect.x - tolerance && point.x <= rect.x + rect.width + tolerance && point.y >= rect.y - tolerance && point.y <= rect.y + rect.height + tolerance;
}

export function isOperationMovable(operation: ImageEditOperation): boolean {
  return operation.type !== 'pen' && operation.type !== 'highlighter' && operation.type !== 'mosaic-brush' && operation.type !== 'eraser';
}

export function isOperationResizable(operation: ImageEditOperation): boolean {
  return isOperationMovable(operation);
}

/** Axis-aligned output-space bounds, including after crop rotation and mirroring. */
export function getOperationOutputBounds(operation: ImageEditOperation, recipe: ImageEditRecipe): Rect {
  const rect = getOperationBounds(operation);
  const corners = [
    { x: rect.x, y: rect.y }, { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height }, { x: rect.x, y: rect.y + rect.height },
  ].map(point => sourceToOutput(point, recipe));
  const xs = corners.map(point => point.x), ys = corners.map(point => point.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

export interface OperationResizeHandle { readonly handle: ResizeHandle; readonly x: number; readonly y: number }
export function getOperationResizeHandles(operation: ImageEditOperation, recipe: ImageEditRecipe): OperationResizeHandle[] {
  if (!isOperationResizable(operation)) return [];
  const { x, y, width, height } = getOperationOutputBounds(operation, recipe);
  return [{ handle: 'nw', x, y }, { handle: 'n', x: x + width / 2, y }, { handle: 'ne', x: x + width, y },
    { handle: 'e', x: x + width, y: y + height / 2 }, { handle: 'se', x: x + width, y: y + height },
    { handle: 's', x: x + width / 2, y: y + height }, { handle: 'sw', x, y: y + height }, { handle: 'w', x, y: y + height / 2 }];
}

function transformOperationToOutputBounds(operation: ImageEditOperation, recipe: ImageEditRecipe, old: Rect, next: Rect): ImageEditOperation {
  const map = (point: Point): Point => {
    const out = sourceToOutput(point, recipe);
    return outputToSource({ x: next.x + (out.x - old.x) / Math.max(old.width, .001) * next.width,
      y: next.y + (out.y - old.y) / Math.max(old.height, .001) * next.height }, recipe);
  };
  const sourceA = outputToSource({ x: next.x, y: next.y }, recipe), sourceB = outputToSource({ x: next.x + next.width, y: next.y + next.height }, recipe);
  const sourceRect = normalizeRect(sourceA, sourceB);
  const scale = Math.sqrt(next.width * next.height / Math.max(old.width * old.height, .001));
  if (operation.type === 'magnifier') {
    const center = { x: sourceRect.x + sourceRect.width / 2, y: sourceRect.y + sourceRect.height / 2 };
    return { ...operation, rect: sourceRect, center, radius: Math.max(sourceRect.width, sourceRect.height) / 2 };
  }
  if ('rect' in operation) return { ...operation, rect: sourceRect };
  if (operation.type === 'text') return { ...operation, position: map(operation.position), fontSize: Math.max(1, operation.fontSize * scale) };
  if (operation.type === 'marker') return { ...operation, center: map(operation.center), size: Math.max(2, operation.size * scale), style: { ...operation.style, width: operation.style.width * scale } };
  if (operation.type === 'line' || operation.type === 'polyline') return { ...operation, points: operation.points.map(map), style: { ...operation.style, width: operation.style.width * scale } };
  return operation;
}

/** Resize a source-space annotation from an output-space handle, with a fixed opposite edge/corner. */
export function resizeOperationInOutput(operation: ImageEditOperation, recipe: ImageEditRecipe, handle: ResizeHandle, outputPoint: Point, minSize = 2): ImageEditOperation {
  if (!isOperationResizable(operation)) return operation;
  const old = getOperationOutputBounds(operation, recipe);
  const left = old.x, top = old.y, right = old.x + old.width, bottom = old.y + old.height;
  let x1 = handle.includes('w') ? Math.min(outputPoint.x, right - minSize) : left;
  let x2 = handle.includes('e') ? Math.max(outputPoint.x, left + minSize) : right;
  let y1 = handle.includes('n') ? Math.min(outputPoint.y, bottom - minSize) : top;
  let y2 = handle.includes('s') ? Math.max(outputPoint.y, top + minSize) : bottom;
  const proportional = operation.type === 'text' || operation.type === 'marker' || operation.type === 'line' || operation.type === 'polyline';
  if (proportional) {
    const ratio = old.width / Math.max(old.height, .001);
    const scaleX = (x2 - x1) / Math.max(old.width, .001), scaleY = (y2 - y1) / Math.max(old.height, .001);
    const scale = Math.max(minSize / Math.max(old.width, old.height, 1), handle.length === 2 ? Math.max(scaleX, scaleY) : handle === 'n' || handle === 's' ? scaleY : scaleX);
    const nextWidth = Math.max(minSize, old.width * scale), nextHeight = Math.max(minSize / Math.max(ratio, .001), old.height * scale);
    if (handle.includes('w')) x1 = right - nextWidth; else if (handle.includes('e')) x2 = left + nextWidth; else { x1 = old.x + old.width / 2 - nextWidth / 2; x2 = x1 + nextWidth; }
    if (handle.includes('n')) y1 = bottom - nextHeight; else if (handle.includes('s')) y2 = top + nextHeight; else { y1 = old.y + old.height / 2 - nextHeight / 2; y2 = y1 + nextHeight; }
  }
  return transformOperationToOutputBounds(operation, recipe, old, { x: x1, y: y1, width: x2 - x1, height: y2 - y1 });
}

export function scaleOperationInOutput(operation: ImageEditOperation, recipe: ImageEditRecipe, factor: number, minSize = 2): ImageEditOperation {
  if (!isOperationResizable(operation) || !Number.isFinite(factor) || factor <= 0) return operation;
  const old = getOperationOutputBounds(operation, recipe);
  const scale = Math.max(factor, minSize / Math.max(old.width, old.height, 1));
  const width = Math.max(minSize, old.width * scale), height = Math.max(minSize, old.height * scale);
  return transformOperationToOutputBounds(operation, recipe, old, { x: old.x + (old.width - width) / 2, y: old.y + (old.height - height) / 2, width, height });
}

export function translateOperation(operation: ImageEditOperation, delta: Point): ImageEditOperation;
export function translateOperation(operation: ImageEditOperation, dx: number, dy: number): ImageEditOperation;
export function translateOperation(operation: ImageEditOperation, delta: Point | number, deltaY = 0): ImageEditOperation {
  if (!isOperationMovable(operation)) return operation;
  const dx = typeof delta === 'number' ? delta : delta.x, dy = typeof delta === 'number' ? deltaY : delta.y;
  const move = (point: Point): Point => ({ x: point.x + dx, y: point.y + dy });
  if (operation.type === 'magnifier') return { ...operation, center: move(operation.center), ...(operation.rect ? { rect: { ...operation.rect, ...move(operation.rect) } } : {}), ...(operation.source ? { source: move(operation.source) } : {}) };
  if ('rect' in operation) return { ...operation, rect: { ...operation.rect, ...move(operation.rect) } };
  if ('points' in operation) return { ...operation, points: operation.points.map(move) };
  if (operation.type === 'text') return { ...operation, position: move(operation.position) };
  return { ...operation, center: move(operation.center) };
}

export function validateImageEditRecipe(recipe: ImageEditRecipe): void {
  const { sourceWidth: width, sourceHeight: height, crop } = recipe;
  if (recipe.version !== 1 || ![width, height, crop.x, crop.y, crop.width, crop.height].every(Number.isFinite) || width < 1 || height < 1 || crop.width <= 0 || crop.height <= 0 || crop.x < 0 || crop.y < 0 || crop.x + crop.width > width + .001 || crop.y + crop.height > height + .001 || ![0, 1, 2, 3].includes(recipe.rotation)) throw new Error('图片编辑尺寸或裁剪范围无效');
}
