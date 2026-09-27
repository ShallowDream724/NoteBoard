import { getMagnifierRect, getOperationBounds, getOutputSize, getSourceTransform, validateImageEditRecipe } from './geometry';
import { formatMarkerValue, type ArrowHead, type ImageEditOperation, type ImageEditRecipe, type Point, type StrokeStyle } from './model';
import { releaseCanvas, throwIfImageEditAborted, type ImageResource } from './resources';
import { formatTextCanvasFont, measureTextLayout } from './textMetrics';

export interface RenderImageEditOptions {
  readonly width?: number;
  readonly height?: number;
  readonly background?: string;
}
export type ImageRenderContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function applyStyle(context: ImageRenderContext, style: StrokeStyle): void {
  context.strokeStyle = style.color;
  context.fillStyle = style.color;
  context.lineWidth = Math.max(.1, style.width);
  context.lineCap = 'round'; context.lineJoin = 'round';
  context.globalAlpha = Math.max(0, Math.min(1, style.opacity ?? 1));
  const unit = Math.max(.1, style.width);
  context.setLineDash(style.pattern === 'dash' ? [unit * 4, unit * 3] : style.pattern === 'dashdot' ? [unit * 4, unit * 2, unit, unit * 2] : []);
}

function path(context: ImageRenderContext, points: readonly Point[]): void {
  context.beginPath();
  if (!points.length) return;
  context.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index++) context.lineTo(points[index].x, points[index].y);
}

function arrow(context: ImageRenderContext, tip: Point, previous: Point, head: ArrowHead | undefined, width: number): void {
  if (!head || head === 'none') return;
  const angle = Math.atan2(tip.y - previous.y, tip.x - previous.x), length = Math.max(width * 4, 10);
  context.setLineDash([]);
  context.beginPath();
  context.moveTo(tip.x - length * Math.cos(angle - Math.PI / 6), tip.y - length * Math.sin(angle - Math.PI / 6));
  context.lineTo(tip.x, tip.y);
  context.lineTo(tip.x - length * Math.cos(angle + Math.PI / 6), tip.y - length * Math.sin(angle + Math.PI / 6));
  if (head === 'filled') { context.closePath(); context.fill(); }
  else context.stroke();
}

function drawSource(context: ImageRenderContext, resource: ImageResource): void {
  context.drawImage(resource.image, 0, 0, resource.width, resource.height);
}

function makeScratchCanvas(): HTMLCanvasElement | OffscreenCanvas {
  return typeof document === 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
}

function strokeBrush(context: ImageRenderContext, points: readonly Point[], width: number): void {
  if (!points.length) return;
  context.lineWidth = Math.max(.1, width); context.lineCap = 'round'; context.lineJoin = 'round';
  if (points.length === 1) {
    context.beginPath(); context.arc(points[0].x, points[0].y, Math.max(.1, width / 2), 0, Math.PI * 2); context.fill();
  } else { path(context, points); context.stroke(); }
}

/** Restore source pixels with one coverage blend. Clear-and-redraw doubles antialias coverage and leaves a pale fringe. */
function drawEraser(context: ImageRenderContext, resource: ImageResource, recipe: ImageEditRecipe, operation: Extract<ImageEditOperation, { type: 'eraser' }>): void {
  if (!operation.points.length) return;
  const matrix = context.getTransform(), bounds = getOperationBounds(operation);
  const corners = [{ x: bounds.x, y: bounds.y }, { x: bounds.x + bounds.width, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height }, { x: bounds.x, y: bounds.y + bounds.height }]
    .map(point => ({ x: matrix.a * point.x + matrix.c * point.y + matrix.e, y: matrix.b * point.x + matrix.d * point.y + matrix.f }));
  const x1 = Math.max(0, Math.floor(Math.min(...corners.map(point => point.x)) - 2));
  const y1 = Math.max(0, Math.floor(Math.min(...corners.map(point => point.y)) - 2));
  const x2 = Math.min(context.canvas.width, Math.ceil(Math.max(...corners.map(point => point.x)) + 2));
  const y2 = Math.min(context.canvas.height, Math.ceil(Math.max(...corners.map(point => point.y)) + 2));
  if (x2 <= x1 || y2 <= y1) return;
  const originalCanvas = makeScratchCanvas(), maskCanvas = makeScratchCanvas();
  try {
    for (let top = y1; top < y2; top += 256) for (let left = x1; left < x2; left += 256) {
      const width = Math.min(256, x2 - left), height = Math.min(256, y2 - top);
      originalCanvas.width = maskCanvas.width = width; originalCanvas.height = maskCanvas.height = height;
      const original = originalCanvas.getContext('2d', { willReadFrequently: true }) as ImageRenderContext | null;
      const mask = maskCanvas.getContext('2d', { willReadFrequently: true }) as ImageRenderContext | null;
      if (!original || !mask) throw new Error('无法创建擦除缓冲区');
      original.setTransform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e - left, matrix.f - top);
      drawSource(original, resource);
      mask.setTransform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e - left, matrix.f - top);
      mask.beginPath(); mask.rect(recipe.crop.x, recipe.crop.y, recipe.crop.width, recipe.crop.height); mask.clip();
      mask.fillStyle = '#fff'; mask.strokeStyle = '#fff';
      strokeBrush(mask, operation.points, operation.width);
      const before = context.getImageData(left, top, width, height);
      const source = original.getImageData(0, 0, width, height).data;
      const coverage = mask.getImageData(0, 0, width, height).data;
      const target = before.data;
      for (let index = 0; index < target.length; index += 4) {
        const blend = coverage[index + 3] / 255;
        if (!blend) continue;
        const oldAlpha = target[index + 3] / 255, sourceAlpha = source[index + 3] / 255;
        const oldWeight = oldAlpha * (1 - blend), sourceWeight = sourceAlpha * blend, alpha = oldWeight + sourceWeight;
        for (let channel = 0; channel < 3; channel++) target[index + channel] = alpha ? Math.round((target[index + channel] * oldWeight + source[index + channel] * sourceWeight) / alpha) : 0;
        target[index + 3] = Math.round(alpha * 255);
      }
      context.putImageData(before, left, top);
    }
  } finally { releaseCanvas(originalCanvas); releaseCanvas(maskCanvas); }
}

function drawMosaic(context: ImageRenderContext, resource: ImageResource, rect: { x: number; y: number; width: number; height: number }, blockSize: number): void {
  const block = Math.max(1, blockSize);
  if (rect.width <= 0 || rect.height <= 0) return;
  const columns = Math.ceil(rect.width / block), rows = Math.ceil(rect.height / block);
  const canvas = makeScratchCanvas();
  try {
    // Tile the sample grid: one effect needs at most 256 KiB of scratch pixels.
    for (let row = 0; row < rows; row += 256) for (let column = 0; column < columns; column += 256) {
      const cols = Math.min(256, columns - column), count = Math.min(256, rows - row);
      canvas.width = cols; canvas.height = count;
      const sample = canvas.getContext('2d') as ImageRenderContext | null;
      if (!sample) throw new Error('无法创建马赛克采样画布');
      const x = rect.x + column * block, y = rect.y + row * block;
      const width = Math.min(cols * block, rect.width - column * block), height = Math.min(count * block, rect.height - row * block);
      sample.drawImage(resource.image, x * resource.pixelWidth / resource.width, y * resource.pixelHeight / resource.height, width * resource.pixelWidth / resource.width, height * resource.pixelHeight / resource.height, 0, 0, cols, count);
      context.imageSmoothingEnabled = false;
      context.clearRect(x, y, width, height);
      context.drawImage(canvas, x, y, width, height);
    }
  } finally { releaseCanvas(canvas); }
}

function drawOperation(context: ImageRenderContext, resource: ImageResource, recipe: ImageEditRecipe, operation: ImageEditOperation): void {
  context.save();
  try {
    if ('style' in operation) applyStyle(context, operation.style);
    if ('points' in operation && operation.type !== 'eraser' && operation.type !== 'mosaic-brush') {
      if (!operation.points.length) return;
      if (operation.type === 'highlighter') context.globalAlpha *= .3;
      path(context, operation.points);
      if (operation.points.length === 1) {
        context.arc(operation.points[0].x, operation.points[0].y, context.lineWidth / 2, 0, Math.PI * 2); context.fill();
      } else {
        context.stroke();
        const points = operation.points;
        arrow(context, points[0], points[1], operation.startHead, operation.style.width);
        arrow(context, points[points.length - 1], points[points.length - 2], operation.endHead, operation.style.width);
      }
      return;
    }
    switch (operation.type) {
      case 'rectangle':
      case 'ellipse': {
        const { rect } = operation;
        context.beginPath();
        if (operation.type === 'ellipse') context.ellipse(rect.x + rect.width / 2, rect.y + rect.height / 2, Math.max(0, rect.width / 2), Math.max(0, rect.height / 2), 0, 0, Math.PI * 2);
        else context.rect(rect.x, rect.y, rect.width, rect.height);
        if (operation.fill) { context.fillStyle = operation.fill; context.fill(); }
        context.stroke();
        break;
      }
      case 'text': {
        context.fillStyle = operation.color;
        context.font = formatTextCanvasFont(operation);
        context.textBaseline = 'alphabetic'; context.textAlign = 'left';
        const { lineHeight, baseline } = measureTextLayout(operation);
        operation.text.split('\n').forEach((line, index) => context.fillText(line, operation.position.x, operation.position.y + baseline + index * lineHeight));
        break;
      }
      case 'marker': {
        const { center, size, shape, appearance } = operation, radius = size / 2;
        const outline = (inset: number) => {
          context.beginPath();
          if (shape === 'circle') context.arc(center.x, center.y, Math.max(.1, radius - inset), 0, Math.PI * 2);
          else context.rect(center.x - radius + inset, center.y - radius + inset, size - inset * 2, size - inset * 2);
        };
        context.setLineDash([]); outline(0);
        if (appearance === 'filled') context.fill(); else context.stroke();
        if (appearance === 'ring') { outline(Math.min(radius * .22, operation.style.width * 2 + 2)); context.stroke(); }
        context.fillStyle = appearance === 'filled' ? '#ffffff' : operation.style.color;
        context.textAlign = 'center'; context.textBaseline = 'middle';
        const label = formatMarkerValue(operation.value, operation.format);
        context.font = `bold ${size * .52}px sans-serif`;
        context.fillText(label, center.x, center.y + size * .02, size * .75);
        break;
      }
      case 'mosaic': drawMosaic(context, resource, operation.rect, operation.blockSize); break;
      case 'mosaic-brush': {
        if (!operation.points.length) break;
        context.beginPath();
        if (operation.points.length === 1) context.arc(operation.points[0].x, operation.points[0].y, Math.max(.1, operation.width / 2), 0, Math.PI * 2);
        else {
          const radius = Math.max(.1, operation.width / 2);
          for (const point of operation.points) { context.moveTo(point.x + radius, point.y); context.arc(point.x, point.y, radius, 0, Math.PI * 2); }
          for (let index = 1; index < operation.points.length; index++) {
            const a = operation.points[index - 1], b = operation.points[index], dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
            if (!length) continue;
            const nx = -dy / length * radius, ny = dx / length * radius;
            context.moveTo(a.x + nx, a.y + ny); context.lineTo(a.x - nx, a.y - ny);
            context.lineTo(b.x - nx, b.y - ny); context.lineTo(b.x + nx, b.y + ny); context.closePath();
          }
        }
        context.clip(); drawMosaic(context, resource, getOperationBounds(operation), operation.blockSize);
        break;
      }
      case 'spotlight': {
        const { rect } = operation;
        context.fillStyle = '#000'; context.globalAlpha = Math.max(0, Math.min(1, operation.opacity));
        context.beginPath(); context.rect(recipe.crop.x, recipe.crop.y, recipe.crop.width, recipe.crop.height);
        if (operation.shape === 'ellipse') { context.moveTo(rect.x + rect.width, rect.y + rect.height / 2); context.ellipse(rect.x + rect.width / 2, rect.y + rect.height / 2, Math.max(0, rect.width / 2), Math.max(0, rect.height / 2), 0, 0, Math.PI * 2); }
        else context.rect(rect.x, rect.y, rect.width, rect.height);
        context.fill('evenodd');
        break;
      }
      case 'magnifier': {
        const rect = getMagnifierRect(operation), center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        const source = operation.source ?? center, zoom = Math.max(1, operation.zoom);
        context.beginPath();
        if (operation.shape === 'rectangle') context.rect(rect.x, rect.y, rect.width, rect.height);
        else context.ellipse(center.x, center.y, Math.max(.1, rect.width / 2), Math.max(.1, rect.height / 2), 0, 0, Math.PI * 2);
        context.save();
        try {
          context.clip(); context.clearRect(rect.x, rect.y, rect.width, rect.height);
          context.drawImage(resource.image, (source.x - rect.width / (2 * zoom)) * resource.pixelWidth / resource.width, (source.y - rect.height / (2 * zoom)) * resource.pixelHeight / resource.height, rect.width / zoom * resource.pixelWidth / resource.width, rect.height / zoom * resource.pixelHeight / resource.height, rect.x, rect.y, rect.width, rect.height);
        } finally { context.restore(); }
        context.stroke();
        break;
      }
      case 'eraser': {
        drawEraser(context, resource, recipe, operation);
        break;
      }
    }
  } finally { context.restore(); }
}

/** Renders into an existing canvas. Never retains the target or changes its dimensions. */
export function renderImageEdit(context: ImageRenderContext, resource: ImageResource, recipe: ImageEditRecipe, options: RenderImageEditOptions = {}): void {
  validateImageEditRecipe(recipe);
  if (resource.width !== recipe.sourceWidth || resource.height !== recipe.sourceHeight) throw new Error('原图尺寸已变化，请重新打开编辑器');
  const size = getOutputSize(recipe), width = options.width ?? context.canvas.width, height = options.height ?? context.canvas.height;
  if (!(width > 0 && height > 0)) return;
  context.save();
  try {
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalAlpha = 1; context.globalCompositeOperation = 'source-over';
    context.clearRect(0, 0, width, height);
    context.scale(width / size.width, height / size.height);
    context.transform(...getSourceTransform(recipe));
    context.beginPath(); context.rect(recipe.crop.x, recipe.crop.y, recipe.crop.width, recipe.crop.height); context.clip();
    drawSource(context, resource);
    for (const operation of recipe.operations) drawOperation(context, resource, recipe, operation);
    if (options.background) {
      context.setTransform(1, 0, 0, 1, 0, 0); context.globalCompositeOperation = 'destination-over';
      context.fillStyle = options.background; context.fillRect(0, 0, width, height);
    }
  } finally { context.restore(); }
}

/** Main-thread fallback yields between batches so cancellation and painting can run. */
export async function renderImageEditAsync(context: ImageRenderContext, resource: ImageResource, recipe: ImageEditRecipe, options: RenderImageEditOptions = {}, signal?: AbortSignal): Promise<void> {
  throwIfImageEditAborted(signal);
  renderImageEdit(context, resource, { ...recipe, operations: [] }, { ...options, background: undefined });
  const size = getOutputSize(recipe), width = options.width ?? context.canvas.width, height = options.height ?? context.canvas.height;
  const yieldToBrowser = async () => { await new Promise<void>(resolve => setTimeout(resolve, 0)); throwIfImageEditAborted(signal); };
  await yieldToBrowser();
  context.save();
  try {
    context.setTransform(1, 0, 0, 1, 0, 0); context.globalAlpha = 1; context.globalCompositeOperation = 'source-over';
    context.scale(width / size.width, height / size.height); context.transform(...getSourceTransform(recipe));
    context.beginPath(); context.rect(recipe.crop.x, recipe.crop.y, recipe.crop.width, recipe.crop.height); context.clip();
    let batch = 0;
    for (const operation of recipe.operations) {
      throwIfImageEditAborted(signal);
      if (operation.type === 'mosaic') {
        const { rect } = operation, tileSize = Math.max(1, operation.blockSize) * 256;
        for (let y = 0; y < rect.height; y += tileSize) for (let x = 0; x < rect.width; x += tileSize) {
          drawOperation(context, resource, recipe, { ...operation, rect: { x: rect.x + x, y: rect.y + y, width: Math.min(tileSize, rect.width - x), height: Math.min(tileSize, rect.height - y) } });
          if (++batch % 8 === 0) await yieldToBrowser();
        }
      } else drawOperation(context, resource, recipe, operation);
      if (++batch % 8 === 0) await yieldToBrowser();
    }
    if (options.background) {
      context.setTransform(1, 0, 0, 1, 0, 0); context.globalCompositeOperation = 'destination-over';
      context.fillStyle = options.background; context.fillRect(0, 0, width, height);
    }
  } finally { context.restore(); }
}
