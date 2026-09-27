import type { ImageEditOperation, ImageEditRecipe, PathOperation, Point } from './model';
import { getOperationResizeHandles, outputToSource, RESIZE_HANDLES, resizeOperationInOutput, sourceToOutput, translateOperation, type ResizeHandle } from './geometry';

export type AnnotationHandle = ResizeHandle | 'path-move' | `vertex-${number}`;
export interface SelectionHandle extends Point { handle: AnnotationHandle; label: string; cursor: string; kind: 'resize' | 'vertex' | 'move' }
const RESIZE_NAMES: Record<ResizeHandle, string> = { nw: '左上', n: '上方', ne: '右上', e: '右侧', se: '右下', s: '下方', sw: '左下', w: '左侧' };
const RESIZE_CURSORS: Record<ResizeHandle, string> = { nw: 'nwse-resize', n: 'ns-resize', ne: 'nesw-resize', e: 'ew-resize', se: 'nwse-resize', s: 'ns-resize', sw: 'nesw-resize', w: 'ew-resize' };
export function isPathAnnotation(operation: ImageEditOperation): operation is PathOperation & { type: 'line' | 'polyline' } {
  return operation.type === 'line' || operation.type === 'polyline';
}
export function isResizeHandle(handle: AnnotationHandle): handle is ResizeHandle { return (RESIZE_HANDLES as readonly string[]).includes(handle); }

/** Handles describe the object's editable geometry, rather than a universal bounding box. */
export function getSelectionHandles(operation: ImageEditOperation, recipe: ImageEditRecipe): SelectionHandle[] {
  if (!isPathAnnotation(operation)) return getOperationResizeHandles(operation, recipe).map(point => ({ ...point, label: `拖动${RESIZE_NAMES[point.handle]}控制点缩放`, cursor: RESIZE_CURSORS[point.handle], kind: 'resize' }));
  const nodes: SelectionHandle[] = operation.points.map((point, index) => ({
    ...sourceToOutput(point, recipe), handle: `vertex-${index}`, kind: 'vertex', cursor: 'crosshair',
    label: index === 0 ? '调整起点' : index === operation.points.length - 1 ? '调整终点' : `调整节点 ${index + 1}`,
  }));
  if (operation.type === 'line' && nodes.length >= 2) {
    const first = nodes[0], last = nodes.at(-1)!;
    nodes.splice(1, 0, { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2, handle: 'path-move', kind: 'move', cursor: 'move', label: '移动箭头' });
  }
  return nodes;
}

export function moveSelectionHandle(operation: ImageEditOperation, recipe: ImageEditRecipe, handle: AnnotationHandle, output: Point, start: Point): ImageEditOperation {
  if (isResizeHandle(handle)) return resizeOperationInOutput(operation, recipe, handle, output);
  if (!isPathAnnotation(operation)) return operation;
  const point = outputToSource(output, recipe);
  if (handle === 'path-move') {
    const origin = outputToSource(start, recipe);
    return translateOperation(operation, point.x - origin.x, point.y - origin.y);
  }
  const match = /^vertex-(\d+)$/.exec(handle), index = match ? Number(match[1]) : -1;
  if (index < 0 || index >= operation.points.length) return operation;
  return { ...operation, points: operation.points.map((old, at) => at === index ? point : old) };
}
