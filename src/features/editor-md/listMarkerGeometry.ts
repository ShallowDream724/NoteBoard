import type { EditorView } from '@tiptap/pm/view';

/** Counter styles used by the editor's ordered lists, including CSS fallbacks. */
export function orderedMarkerText(value: number, style: string): string {
  let text = String(value);
  if (Number.isSafeInteger(value) && value > 0 && /^(?:lower|upper)-(?:alpha|latin)$/.test(style)) {
    text = ''; let remaining = value;
    while (remaining) { remaining--; text = String.fromCharCode(97 + remaining % 26) + text; remaining = Math.floor(remaining / 26); }
  } else if (Number.isInteger(value) && value > 0 && value < 4000 && /^(?:lower|upper)-roman$/.test(style)) {
    text = ''; let remaining = value;
    for (const [amount, symbol] of [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']] as const) {
      while (remaining >= amount) { text += symbol; remaining -= amount; }
    }
  } else if (style === 'decimal-leading-zero') text = (value < 0 ? '-' : '') + String(Math.abs(value)).padStart(2, '0');
  return (style.startsWith('upper-') ? text.toUpperCase() : text) + '. ';
}

/** One lazy 1px measuring surface, owned and released by the active feedback
 * overlay. No DOM insertion, per-row cache, font loading or document scan. */
function createListMarkerMeasurer(document: Document) {
  let canvas: HTMLCanvasElement | null = null, context: CanvasRenderingContext2D | null = null;
  return {
    width(value: number, style: CSSStyleDeclaration): number {
      const fontSize = Number.parseFloat(style.fontSize);
      if (!Number.isFinite(fontSize) || style.listStylePosition === 'inside' || style.listStyleType === 'none') return 0;
      if (!canvas) {
        canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
        try { context = canvas.getContext('2d'); } catch { context = null; }
      }
      const text = orderedMarkerText(value, style.listStyleType);
      if (context) context.font = style.font || `${style.fontStyle || 'normal'} ${style.fontWeight || '400'} ${style.fontSize} ${style.fontFamily || 'sans-serif'}`;
      const spacing = (Number.parseFloat(style.letterSpacing) || 0) * text.length + (Number.parseFloat(style.wordSpacing) || 0);
      return Math.max(0, (context?.measureText(text).width ?? text.length * fontSize) + spacing + fontSize / 4);
    },
    destroy() { if (canvas) canvas.width = canvas.height = 0; context = null; canvas = null; },
  };
}

const surfaces = new WeakMap<EditorView, ReturnType<typeof createListMarkerMeasurer>>();
export function releaseListMarkerGeometry(view: EditorView) { surfaces.get(view)?.destroy(); surfaces.delete(view); }

/** Same viewport-space row edges for the drag handle and range feedback. The
 * model path gives the ordinal without enumerating DOM siblings or list items. */
export function listItemHorizontalBounds(view: EditorView, pos: number, item: HTMLElement, rect: DOMRect, scale: number) {
  const list = item.tagName === 'LI' && item.parentElement?.matches('ol,ul') ? item.parentElement : null;
  const parentBounds = list?.getBoundingClientRect() ?? rect;
  let left = Math.min(rect.left, parentBounds.left), right = Math.max(rect.right, parentBounds.right);
  if (list?.tagName === 'OL') {
    const inside = view.state.doc.resolve(Math.min(pos + 1, view.state.doc.content.size));
    for (let depth = inside.depth; depth > 0; depth--) {
      const parent = inside.node(depth - 1);
      if (inside.node(depth).type.name !== 'listItem' || parent.type.name !== 'orderedList') continue;
      let surface = surfaces.get(view);
      if (!surface) { surface = createListMarkerMeasurer(item.ownerDocument); surfaces.set(view, surface); }
      const style = item.ownerDocument.defaultView!.getComputedStyle(item);
      const width = surface.width(Number(parent.attrs.start ?? 1) + inside.index(depth - 1), style) * scale;
      if (style.direction === 'rtl') right = Math.max(right, rect.right + width); else left = Math.min(left, rect.left - width);
      break;
    }
  }
  return { left, right };
}
