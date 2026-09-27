import { getOutputSize, getSourceTransform, validateImageEditRecipe } from './geometry';
import { formatMarkerValue, type ArrowHead, type ImageEditOperation, type ImageEditRecipe, type Point, type StrokeStyle } from './model';
import { releaseCanvas, throwIfImageEditAborted, type ImageResource } from './resources';

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

/** A union of circles and segment polygons provides a round stroked clipping area. */
function eraserClip(context: ImageRenderContext, points: readonly Point[], width: number): void {
  const radius = Math.max(.1, width / 2);
  context.beginPath();
  for (let index = 0; index < points.length; index++) {
    const p = points[index];
    context.moveTo(p.x + radius, p.y); context.arc(p.x, p.y, radius, 0, Math.PI * 2);
    if (index === 0) continue;
    const previous = points[index - 1], dx = p.x - previous.x, dy = p.y - previous.y, length = Math.hypot(dx, dy);
    if (!length) continue;
    const nx = -dy / length * radius, ny = dx / length * radius;
    context.moveTo(previous.x + nx, previous.y + ny);
    context.lineTo(previous.x - nx, previous.y - ny);
    context.lineTo(p.x - nx, p.y - ny);
    context.lineTo(p.x + nx, p.y + ny);
    context.closePath();
  }
  context.clip();
}

function drawMosaic(context: ImageRenderContext, resource: ImageResource, operation: Extract<ImageEditOperation, { type: 'mosaic' }>): void {
  const { rect } = operation, block = Math.max(1, operation.blockSize);
  if (rect.width <= 0 || rect.height <= 0) return;
  const columns = Math.ceil(rect.width / block), rows = Math.ceil(rect.height / block);
  const canvas = typeof document === 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
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
    if ('points' in operation && operation.type !== 'eraser') {
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
        context.font = `${operation.italic ? 'italic ' : ''}${operation.bold ? 'bold ' : ''}${operation.fontSize}px ${operation.fontFamily ?? 'sans-serif'}`;
        context.textBaseline = 'top'; context.textAlign = 'left';
        operation.text.split('\n').forEach((line, index) => context.fillText(line, operation.position.x, operation.position.y + index * operation.fontSize * 1.25));
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
      case 'mosaic': drawMosaic(context, resource, operation); break;
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
        const { center, radius } = operation, source = operation.source ?? center, zoom = Math.max(1, operation.zoom);
        context.beginPath(); context.arc(center.x, center.y, radius, 0, Math.PI * 2);
        context.save();
        try {
          context.clip(); context.clearRect(center.x - radius, center.y - radius, radius * 2, radius * 2);
          context.drawImage(resource.image, (source.x - radius / zoom) * resource.pixelWidth / resource.width, (source.y - radius / zoom) * resource.pixelHeight / resource.height, radius * 2 / zoom * resource.pixelWidth / resource.width, radius * 2 / zoom * resource.pixelHeight / resource.height, center.x - radius, center.y - radius, radius * 2, radius * 2);
        } finally { context.restore(); }
        context.stroke();
        break;
      }
      case 'eraser': {
        if (!operation.points.length) break;
        eraserClip(context, operation.points, operation.width);
        // Clear first so erasing over transparent source pixels restores alpha too.
        context.clearRect(recipe.crop.x, recipe.crop.y, recipe.crop.width, recipe.crop.height);
        drawSource(context, resource);
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
