import type { ArrowHead, ImageEditOperation, ImageEditorTool, LinePattern, MarkerAppearance, MarkerFormat, MarkerShape, Point, StrokeStyle } from './model';
export interface ToolStyle {
  color: string; width: number; pattern: LinePattern; startHead: ArrowHead; endHead: ArrowHead;
  fontSize: number; bold: boolean; italic: boolean; text: string;
  markerSize: number; markerFormat: MarkerFormat; markerShape: MarkerShape; markerAppearance: MarkerAppearance;
  blockSize: number; opacity: number; zoom: number; radius: number; spotlightShape: 'rectangle' | 'ellipse'; magnifierShape: 'rectangle' | 'ellipse';
}
export const DEFAULT_TOOL_STYLE: ToolStyle = { color: '#ef4444', width: 4, pattern: 'solid', startHead: 'none', endHead: 'filled',
  fontSize: 32, bold: false, italic: false, text: '', markerSize: 44, markerFormat: 'decimal', markerShape: 'circle', markerAppearance: 'filled',
  blockSize: 14, opacity: .6, zoom: 2, radius: 72, spotlightShape: 'ellipse', magnifierShape: 'ellipse' };

export function createToolOperation(tool: ImageEditorTool, point: Point, style: ToolStyle, value: number): ImageEditOperation | null {
  const id = crypto.randomUUID(), stroke: StrokeStyle = { color: style.color, width: style.width, pattern: style.pattern };
  if (['pen', 'highlighter', 'line', 'polyline'].includes(tool)) return {
    id, type: tool as 'pen' | 'highlighter' | 'line' | 'polyline', points: [point, point],
    style: stroke,
    ...(['line', 'polyline'].includes(tool) ? { startHead: style.startHead, endHead: style.endHead } : {}),
  };
  const rect = { ...point, width: 0, height: 0 };
  if (tool === 'rectangle' || tool === 'ellipse') return { id, type: tool, rect, style: stroke };
  if (tool === 'mosaic') return { id, type: tool, rect, blockSize: style.blockSize };
  if (tool === 'mosaic-brush') return { id, type: tool, points: [point], width: style.width, blockSize: style.blockSize };
  if (tool === 'spotlight') return { id, type: tool, rect, shape: style.spotlightShape, opacity: style.opacity };
  if (tool === 'magnifier') return { id, type: tool, center: point, radius: style.radius, rect: { x: point.x - style.radius, y: point.y - style.radius, width: style.radius * 2, height: style.radius * 2 }, shape: style.magnifierShape, zoom: style.zoom, style: stroke };
  if (tool === 'marker') return { id, type: tool, center: point, value, size: style.markerSize, format: style.markerFormat, shape: style.markerShape, appearance: style.markerAppearance, style: stroke };
  if (tool === 'text') return style.text.trim() ? { id, type: tool, position: point, text: style.text, color: style.color, fontSize: style.fontSize, bold: style.bold, italic: style.italic } : null;
  if (tool === 'eraser') return { id, type: tool, points: [point], width: style.width };
  return null;
}

/** A selected annotation keeps its geometry while compatible style fields change. */
export function restyleOperation(operation: ImageEditOperation, patch: Partial<ToolStyle>): ImageEditOperation {
  let next = operation;
  if ('style' in next) next = { ...next, style: { ...next.style,
    ...(patch.color !== undefined ? { color: patch.color } : {}), ...(patch.width !== undefined ? { width: patch.width } : {}),
    ...(patch.pattern !== undefined ? { pattern: patch.pattern } : {}) } };
  if (next.type === 'text') return { ...next, ...(patch.text !== undefined ? { text: patch.text } : {}),
    ...(patch.color !== undefined ? { color: patch.color } : {}), ...(patch.fontSize !== undefined ? { fontSize: patch.fontSize } : {}),
    ...(patch.bold !== undefined ? { bold: patch.bold } : {}), ...(patch.italic !== undefined ? { italic: patch.italic } : {}) };
  if (next.type === 'marker') return { ...next, ...(patch.markerSize !== undefined ? { size: patch.markerSize } : {}),
    ...(patch.markerFormat ? { format: patch.markerFormat } : {}), ...(patch.markerShape ? { shape: patch.markerShape } : {}),
    ...(patch.markerAppearance ? { appearance: patch.markerAppearance } : {}) };
  if (next.type === 'line' || next.type === 'polyline') return { ...next, ...(patch.startHead ? { startHead: patch.startHead } : {}), ...(patch.endHead ? { endHead: patch.endHead } : {}) };
  if (next.type === 'mosaic' && patch.blockSize !== undefined) return { ...next, blockSize: patch.blockSize };
  if (next.type === 'mosaic-brush') return { ...next, ...(patch.blockSize !== undefined ? { blockSize: patch.blockSize } : {}), ...(patch.width !== undefined ? { width: patch.width } : {}) };
  if (next.type === 'spotlight') return { ...next, ...(patch.opacity !== undefined ? { opacity: patch.opacity } : {}), ...(patch.spotlightShape ? { shape: patch.spotlightShape } : {}) };
  if (next.type === 'magnifier') {
    const radius = patch.radius ?? next.radius;
    const rect = patch.radius !== undefined ? { x: next.center.x - radius, y: next.center.y - radius, width: radius * 2, height: radius * 2 } : next.rect;
    return { ...next, radius, rect, ...(patch.magnifierShape ? { shape: patch.magnifierShape } : {}), ...(patch.zoom !== undefined ? { zoom: patch.zoom } : {}) };
  }
  return next;
}
