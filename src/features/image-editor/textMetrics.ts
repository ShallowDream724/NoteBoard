import type { TextOperation } from './model';

export interface TextLayout { readonly width: number; readonly height: number; readonly lineHeight: number; readonly baseline: number }

const measured = new WeakMap<TextOperation, TextLayout>();
let measurementContext: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null | undefined;

/** The renderer and the measurement canvas must use the same font shorthand. */
export function formatTextCanvasFont(operation: TextOperation): string {
  const size = Number.isFinite(operation.fontSize) ? Math.max(1, operation.fontSize) : 1;
  return `${operation.italic ? 'italic ' : ''}${operation.bold ? 'bold ' : ''}${size}px ${operation.fontFamily || 'sans-serif'}`;
}

function getMeasurementContext(): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null {
  if (measurementContext !== undefined) return measurementContext;
  // jsdom has no raster canvas. A deterministic fallback is preferable to its noisy getContext stub.
  if (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent)) return measurementContext = null;
  try {
    if (typeof OffscreenCanvas !== 'undefined') return measurementContext = new OffscreenCanvas(1, 1).getContext('2d');
    if (typeof document !== 'undefined') return measurementContext = document.createElement('canvas').getContext('2d');
  } catch { /* No canvas in a non-browser test or server runtime. */ }
  return measurementContext = null;
}

function fallbackLineWidth(line: string, size: number): number {
  let units = 0;
  for (const char of line.normalize('NFC')) {
    const code = char.codePointAt(0)!;
    if (code === 0x200d || code >= 0xfe00 && code <= 0xfe0f || code >= 0x300 && code <= 0x36f) continue;
    if (code >= 0x1f000 || code >= 0x2e80 && code <= 0x9fff || code >= 0xac00 && code <= 0xd7ff || code >= 0xf900 && code <= 0xfaff || code >= 0xff01 && code <= 0xff60) units += 1.08;
    else if (/\s/u.test(char)) units += .36;
    else if (/[ilI1.,;:'`!|]/u.test(char)) units += .4;
    else if (/[MW@#%&]/u.test(char)) units += .9;
    else units += .68;
  }
  return units * size;
}

/** Logical source-pixel extent for a top-aligned multiline label, with a small glyph-overhang reserve. */
export function measureTextLayout(operation: TextOperation): TextLayout {
  const cached = measured.get(operation);
  if (cached) return cached;
  const size = Number.isFinite(operation.fontSize) ? Math.max(1, operation.fontSize) : 1;
  const lineHeight = size * 1.25;
  const context = getMeasurementContext();
  if (context) context.font = formatTextCanvasFont(operation);
  const fontMetrics = context?.measureText('Mg图😀');
  const ascent = fontMetrics?.fontBoundingBoxAscent || size * .8;
  const descent = fontMetrics?.fontBoundingBoxDescent || size * .2;
  const baseline = (lineHeight - ascent - descent) / 2 + ascent;
  let width = 0, lineCount = 0;
  for (const line of operation.text.split('\n')) {
    lineCount++;
    const estimate = fallbackLineWidth(line, size);
    if (!context) { width = Math.max(width, estimate); continue; }
    const metrics = context.measureText(line);
    // actualBoundingBoxRight includes italic glyphs that can extend past the advance width.
    width = Math.max(width, metrics.width, (metrics.actualBoundingBoxLeft || 0) + (metrics.actualBoundingBoxRight || 0));
  }
  const reserve = Math.max(2, size * .1) * (operation.bold || operation.italic ? 1.5 : 1);
  const layout = { width: Math.max(size * .7, width + reserve), height: Math.max(1, lineCount) * lineHeight, lineHeight, baseline };
  measured.set(operation, layout);
  return layout;
}
