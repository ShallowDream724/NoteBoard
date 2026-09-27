// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageCanvasInteraction } from '../../src/features/image-editor/canvasInteraction';
import { getOperationOutputBounds, outputToSource, type ResizeHandle } from '../../src/features/image-editor/geometry';
import { commitImageEdit, createImageEditHistory, createImageEditRecipe, undoImageEdit, type ImageEditHistory, type ImageEditOperation, type ImageEditorTool } from '../../src/features/image-editor/model';
import { DEFAULT_TOOL_STYLE, type ToolStyle } from '../../src/features/image-editor/toolDefaults';

function harness(recipe = createImageEditRecipe(160, 120)) {
  let history = createImageEditHistory(recipe);
  let tool: ImageEditorTool = 'select';
  let style: ToolStyle = { ...DEFAULT_TOOL_STYLE };
  let ratio = 0;
  const controlsChanged = vi.fn();
  const interaction = new ImageCanvasInteraction({
    recipe: () => history.present.recipe,
    tool: () => tool,
    style: () => style,
    nextMarker: () => history.present.nextMarker,
    ratio: () => ratio,
    circleMagnifier: () => false,
    commit: (next, marker) => { history = commitImageEdit(history, next, marker); },
    controlsChanged,
  });
  return {
    interaction,
    get history(): ImageEditHistory { return history; },
    setTool(value: ImageEditorTool) { tool = value; },
    setStyle(patch: Partial<ToolStyle>) { style = { ...style, ...patch }; },
    setRatio(value: number) { ratio = value; interaction.setRatio(); },
    down(x: number, y: number, handle?: ResizeHandle) { interaction.pointerDown({ x, y }, { tolerance: 2, handle }); },
    move(x: number, y: number) { interaction.pointerMove({ x, y }, 2); },
    up() { interaction.pointerUp(); },
    dispose() { interaction.dispose(); },
  };
}

const stroke = { color: '#ee0000', width: 2, pattern: 'solid' as const };

describe('image canvas interactions', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { queueMicrotask(() => callback(0)); return 1; });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it.each(['right-click', 'escape', 'outside'] as const)('finishes a polyline on %s with only confirmed vertices', finish => {
    const board = harness();
    try {
      board.setTool('polyline');
      board.down(10, 10); board.move(25, 10); board.down(25, 10); board.move(50, 30);
      expect(board.history.present.recipe.operations).toHaveLength(0);
      if (finish === 'escape') expect(board.interaction.escape()).toBe(true);
      else if (finish === 'outside') board.interaction.outside();
      else expect(board.interaction.finishPolyline()).toBe(true);
      expect(board.history.past).toHaveLength(1);
      expect(board.history.present.recipe.operations).toMatchObject([{ type: 'polyline', points: [{ x: 10, y: 10 }, { x: 25, y: 10 }] }]);
      expect(board.interaction.selected).toBe(board.history.present.recipe.operations[0].id);
    } finally { board.dispose(); }
  });

  it('discards a one-point polyline even if its hover end moved', () => {
    const board = harness();
    try { board.setTool('polyline'); board.down(10, 10); board.move(30, 30); board.interaction.outside(); expect(board.history.past).toHaveLength(0); expect(board.history.present.recipe.operations).toHaveLength(0); }
    finally { board.dispose(); }
  });

  it('selects a new marker immediately and moves it without a separate select click', () => {
    const board = harness();
    try {
      board.setTool('marker'); board.down(40, 40);
      const created = board.history.present.recipe.operations[0];
      expect(created.type).toBe('marker'); expect(board.interaction.selected).toBe(created.id);
      expect(board.history.present.nextMarker).toBe(2);
      board.setTool('select'); board.down(40, 40); board.move(57, 68); board.up();
      expect(board.history.past).toHaveLength(2);
      expect(board.history.present.recipe.operations[0]).toMatchObject({ type: 'marker', center: { x: 57, y: 68 } });
      expect(undoImageEdit(board.history).present.recipe.operations[0]).toMatchObject({ center: { x: 40, y: 40 } });
    } finally { board.dispose(); }
  });

  it('groups repeated wheel scaling into one undo entry', () => {
    vi.useFakeTimers();
    const board = harness();
    try {
      board.setTool('marker'); board.down(50, 50);
      const original = board.history.present.recipe.operations[0];
      expect(board.interaction.scaleSelected(1.1)).toBe(true);
      expect(board.interaction.scaleSelected(1.1)).toBe(true);
      expect(board.interaction.scaleSelected(.95)).toBe(true);
      expect(board.history.past).toHaveLength(1);
      vi.advanceTimersByTime(179); expect(board.history.past).toHaveLength(1);
      vi.advanceTimersByTime(1); expect(board.history.past).toHaveLength(2);
      expect(board.history.present.recipe.operations[0]).not.toEqual(original);
      expect(undoImageEdit(board.history).present.recipe.operations[0]).toEqual(original);
    } finally { board.dispose(); }
  });

  it('exposes and applies all eight resize handles while keeping marker and text proportions', () => {
    const rect: ImageEditOperation = { id: 'rect', type: 'rectangle', rect: { x: 20, y: 20, width: 40, height: 30 }, style: stroke, fill: '#fff' };
    for (const handle of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const) {
      const board = harness({ ...createImageEditRecipe(160, 120), operations: [rect] });
      try {
        board.interaction.selected = rect.id;
        const handles = board.interaction.getHandles();
        expect(handles.map(item => item.handle)).toEqual(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']);
        const point = handles.find(item => item.handle === handle)!;
        board.down(point.x, point.y, handle);
        board.move(point.x + (handle.includes('w') ? -8 : handle.includes('e') ? 8 : 0), point.y + (handle.includes('n') ? -6 : handle.includes('s') ? 6 : 0));
        board.up();
        expect(board.history.past).toHaveLength(1);
        expect(getOperationOutputBounds(board.history.present.recipe.operations[0], board.history.present.recipe).width).toBeGreaterThan(0);
      } finally { board.dispose(); }
    }
    const marker: ImageEditOperation = { id: 'marker', type: 'marker', center: { x: 70, y: 50 }, size: 20, value: 1, format: 'decimal', shape: 'circle', appearance: 'filled', style: stroke };
    const markerBoard = harness({ ...createImageEditRecipe(160, 120), operations: [marker] });
    try {
      markerBoard.interaction.selected = marker.id;
      const east = markerBoard.interaction.getHandles().find(item => item.handle === 'e')!;
      markerBoard.down(east.x, east.y, 'e'); markerBoard.move(east.x + 10, east.y); markerBoard.up();
      const resized = markerBoard.history.present.recipe.operations[0];
      const bounds = getOperationOutputBounds(resized, markerBoard.history.present.recipe);
      expect(bounds.width).toBeCloseTo(bounds.height);
      expect(resized).toMatchObject({ type: 'marker', size: 30 });
    } finally { markerBoard.dispose(); }
    const text: ImageEditOperation = { id: 'text', type: 'text', position: { x: 15, y: 15 }, text: 'Hello', color: '#ee0000', fontSize: 20 };
    const textBoard = harness({ ...createImageEditRecipe(160, 120), operations: [text] });
    try {
      textBoard.interaction.selected = text.id;
      const southeast = textBoard.interaction.getHandles().find(item => item.handle === 'se')!;
      textBoard.down(southeast.x, southeast.y, 'se'); textBoard.move(southeast.x + 20, southeast.y + 15); textBoard.up();
      const resized = textBoard.history.present.recipe.operations[0];
      expect(resized.type).toBe('text');
      if (resized.type === 'text') expect(resized.fontSize).toBeGreaterThan(text.fontSize);
    } finally { textBoard.dispose(); }
  });

  it('allows rectangles to change aspect ratio independently', () => {
    const rectangle: ImageEditOperation = { id: 'r', type: 'rectangle', rect: { x: 20, y: 20, width: 40, height: 30 }, style: stroke };
    const board = harness({ ...createImageEditRecipe(160, 120), operations: [rectangle] });
    try {
      board.interaction.selected = rectangle.id;
      const before = getOperationOutputBounds(rectangle, board.history.present.recipe);
      const east = board.interaction.getHandles().find(item => item.handle === 'e')!;
      board.down(east.x, east.y, 'e'); board.move(east.x + 20, east.y); board.up();
      const after = getOperationOutputBounds(board.history.present.recipe.operations[0], board.history.present.recipe);
      expect(after.width).toBe(before.width + 20);
      expect(after.height).toBe(before.height);
    } finally { board.dispose(); }
  });

  it('commits text from an empty draft, edits in place, moves it and can undo the move', () => {
    const board = harness();
    try {
      board.setTool('text'); board.down(20, 20);
      expect(board.interaction.text?.operation.text).toBe('');
      expect(board.history.present.recipe.operations).toHaveLength(0);
      board.interaction.updateText('First'); board.interaction.outside();
      expect(board.history.past).toHaveLength(1);
      const created = board.history.present.recipe.operations[0];
      expect(created).toMatchObject({ type: 'text', text: 'First', position: { x: 20, y: 20 } });
      board.setTool('select'); board.down(21, 21); board.up();
      expect(board.interaction.text?.operation.id).toBe(created.id);
      board.interaction.updateText('Second'); board.interaction.outside();
      expect(board.history.past).toHaveLength(2);
      board.down(21, 21); board.move(31, 36); board.up();
      expect(board.history.past).toHaveLength(3);
      expect(board.history.present.recipe.operations[0]).toMatchObject({ text: 'Second', position: { x: 30, y: 35 } });
      expect(undoImageEdit(board.history).present.recipe.operations[0]).toMatchObject({ text: 'Second', position: { x: 20, y: 20 } });
    } finally { board.dispose(); }
  });

  it('shows the full source while cropping and commits only on apply', () => {
    const original = { ...createImageEditRecipe(160, 120), crop: { x: 20, y: 10, width: 60, height: 40 } };
    const board = harness(original);
    try {
      board.interaction.beginCrop();
      expect(board.interaction.getRenderRecipe().crop).toEqual({ x: 0, y: 0, width: 160, height: 120 });
      expect(board.interaction.getCropBounds()).toEqual(original.crop);
      const east = board.interaction.getHandles().find(item => item.handle === 'e')!;
      board.down(east.x, east.y, 'e'); board.move(east.x + 10, east.y); board.up();
      expect(board.interaction.crop).toEqual({ x: 20, y: 10, width: 70, height: 40 });
      expect(board.history.past).toHaveLength(0);
      board.interaction.applyCrop();
      expect(board.history.past).toHaveLength(1);
      expect(board.history.present.recipe.crop).toEqual({ x: 20, y: 10, width: 70, height: 40 });
    } finally { board.dispose(); }
    const cancelled = harness(original);
    try {
      cancelled.interaction.beginCrop();
      const east = cancelled.interaction.getHandles().find(item => item.handle === 'e')!;
      cancelled.down(east.x, east.y, 'e'); cancelled.move(east.x + 10, east.y); cancelled.up();
      cancelled.interaction.cancelCrop();
      expect(cancelled.history.present.recipe.crop).toEqual(original.crop);
      expect(cancelled.history.past).toHaveLength(0);
    } finally { cancelled.dispose(); }
  });

  it('restores a crop drag interrupted by pointer cancellation before apply', () => {
    const board = harness();
    try {
      const original = board.history.present.recipe.crop;
      board.interaction.beginCrop();
      const corner = board.interaction.getHandles().find(item => item.handle === 'se')!;
      board.down(corner.x, corner.y, 'se'); board.move(corner.x - 25, corner.y - 20);
      expect(board.interaction.crop).not.toEqual(original);
      board.interaction.cancelGesture(); board.interaction.applyCrop();
      expect(board.history.present.recipe.crop).toEqual(original);
      expect(board.history.past).toHaveLength(0);
    } finally { board.dispose(); }
  });

  it('keeps brush mosaic strokes fixed while rectangle mosaic can move', () => {
    const board = harness();
    try {
      board.setTool('mosaic-brush'); board.setStyle({ width: 12, blockSize: 6 });
      board.down(10, 20); board.move(28, 20); board.up();
      expect(board.history.present.recipe.operations[0]).toMatchObject({ type: 'mosaic-brush', width: 12, blockSize: 6 });
      board.setTool('select'); board.down(20, 20); board.move(30, 30); board.up();
      expect(board.interaction.selected).toBeNull();
      expect(board.history.past).toHaveLength(1);
      board.setTool('mosaic'); board.down(50, 30); board.move(80, 50); board.up();
      const rectangle = board.history.present.recipe.operations[1];
      expect(rectangle).toMatchObject({ type: 'mosaic', rect: { x: 50, y: 30, width: 30, height: 20 } });
      expect(board.interaction.selected).toBe(rectangle.id);
      board.setTool('select'); board.down(60, 40); board.move(70, 45); board.up();
      expect(board.history.present.recipe.operations[0]).toMatchObject({ type: 'mosaic-brush', points: [{ x: 10, y: 20 }, { x: 28, y: 20 }] });
      expect(board.history.present.recipe.operations[1]).toMatchObject({ type: 'mosaic', rect: { x: 60, y: 35, width: 30, height: 20 } });
    } finally { board.dispose(); }
  });

  it('maps drawing and movement through crop, rotation and both output mirrors', () => {
    const original = { ...createImageEditRecipe(200, 160), crop: { x: 20, y: 10, width: 100, height: 80 }, rotation: 1 as const, flipX: true, flipY: true };
    const board = harness(original);
    try {
      board.setTool('marker'); board.down(25, 35);
      const first = outputToSource({ x: 25, y: 35 }, original);
      expect(board.history.present.recipe.operations[0]).toMatchObject({ center: first });
      board.setTool('select'); board.down(25, 35); board.move(35, 45); board.up();
      const second = outputToSource({ x: 35, y: 45 }, original);
      expect(board.history.present.recipe.operations[0]).toMatchObject({ center: second });
    } finally { board.dispose(); }
  });
});
