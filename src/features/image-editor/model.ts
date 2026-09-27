/** Coordinates and style widths are always expressed in original source pixels. */
export interface Point { readonly x: number; readonly y: number }
export interface Rect { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
export type LinePattern = 'solid' | 'dash' | 'dashdot';
export type ArrowHead = 'none' | 'open' | 'filled';
export interface StrokeStyle {
  readonly color: string;
  readonly width: number;
  readonly pattern: LinePattern;
  readonly opacity?: number;
}
interface OperationBase { readonly id: string }
export interface PathOperation extends OperationBase {
  readonly type: 'pen' | 'highlighter' | 'line' | 'polyline';
  readonly points: readonly Point[];
  readonly style: StrokeStyle;
  readonly startHead?: ArrowHead;
  readonly endHead?: ArrowHead;
}
export interface ShapeOperation extends OperationBase {
  readonly type: 'rectangle' | 'ellipse';
  readonly rect: Rect;
  readonly style: StrokeStyle;
  readonly fill?: string;
}
export interface TextOperation extends OperationBase {
  readonly type: 'text';
  /** Top-left of the first line. */
  readonly position: Point;
  readonly text: string;
  readonly color: string;
  readonly fontSize: number;
  readonly fontFamily?: string;
  readonly bold?: boolean;
  readonly italic?: boolean;
}
export type MarkerFormat = 'decimal' | 'roman' | 'alpha';
export type MarkerShape = 'circle' | 'square';
export type MarkerAppearance = 'outlined' | 'filled' | 'ring';
export interface MarkerOperation extends OperationBase {
  readonly type: 'marker';
  readonly center: Point;
  readonly size: number;
  readonly value: number;
  readonly format: MarkerFormat;
  readonly shape: MarkerShape;
  readonly appearance: MarkerAppearance;
  readonly style: StrokeStyle;
}
export interface MosaicOperation extends OperationBase {
  readonly type: 'mosaic';
  readonly rect: Rect;
  readonly blockSize: number;
}
export interface MosaicBrushOperation extends OperationBase {
  readonly type: 'mosaic-brush';
  readonly points: readonly Point[];
  readonly width: number;
  readonly blockSize: number;
}
export interface SpotlightOperation extends OperationBase {
  readonly type: 'spotlight';
  readonly rect: Rect;
  readonly shape: 'rectangle' | 'ellipse';
  readonly opacity: number;
}
export interface MagnifierOperation extends OperationBase {
  readonly type: 'magnifier';
  /** Legacy circular geometry; retained so existing drafts remain readable. */
  readonly center: Point;
  readonly source?: Point;
  readonly radius: number;
  /** When present, this is the authoritative destination geometry. */
  readonly rect?: Rect;
  /** Defaults to ellipse for legacy records. */
  readonly shape?: 'ellipse' | 'rectangle';
  readonly zoom: number;
  readonly style: StrokeStyle;
}
export interface EraserOperation extends OperationBase {
  readonly type: 'eraser';
  readonly points: readonly Point[];
  readonly width: number;
}
export type ImageEditOperation = PathOperation | ShapeOperation | TextOperation | MarkerOperation | MosaicOperation | MosaicBrushOperation | SpotlightOperation | MagnifierOperation | EraserOperation;
export type ImageEditorTool = ImageEditOperation['type'] | 'crop' | 'select' | 'object-eraser';

export interface ImageEditRecipe {
  readonly version: 1;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly crop: Rect;
  /** Clockwise quarter turns, followed by reflection along the output axes. */
  readonly rotation: 0 | 1 | 2 | 3;
  readonly flipX: boolean;
  readonly flipY: boolean;
  readonly operations: readonly ImageEditOperation[];
}

export function createImageEditRecipe(width: number, height: number): ImageEditRecipe {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) throw new Error('图片尺寸无效');
  return { version: 1, sourceWidth: width, sourceHeight: height, crop: { x: 0, y: 0, width, height }, rotation: 0, flipX: false, flipY: false, operations: [] };
}

/** Snapshot arrays share immutable operations; never store bitmap data in history. */
export interface ImageEditSnapshot { readonly recipe: ImageEditRecipe; readonly nextMarker: number }
export interface ImageEditHistory {
  readonly past: readonly ImageEditSnapshot[];
  readonly present: ImageEditSnapshot;
  readonly future: readonly ImageEditSnapshot[];
}
export const IMAGE_EDIT_HISTORY_LIMIT = 80;
export function createImageEditHistory(recipe: ImageEditRecipe, nextMarker = 1): ImageEditHistory {
  return { past: [], present: { recipe, nextMarker }, future: [] };
}
export function commitImageEdit(history: ImageEditHistory, recipe: ImageEditRecipe, nextMarker = history.present.nextMarker): ImageEditHistory {
  if (recipe === history.present.recipe && nextMarker === history.present.nextMarker) return history;
  return { past: [...history.past, history.present].slice(-IMAGE_EDIT_HISTORY_LIMIT), present: { recipe, nextMarker }, future: [] };
}
export function undoImageEdit(history: ImageEditHistory): ImageEditHistory {
  const previous = history.past.at(-1);
  return previous ? { past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future] } : history;
}
export function redoImageEdit(history: ImageEditHistory): ImageEditHistory {
  const next = history.future[0];
  return next ? { past: [...history.past, history.present].slice(-IMAGE_EDIT_HISTORY_LIMIT), present: next, future: history.future.slice(1) } : history;
}
export function formatMarkerValue(value: number, format: MarkerFormat): string {
  const n = Number.isFinite(value) ? Math.max(1, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(value))) : 1;
  if (format === 'decimal') return String(n);
  if (format === 'alpha') {
    let result = '', rest = n;
    while (rest > 0) { rest--; result = String.fromCharCode(65 + rest % 26) + result; rest = Math.floor(rest / 26); }
    return result;
  }
  if (n > 3999) return String(n);
  const digits: readonly [number, string][] = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let result = '', rest = n;
  for (const [amount, glyph] of digits) while (rest >= amount) { result += glyph; rest -= amount; }
  return result;
}
