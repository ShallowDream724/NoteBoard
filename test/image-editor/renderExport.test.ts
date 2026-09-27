// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { assertImageExportCapacity, exportImageEdit, getImageExportSize, LargeImageExportConfirmationError } from '../../src/features/image-editor/exporter';
import { createImageEditRecipe, type ImageEditOperation } from '../../src/features/image-editor/model';
import { renderImageEdit } from '../../src/features/image-editor/renderer';
import { measureTextLayout } from '../../src/features/image-editor/textMetrics';
import type { ImageResource } from '../../src/features/image-editor/resources';

function mockContext(canvas = document.createElement('canvas')) {
  let depth = 0;
  const context = {
    canvas, save: vi.fn(() => { depth++; }), restore: vi.fn(() => { depth--; }),
    setTransform: vi.fn(), scale: vi.fn(), transform: vi.fn(), clearRect: vi.fn(), drawImage: vi.fn(),
    beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(), stroke: vi.fn(), fill: vi.fn(), fillRect: vi.fn(),
    moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(), arc: vi.fn(), ellipse: vi.fn(), setLineDash: vi.fn(), fillText: vi.fn(),
    globalAlpha: 1, globalCompositeOperation: 'source-over', lineWidth: 1,
  };
  return { context: context as unknown as CanvasRenderingContext2D, methods: context, depth: () => depth };
}

function resource(width: number, height: number, pixelWidth = width, pixelHeight = height): ImageResource {
  return { image: document.createElement('img'), width, height, pixelWidth, pixelHeight, disposed: false, dispose: vi.fn(), getOriginal: vi.fn(), getBlob: vi.fn(() => new Blob(['original'])) };
}

const style = { color: '#fa0000', width: 4, pattern: 'dashdot' as const };
const operations: ImageEditOperation[] = [
  { id: 'pen', type: 'pen', points: [{ x: 10, y: 10 }, { x: 20, y: 20 }], style },
  { id: 'highlighter', type: 'highlighter', points: [{ x: 10, y: 30 }], style },
  { id: 'polyline', type: 'polyline', points: [{ x: 10, y: 10 }, { x: 20, y: 20 }, { x: 50, y: 10 }], style, startHead: 'open', endHead: 'filled' },
  { id: 'rectangle', type: 'rectangle', rect: { x: 10, y: 10, width: 20, height: 10 }, style, fill: '#ffffff' },
  { id: 'ellipse', type: 'ellipse', rect: { x: 10, y: 10, width: 20, height: 10 }, style },
  { id: 'text', type: 'text', position: { x: 4, y: 4 }, text: 'Hello\nWorld', color: '#000000', fontSize: 14, bold: true, italic: true },
  { id: 'marker', type: 'marker', center: { x: 30, y: 30 }, size: 20, value: 4, format: 'roman', shape: 'square', appearance: 'ring', style },
  { id: 'spotlight', type: 'spotlight', rect: { x: 10, y: 10, width: 20, height: 20 }, shape: 'ellipse', opacity: .5 },
  { id: 'magnifier', type: 'magnifier', center: { x: 30, y: 30 }, radius: 10, zoom: 2, style },
];

describe('image renderer', () => {
  afterEach(() => vi.restoreAllMocks());

  it('renders vector/effect families and balances all context scopes', () => {
    const { context, methods, depth } = mockContext();
    renderImageEdit(context, resource(100, 80), { ...createImageEditRecipe(100, 80), operations }, { width: 200, height: 160 });
    expect(depth()).toBe(0);
    expect(methods.scale).toHaveBeenCalledWith(2, 2);
    expect(methods.fill).toHaveBeenCalledWith('evenodd');
    expect(methods.fillText).toHaveBeenCalledWith('IV', 30, 30.4, 15);
    expect(methods.drawImage).toHaveBeenCalledTimes(2); // Base and magnifier.
    expect(methods.setLineDash).toHaveBeenCalledWith([16, 8, 4, 8]);
  });

  it('restores nested render state even when a magnifier draw fails', () => {
    const { context, methods, depth } = mockContext();
    methods.drawImage.mockImplementationOnce(() => {}).mockImplementationOnce(() => { throw new Error('decode unavailable'); });
    expect(() => renderImageEdit(context, resource(100, 80), { ...createImageEditRecipe(100, 80), operations: [operations[8]] })).toThrow('decode unavailable');
    expect(depth()).toBe(0);
  });

  it('renders multiline text using the same font and line height as geometry', () => {
    const { context, methods } = mockContext();
    const operation = { id: 'text', type: 'text', position: { x: 7, y: 9 }, text: '图上\n😀', color: '#000', fontSize: 20, bold: true, italic: true, fontFamily: 'Noto Sans CJK SC' } as const;
    renderImageEdit(context, resource(100, 80), { ...createImageEditRecipe(100, 80), operations: [operation] });
    const { baseline, lineHeight } = measureTextLayout(operation);
    expect(context.font).toBe('italic bold 20px Noto Sans CJK SC');
    expect(context.textBaseline).toBe('alphabetic');
    expect(methods.fillText).toHaveBeenCalledWith('图上', 7, 9 + baseline);
    expect(methods.fillText).toHaveBeenCalledWith('😀', 7, 9 + baseline + lineHeight);
  });

  it('bounds and releases mosaic scratch canvases on success and failure', () => {
    const scratches: HTMLCanvasElement[] = [], scratchSizes: number[][] = [];
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
      scratches.push(this); scratchSizes.push([this.width, this.height]);
      return mockContext(this).context;
    });
    const { context, methods, depth } = mockContext();
    const recipe = { ...createImageEditRecipe(4096, 2048), operations: [{ id: 'm', type: 'mosaic' as const, rect: { x: 0, y: 0, width: 4096, height: 2048 }, blockSize: 4 }] };
    renderImageEdit(context, resource(4096, 2048, 2048, 1024), recipe);
    expect(scratchSizes).toHaveLength(8);
    expect(scratchSizes.every(([width, height]) => width <= 256 && height <= 256)).toBe(true);
    expect(scratches.every(canvas => canvas.width === 0 && canvas.height === 0)).toBe(true);
    methods.drawImage.mockImplementationOnce(() => {}).mockImplementationOnce(() => { throw new Error('canvas failure'); });
    expect(() => renderImageEdit(context, resource(4096, 2048), recipe)).toThrow('canvas failure');
    expect(depth()).toBe(0);
    expect(scratches.every(canvas => canvas.width === 0 && canvas.height === 0)).toBe(true);
  });
});

describe('original-resolution image export', () => {
  let canvases: HTMLCanvasElement[], contexts: ReturnType<typeof mockContext>[];
  let encode: MockInstance<HTMLCanvasElement['toBlob']>;
  beforeEach(() => {
    canvases = []; contexts = [];
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
      canvases.push(this); const context = mockContext(this); contexts.push(context); return context.context;
    });
    encode = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback, mime) => callback(new Blob(['encoded'], { type: mime })));
  });
  afterEach(() => vi.restoreAllMocks());

  it('decodes original pixels, preserves rotated output size, and releases only owned resources', async () => {
    const preview = resource(8000, 4000, 2048, 1024), original = resource(8000, 4000);
    vi.mocked(preview.getOriginal).mockResolvedValue(original);
    const sizes: number[][] = [];
    encode.mockImplementation((callback: BlobCallback, mime?: string) => { sizes.push([canvases[0].width, canvases[0].height]); callback(new Blob(['png'], { type: mime })); });
    const recipe = { ...createImageEditRecipe(8000, 4000), rotation: 1 as const };
    const result = await exportImageEdit(preview, recipe);
    expect(result.type).toBe('image/png');
    expect(sizes).toEqual([[4000, 8000]]);
    expect(contexts[0].methods.drawImage).toHaveBeenCalledWith(original.image, 0, 0, 8000, 4000);
    expect(original.dispose).toHaveBeenCalledOnce();
    expect(preview.dispose).not.toHaveBeenCalled();
    expect(canvases[0].width).toBe(0);
  });

  it('only resizes when explicitly chosen and forwards lossy quality', async () => {
    const recipe = createImageEditRecipe(1200, 800);
    expect(getImageExportSize(recipe, { width: 600 })).toEqual({ width: 600, height: 400 });
    await exportImageEdit(resource(1200, 800), recipe, { mimeType: 'image/jpeg', quality: .8, width: 600 });
    expect(encode).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', .8);
    expect(contexts[0].methods.fillRect).toHaveBeenCalledWith(0, 0, 600, 400);
  });

  it('requires explicit acknowledgement for large memory but allows 16K PNG after confirmation', async () => {
    const huge = resource(20000, 15000, 2048, 1536), recipe = createImageEditRecipe(20000, 15000);
    await expect(exportImageEdit(huge, recipe)).rejects.toThrow('超过浏览器画布容量');
    await expect(exportImageEdit(huge, recipe, { width: 200 })).rejects.toBeInstanceOf(LargeImageExportConfirmationError);
    expect(huge.getOriginal).not.toHaveBeenCalled();
    expect(canvases).toHaveLength(0);
    expect(() => assertImageExportCapacity(createImageEditRecipe(16384, 16384), 16384, 16384, 0, true)).not.toThrow();
    expect(() => assertImageExportCapacity(createImageEditRecipe(16384, 16384), 16384, 16384, 0, true, 'image/webp')).toThrow('WebP');
  });

  it.each(['null', 'wrong-format', 'throw'] as const)('releases output pixels when encoding returns %s', async failure => {
    encode.mockImplementation((callback: BlobCallback) => {
      if (failure === 'throw') throw new Error('tainted');
      callback(failure === 'null' ? null : new Blob(['fallback'], { type: 'image/png' }));
    });
    await expect(exportImageEdit(resource(100, 80), createImageEditRecipe(100, 80), { mimeType: 'image/webp' })).rejects.toThrow();
    expect(canvases.every(canvas => canvas.width === 0 && canvas.height === 0)).toBe(true);
  });

  it('cancels an in-flight encoder, releases pixels, and ignores its late result', async () => {
    let callback!: BlobCallback;
    encode.mockImplementation((next: BlobCallback) => { callback = next; });
    const controller = new AbortController();
    const pending = exportImageEdit(resource(100, 80), createImageEditRecipe(100, 80), { signal: controller.signal });
    await vi.waitFor(() => expect(callback).toBeTypeOf('function'));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(canvases[0].width).toBe(0);
    callback(new Blob(['late'], { type: 'image/png' }));
  });

  it('exports compressed source in a worker without decoding full pixels on the UI thread', async () => {
    const workers: { onmessage: ((event: MessageEvent) => void) | null; postMessage: ReturnType<typeof vi.fn>; terminate: ReturnType<typeof vi.fn> }[] = [];
    vi.stubGlobal('OffscreenCanvas', class {});
    vi.stubGlobal('Worker', class {
      onmessage: ((event: MessageEvent) => void) | null = null;
      postMessage = vi.fn(() => { queueMicrotask(() => this.onmessage?.({ data: { blob: new Blob(['png'], { type: 'image/png' }) } } as MessageEvent)); });
      terminate = vi.fn();
      constructor() { workers.push(this); }
    });
    try {
      const preview = resource(8192, 4096, 2048, 1024);
      const result = await exportImageEdit(preview, createImageEditRecipe(8192, 4096));
      const worker = workers[0];
      expect(result.type).toBe('image/png');
      expect(preview.getOriginal).not.toHaveBeenCalled();
      expect(preview.getBlob).toHaveBeenCalledOnce();
      expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ width: 8192, height: 4096, mimeType: 'image/png' }));
      expect(worker.terminate).toHaveBeenCalledOnce();
      expect(canvases).toHaveLength(0);
    } finally { vi.unstubAllGlobals(); }
  });

  it('terminates the export worker immediately on cancellation', async () => {
    const terminate = vi.fn();
    vi.stubGlobal('OffscreenCanvas', class {});
    vi.stubGlobal('Worker', class { postMessage = vi.fn(); terminate = terminate; });
    try {
      const controller = new AbortController();
      const pending = exportImageEdit(resource(100, 80), createImageEditRecipe(100, 80), { signal: controller.signal });
      controller.abort();
      await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
      expect(terminate).toHaveBeenCalledOnce();
    } finally { vi.unstubAllGlobals(); }
  });
});
