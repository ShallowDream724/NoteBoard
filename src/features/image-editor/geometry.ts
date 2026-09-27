import type { ImageEditOperation, ImageEditRecipe, Point, Rect } from './model';

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

export function getOperationBounds(operation: ImageEditOperation): Rect {
  if ('rect' in operation) return operation.rect;
  if (operation.type === 'magnifier') return { x: operation.center.x - operation.radius, y: operation.center.y - operation.radius, width: operation.radius * 2, height: operation.radius * 2 };
  if (operation.type === 'marker') return { x: operation.center.x - operation.size / 2, y: operation.center.y - operation.size / 2, width: operation.size, height: operation.size };
  if (operation.type === 'text') {
    const lines = operation.text.split('\n');
    return { ...operation.position, width: Math.max(...lines.map(line => Array.from(line).length), 1) * operation.fontSize * .7, height: lines.length * operation.fontSize * 1.25 };
  }
  const points = 'points' in operation ? operation.points : [];
  if (!points.length) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const point of points) { minX = Math.min(minX, point.x); minY = Math.min(minY, point.y); maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y); }
  const pad = (operation.type === 'eraser' ? operation.width : 'style' in operation ? operation.style.width : 1) / 2;
  return { x: minX - pad, y: minY - pad, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 };
}

function distanceToSegment(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y, lengthSq = dx * dx + dy * dy;
  const ratio = lengthSq ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq)) : 0;
  return Math.hypot(point.x - a.x - ratio * dx, point.y - a.y - ratio * dy);
}

export function hitTestOperation(point: Point, operation: ImageEditOperation, tolerance = 6): boolean {
  if (operation.type === 'eraser') return false;
  if ('points' in operation) return operation.points.some((p, index) => distanceToSegment(point, operation.points[Math.max(0, index - 1)], p) <= tolerance + operation.style.width / 2);
  const rect = getOperationBounds(operation);
  if (operation.type === 'ellipse' || operation.type === 'magnifier' || (operation.type === 'marker' && operation.shape === 'circle')) {
    const rx = rect.width / 2 + tolerance, ry = rect.height / 2 + tolerance;
    return ((point.x - rect.x - rect.width / 2) / rx) ** 2 + ((point.y - rect.y - rect.height / 2) / ry) ** 2 <= 1;
  }
  return point.x >= rect.x - tolerance && point.x <= rect.x + rect.width + tolerance && point.y >= rect.y - tolerance && point.y <= rect.y + rect.height + tolerance;
}

export function translateOperation(operation: ImageEditOperation, delta: Point): ImageEditOperation;
export function translateOperation(operation: ImageEditOperation, dx: number, dy: number): ImageEditOperation;
export function translateOperation(operation: ImageEditOperation, delta: Point | number, deltaY = 0): ImageEditOperation {
  const dx = typeof delta === 'number' ? delta : delta.x, dy = typeof delta === 'number' ? deltaY : delta.y;
  const move = (point: Point): Point => ({ x: point.x + dx, y: point.y + dy });
  if ('rect' in operation) return { ...operation, rect: { ...operation.rect, ...move(operation.rect) } };
  if ('points' in operation) return { ...operation, points: operation.points.map(move) };
  if (operation.type === 'text') return { ...operation, position: move(operation.position) };
  if (operation.type === 'magnifier') return { ...operation, center: move(operation.center), ...(operation.source ? { source: move(operation.source) } : {}) };
  return { ...operation, center: move(operation.center) };
}

export function validateImageEditRecipe(recipe: ImageEditRecipe): void {
  const { sourceWidth: width, sourceHeight: height, crop } = recipe;
  if (recipe.version !== 1 || ![width, height, crop.x, crop.y, crop.width, crop.height].every(Number.isFinite) || width < 1 || height < 1 || crop.width <= 0 || crop.height <= 0 || crop.x < 0 || crop.y < 0 || crop.x + crop.width > width + .001 || crop.y + crop.height > height + .001 || ![0, 1, 2, 3].includes(recipe.rotation)) throw new Error('图片编辑尺寸或裁剪范围无效');
}
