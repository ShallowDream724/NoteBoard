import type { ImageEditorPreferences, ImagePreferenceTool, ImageToolPreferences } from '../../core/ipc/types';
import type { ImageEditOperation, ImageEditorTool } from './model';
import { DEFAULT_TOOL_STYLE, type ToolStyle } from './toolDefaults';

type Field = keyof ImageToolPreferences;
const FIELDS: Record<ImagePreferenceTool, readonly Field[]> = {
  pen: ['color', 'width', 'pattern'], highlighter: ['color', 'width'],
  line: ['color', 'width', 'pattern', 'startHead', 'endHead'], polyline: ['color', 'width', 'pattern', 'startHead', 'endHead'],
  rectangle: ['color', 'width', 'pattern'], ellipse: ['color', 'width', 'pattern'],
  text: ['color', 'fontSize', 'bold', 'italic'],
  marker: ['color', 'width', 'markerSize', 'markerFormat', 'markerShape', 'markerAppearance'],
  mosaic: ['blockSize'], 'mosaic-brush': ['width', 'blockSize'],
  spotlight: ['opacity', 'spotlightShape'], magnifier: ['color', 'width', 'pattern', 'radius', 'zoom'],
  eraser: ['width'], 'object-eraser': ['width'],
};
const WIDTHS: Partial<Record<ImagePreferenceTool, number>> = { highlighter: 24, eraser: 20, 'object-eraser': 40, 'mosaic-brush': 40 };
const LIMITS: Partial<Record<Field, readonly [number, number]>> = {
  width: [1, 2000], fontSize: [1, 2000], markerSize: [1, 2000], radius: [1, 2000], blockSize: [2, 500], opacity: [0, 1], zoom: [1.1, 20],
};
function preferenceTool(tool: ImageEditorTool): tool is ImagePreferenceTool { return Object.hasOwn(FIELDS, tool); }

/** Only defaults cross image/window boundaries. Geometry, text and numbering never do. */
export function operationPreferences(operation: ImageEditOperation): ImageToolPreferences {
  const stroke = 'style' in operation ? operation.style : {};
  switch (operation.type) {
    case 'text': return { color: operation.color, fontSize: operation.fontSize, bold: !!operation.bold, italic: !!operation.italic };
    case 'marker': return { ...stroke, markerSize: operation.size, markerFormat: operation.format, markerShape: operation.shape, markerAppearance: operation.appearance };
    case 'line': case 'polyline': return { ...stroke, startHead: operation.startHead ?? 'none', endHead: operation.endHead ?? 'none' };
    case 'mosaic': return { blockSize: operation.blockSize };
    case 'mosaic-brush': return { width: operation.width, blockSize: operation.blockSize };
    case 'eraser': return { width: operation.width };
    case 'spotlight': return { opacity: operation.opacity, spotlightShape: operation.shape };
    case 'magnifier': return { ...stroke, radius: operation.radius, zoom: operation.zoom };
    default: return stroke;
  }
}

/** Per-dialog intent buffer; native settings remains the only durable authority.
 * Read remote defaults only on tool/image entry. Flush sparse edits on gesture end,
 * never on pointermove. No subscriptions, timers, bitmap data or global snapshots. */
export class ImagePreferenceSession {
  private pending: ImageEditorPreferences = {};
  private editing = false;
  constructor(private readonly read: () => ImageEditorPreferences, private readonly write: (patch: ImageEditorPreferences) => Promise<void>, private readonly failed: (error: unknown) => void) {}
  style(tool: ImageEditorTool): ToolStyle {
    if (!preferenceTool(tool)) return { ...DEFAULT_TOOL_STYLE };
    return { ...DEFAULT_TOOL_STYLE, width: WIDTHS[tool] ?? DEFAULT_TOOL_STYLE.width, ...this.read().tools?.[tool], ...this.pending.tools?.[tool] };
  }
  modes() { return { mosaicMode: 'rectangle' as const, magnifierMode: 'ellipse' as const, ...this.read(), ...this.pending }; }
  remember(tool: ImageEditorTool, input: Partial<ToolStyle>): void {
    if (!preferenceTool(tool)) return;
    const current = this.style(tool), patch: ImageToolPreferences = { ...this.pending.tools?.[tool] };
    for (const field of FIELDS[tool]) {
      let value = input[field];
      if (value === undefined) continue;
      const limits = LIMITS[field];
      if (typeof value === 'number') {
        if (!Number.isFinite(value)) continue;
        if (limits) value = Math.max(limits[0], Math.min(limits[1], value));
      }
      if (value !== current[field]) Object.assign(patch, { [field]: value });
    }
    if (Object.keys(patch).length) this.pending = { ...this.pending, tools: { ...this.pending.tools, [tool]: patch } };
  }
  rememberModes(patch: Pick<ImageEditorPreferences, 'mosaicMode' | 'magnifierMode'>) { this.pending = { ...this.pending, ...patch }; this.flush(); }
  rememberOperation(before: ImageEditOperation, after: ImageEditOperation): ImageToolPreferences {
    if (before.type !== after.type || !preferenceTool(after.type)) return {};
    const previous = operationPreferences(before), next = operationPreferences(after), changed: ImageToolPreferences = {};
    for (const field of FIELDS[after.type]) if (next[field] !== previous[field]) Object.assign(changed, { [field]: next[field] });
    this.remember(after.type, changed);
    return changed;
  }
  begin() { this.editing = true; }
  end() { this.editing = false; this.flush(); }
  flush() {
    if (this.editing || !Object.keys(this.pending).length) return;
    const patch = this.pending; this.pending = {};
    void this.write(patch).catch(this.failed);
  }
}
