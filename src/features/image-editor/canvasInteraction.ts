import type { ImageEditOperation, ImageEditRecipe, ImageEditorTool, Point, Rect, TextOperation } from './model';
import { constrainCrop, getOperationOutputBounds, getOperationResizeHandles, getOutputSize, hitTestOperation, isOperationMovable, normalizeRect, outputToSource, resizeOperationInOutput, scaleOperationInOutput, translateOperation, type ResizeHandle } from './geometry';
import { createToolOperation, restyleOperation, type ToolStyle } from './toolDefaults';

export interface CanvasInteractionAdapter {
  recipe(): ImageEditRecipe;
  tool(): ImageEditorTool;
  style(): ToolStyle;
  nextMarker(): number;
  ratio(): number;
  circleMagnifier(): boolean;
  commit(recipe: ImageEditRecipe, nextMarker?: number): void;
  controlsChanged(): void;
}
interface Drag {
  kind: 'draw' | 'move' | 'resize' | 'erase' | 'crop-move' | 'crop-resize' | 'crop-draw';
  base: ImageEditRecipe;
  start: Point;
  original?: ImageEditOperation;
  handle?: ResizeHandle;
  crop?: Rect;
  points?: Point[];
  moved: boolean;
}
interface Polyline { base: ImageEditRecipe; operation: ImageEditOperation & { type: 'polyline'; points: readonly Point[] }; confirmed: Point[]; hover: Point }
const inside = (p: Point, r: Rect) => p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
const replace = (base: ImageEditRecipe, operation: ImageEditOperation) => ({ ...base, operations: base.operations.some(item => item.id === operation.id)
  ? base.operations.map(item => item.id === operation.id ? operation : item) : [...base.operations, operation] });

/** One transient recipe per gesture; only completed edits enter undo history. No bitmap ownership. */
export class ImageCanvasInteraction {
  selected: string | null = null;
  text: { operation: TextOperation; base: ImageEditRecipe } | null = null;
  crop: Rect | null = null;
  private preview: ImageEditRecipe | null = null;
  private drag: Drag | null = null;
  private polyline: Polyline | null = null;
  private propertyEditing = false;
  private wheelTimer: ReturnType<typeof setTimeout> | undefined;
  private listeners = new Set<() => void>();
  private version = 0;
  private frame: number | undefined;
  constructor(private readonly adapter: CanvasInteractionAdapter) {}
  subscribe = (callback: () => void) => { this.listeners.add(callback); return () => { this.listeners.delete(callback); }; };
  getVersion = () => this.version;
  private changed(controls = false) {
    if (controls) this.adapter.controlsChanged();
    if (this.frame !== undefined) return;
    this.frame = requestAnimationFrame(() => { this.frame = undefined; this.version++; this.listeners.forEach(callback => callback()); });
  }
  refresh() { this.changed(true); }
  dispose() { if (this.frame !== undefined) cancelAnimationFrame(this.frame); clearTimeout(this.wheelTimer); this.listeners.clear(); }
  getPreview(): ImageEditRecipe { return this.preview ?? this.adapter.recipe(); }
  getRenderRecipe(): ImageEditRecipe {
    let recipe = this.getPreview();
    if (this.crop) recipe = this.fullRecipe(recipe);
    if (this.text) recipe = { ...recipe, operations: recipe.operations.filter(item => item.id !== this.text!.operation.id) };
    return recipe;
  }
  private fullRecipe(recipe = this.adapter.recipe()): ImageEditRecipe {
    return { ...recipe, crop: { x: 0, y: 0, width: recipe.sourceWidth, height: recipe.sourceHeight } };
  }
  selectedOperation() { return this.getPreview().operations.find(item => item.id === this.selected); }
  private cropOperation(): ImageEditOperation | undefined {
    return this.crop ? { id: 'crop-frame', type: 'rectangle', rect: this.crop, style: { color: '', width: 1, pattern: 'solid' } } : undefined;
  }
  getCropBounds(): Rect | null { const op = this.cropOperation(); return op ? getOperationOutputBounds(op, this.fullRecipe()) : null; }
  getSelectionBounds(): Rect | null {
    const op = this.selectedOperation(); return op && isOperationMovable(op) && !this.text ? getOperationOutputBounds(op, this.getPreview()) : null;
  }
  getHandles() {
    const op = this.cropOperation() ?? (!this.text ? this.selectedOperation() : undefined);
    return op ? getOperationResizeHandles(op, this.getRenderRecipe()) : [];
  }
  private hit(output: Point, tolerance: number): ImageEditOperation | undefined {
    const recipe = this.getPreview(), point = outputToSource(output, recipe), selected = this.selectedOperation();
    if (selected && isOperationMovable(selected) && inside(output, getOperationOutputBounds(selected, recipe))) return selected;
    return [...recipe.operations].reverse().find(op => isOperationMovable(op) && hitTestOperation(point, op, tolerance));
  }
  cursor(output: Point, tolerance: number, alt = false): string {
    if (this.drag?.kind === 'move' || this.drag?.kind === 'crop-move') return 'grabbing';
    if (this.crop) return inside(output, this.getCropBounds()!) ? 'move' : 'crosshair';
    if (!alt && !this.polyline && this.adapter.tool() !== 'object-eraser' && this.hit(output, tolerance)) return 'move';
    return this.adapter.tool() === 'select' ? 'default' : 'crosshair';
  }
  pointerDown(output: Point, settings: { tolerance: number; alt?: boolean; handle?: ResizeHandle }) {
    this.endWheel(); this.endPropertyChange(); this.finishText();
    const base = this.adapter.recipe(), tool = this.adapter.tool();
    if (this.crop) {
      const kind = settings.handle ? 'crop-resize' : inside(output, this.getCropBounds()!) ? 'crop-move' : 'crop-draw';
      this.drag = { kind, start: output, base: this.fullRecipe(), crop: this.crop, handle: settings.handle, moved: false };
      return;
    }
    const point = outputToSource(output, base);
    if (this.polyline) {
      const previous = this.polyline.confirmed.at(-1)!;
      if (Math.hypot(point.x - previous.x, point.y - previous.y) > settings.tolerance / 2) this.polyline.confirmed.push(point);
      this.polyline.hover = point; this.updatePolyline(); return;
    }
    const hit = !settings.alt && tool !== 'object-eraser' ? this.hit(output, settings.tolerance) : undefined;
    if (hit) {
      this.selected = hit.id;
      this.drag = { kind: settings.handle ? 'resize' : 'move', start: output, base, original: hit, handle: settings.handle, moved: false };
      this.changed(true); return;
    }
    this.selected = null;
    if (tool === 'select') { this.changed(true); return; }
    if (tool === 'object-eraser') {
      this.drag = { kind: 'erase', start: output, base, moved: false }; this.preview = base;
      this.erase(point, settings.tolerance); this.changed(true); return;
    }
    if (tool === 'text') {
      const style = this.adapter.style();
      this.beginText({ id: crypto.randomUUID(), type: 'text', position: point, text: '', color: style.color, fontSize: style.fontSize, bold: style.bold, italic: style.italic }); return;
    }
    const op = createToolOperation(tool, point, this.adapter.style(), this.adapter.nextMarker());
    if (!op) { this.changed(true); return; }
    if (op.type === 'marker') {
      this.adapter.commit(replace(base, op), this.adapter.nextMarker() + 1); this.selected = op.id; this.changed(true); return;
    }
    if (op.type === 'polyline') {
      this.polyline = { base, operation: { ...op, type: 'polyline' }, confirmed: [point], hover: point }; this.updatePolyline(); return;
    }
    this.drag = { kind: 'draw', start: output, base, original: op, points: 'points' in op ? [...op.points] : undefined, moved: false };
    this.preview = replace(base, op); this.changed(true);
  }
  pointerMove(output: Point, tolerance: number) {
    if (this.polyline) { this.polyline.hover = outputToSource(output, this.polyline.base); this.updatePolyline(); return; }
    const drag = this.drag; if (!drag) return;
    if (Math.hypot(output.x - drag.start.x, output.y - drag.start.y) > tolerance / 2) drag.moved = true;
    if (drag.kind === 'resize' && (output.x !== drag.start.x || output.y !== drag.start.y)) drag.moved = true;
    const point = outputToSource(output, drag.base), start = outputToSource(drag.start, drag.base);
    if (drag.kind.startsWith('crop')) {
      let rect = drag.crop!;
      if (drag.kind === 'crop-move') rect = { ...rect, x: Math.max(0, Math.min(drag.base.sourceWidth - rect.width, rect.x + point.x - start.x)), y: Math.max(0, Math.min(drag.base.sourceHeight - rect.height, rect.y + point.y - start.y)) };
      else if (drag.kind === 'crop-resize') {
        const op = resizeOperationInOutput({ id: 'crop', type: 'rectangle', rect, style: { color: '', width: 1, pattern: 'solid' } }, drag.base, drag.handle!, output);
        if ('rect' in op && op.rect) rect = op.rect;
      } else rect = normalizeRect(start, point);
      const ratio = this.adapter.ratio();
      this.crop = constrainCrop(rect, drag.base.sourceWidth, drag.base.sourceHeight, ratio ? drag.base.rotation % 2 ? 1 / ratio : ratio : undefined);
    } else if (drag.kind === 'erase') this.erase(point, tolerance);
    else if (drag.original) {
      let op = drag.original;
      if (drag.kind === 'move') op = translateOperation(op, point.x - start.x, point.y - start.y);
      else if (drag.kind === 'resize') op = resizeOperationInOutput(op, drag.base, drag.handle!, output);
      else if ('points' in op) {
        const points = drag.points!;
        if (op.type === 'line') op = { ...op, points: [start, point] };
        else if (Math.hypot(point.x - points.at(-1)!.x, point.y - points.at(-1)!.y) >= tolerance / 8) { points.push(point); op = { ...op, points }; }
        else return;
      } else if (op.type === 'magnifier') {
        let end = point;
        if (this.adapter.circleMagnifier()) { const length = Math.max(Math.abs(point.x - start.x), Math.abs(point.y - start.y)); end = { x: start.x + Math.sign(point.x - start.x || 1) * length, y: start.y + Math.sign(point.y - start.y || 1) * length }; }
        const rect = normalizeRect(start, end); op = { ...op, rect, center: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }, radius: Math.max(rect.width, rect.height) / 2 };
      } else if ('rect' in op) op = { ...op, rect: normalizeRect(start, point) };
      this.preview = replace(drag.base, op);
    }
    this.changed();
  }
  pointerUp() {
    const drag = this.drag; this.drag = null; if (!drag) return;
    if (drag.kind.startsWith('crop')) { this.changed(true); return; }
    if (drag.kind === 'move' && !drag.moved && drag.original?.type === 'text') { this.preview = null; this.beginText(drag.original); return; }
    const op = this.preview?.operations.find(item => item.id === drag.original?.id);
    // The live path is mutable for O(1) point appends; history gets its own final array.
    if (op && 'points' in op && this.preview) this.preview = replace(this.preview, { ...op, points: [...op.points] });
    if (drag.kind === 'draw' && op && isOperationMovable(op)) {
      const bounds = getOperationOutputBounds(op, drag.base);
      if (bounds.width < 2 && bounds.height < 2) { this.preview = null; this.changed(true); return; }
      this.selected = op.id;
    }
    if ((drag.kind === 'move' || drag.kind === 'resize') && !drag.moved) this.preview = null;
    this.commitPreview();
  }
  cancelGesture() {
    if (this.drag?.crop) this.crop = this.drag.crop;
    this.drag = null; this.preview = this.text ? replace(this.text.base, this.text.operation) : null; this.changed(true);
  }
  private erase(point: Point, tolerance: number) {
    const base = this.getPreview(); this.preview = { ...base, operations: base.operations.filter(op => !hitTestOperation(point, op, tolerance)) };
  }
  private updatePolyline() {
    const draft = this.polyline!;
    this.preview = replace(draft.base, { ...draft.operation, points: [...draft.confirmed, draft.hover] }); this.changed();
  }
  finishPolyline(): boolean {
    const draft = this.polyline; if (!draft) return false;
    this.polyline = null; this.preview = null;
    if (draft.confirmed.length >= 2) { const op = { ...draft.operation, points: [...draft.confirmed] }; this.adapter.commit(replace(draft.base, op)); this.selected = op.id; }
    this.changed(true); return true;
  }
  private beginText(operation: TextOperation) {
    this.text = { operation, base: this.adapter.recipe() }; this.selected = operation.id;
    this.preview = replace(this.text.base, operation); this.changed(true);
  }
  updateText(value: string) {
    if (!this.text) return;
    this.text.operation = { ...this.text.operation, text: value }; this.preview = replace(this.text.base, this.text.operation); this.changed(true);
  }
  finishText(): boolean {
    const draft = this.text; if (!draft) return false;
    this.text = null; this.preview = null;
    const recipe = draft.operation.text.trim() ? replace(draft.base, draft.operation) : { ...draft.base, operations: draft.base.operations.filter(op => op.id !== draft.operation.id) };
    if (draft.base.operations.find(op => op.id === draft.operation.id) === draft.operation) { this.changed(true); return true; }
    if (draft.operation.text.trim() || draft.base.operations.some(op => op.id === draft.operation.id)) this.adapter.commit(recipe);
    else this.selected = null;
    this.changed(true); return true;
  }
  doubleClick(output: Point, tolerance: number) {
    if (this.finishPolyline()) return;
    const op = this.hit(output, tolerance); if (op?.type === 'text') this.beginText(op);
  }
  outside() { this.finishPolyline(); this.finishText(); this.endWheel(); }
  private commitPreview() {
    const preview = this.preview; this.preview = null;
    if (preview && preview !== this.adapter.recipe()) this.adapter.commit(preview);
    this.changed(true);
  }
  beginPropertyChange() { if (this.propertyEditing) return; this.endWheel(); this.propertyEditing = true; }
  endPropertyChange() { if (!this.propertyEditing) return; this.propertyEditing = false; if (!this.text) this.commitPreview(); }
  changeSelected(update: (operation: ImageEditOperation) => ImageEditOperation) {
    const op = this.selectedOperation(); if (!op) return;
    const next = update(op);
    if (this.text && next.type === 'text') { this.text.operation = next; this.preview = replace(this.text.base, next); }
    else { this.preview = replace(this.getPreview(), next); if (!this.propertyEditing) this.commitPreview(); }
    this.changed(true);
  }
  changeStyle(patch: Partial<ToolStyle>) { this.changeSelected(op => restyleOperation(op, patch)); }
  scaleSelected(factor: number): boolean {
    this.finishText();
    const op = this.selectedOperation(); if (!op || !isOperationMovable(op) || this.crop) return false;
    const recipe = this.getPreview(); const bounds = getOperationOutputBounds(op, recipe);
    const max = Math.max(recipe.sourceWidth, recipe.sourceHeight) * 4;
    const safeFactor = Math.min(Math.max(.02, factor), max / Math.max(bounds.width, bounds.height, 1));
    this.preview = replace(recipe, scaleOperationInOutput(op, recipe, safeFactor));
    clearTimeout(this.wheelTimer); this.wheelTimer = setTimeout(() => this.endWheel(), 180); this.changed(); return true;
  }
  endWheel() { if (this.wheelTimer === undefined) return; clearTimeout(this.wheelTimer); this.wheelTimer = undefined; this.commitPreview(); }
  beginCrop() { this.finish(); this.selected = null; this.crop = { ...this.adapter.recipe().crop }; this.changed(true); }
  resetCrop() { this.crop = { ...this.fullRecipe().crop }; this.changed(true); }
  applyCrop() {
    if (!this.crop) return;
    const crop = this.crop, base = this.adapter.recipe(); this.crop = null; this.drag = null;
    if (crop.x !== base.crop.x || crop.y !== base.crop.y || crop.width !== base.crop.width || crop.height !== base.crop.height) this.adapter.commit({ ...base, crop });
    this.changed(true);
  }
  cancelCrop() { this.crop = null; this.drag = null; this.changed(true); }
  setRatio() {
    if (!this.crop) return;
    const base = this.adapter.recipe(), ratio = this.adapter.ratio();
    this.crop = constrainCrop(this.crop, base.sourceWidth, base.sourceHeight, ratio ? base.rotation % 2 ? 1 / ratio : ratio : undefined); this.changed(true);
  }
  finish() { this.pointerUp(); this.finishPolyline(); this.finishText(); this.endPropertyChange(); this.endWheel(); this.applyCrop(); }
  clearSelection() { this.selected = null; this.changed(true); }
  removeSelected() { this.finishText(); this.endWheel(); const base = this.adapter.recipe(); if (this.selected) this.adapter.commit({ ...base, operations: base.operations.filter(op => op.id !== this.selected) }); this.clearSelection(); }
  escape(): boolean {
    if (this.finishPolyline() || this.finishText()) return true;
    if (this.crop) { this.cancelCrop(); return true; }
    if (this.drag) { this.cancelGesture(); return true; }
    if (this.selected) { this.clearSelection(); return true; }
    return false;
  }
  /** Discard only an in-flight preview, never committed annotations. */
  prepareHistory() { this.cancelGesture(); this.polyline = null; this.text = null; this.preview = null; this.crop = null; this.propertyEditing = false; clearTimeout(this.wheelTimer); this.wheelTimer = undefined; this.selected = null; this.changed(true); }
  contains(output: Point) { const size = getOutputSize(this.getRenderRecipe()); return inside(output, { x: 0, y: 0, ...size }); }
}
