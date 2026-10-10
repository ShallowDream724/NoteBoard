import type { EditorView } from '@tiptap/pm/view';
import { formatNumbering } from './numbering/styles';

/** Counter styles used by the editor's ordered lists, including CSS fallbacks. */
export function orderedMarkerText(value: number, style: string): string {
  if (style === 'decimal-leading-zero') return `${value < 0 ? '-' : ''}${String(Math.abs(value)).padStart(2, '0')}. `;
  return `${formatNumbering(value, style.replace(/-latin$/, '-alpha'))} `;
}

/** One lazy 1px measuring surface, owned and released by the active feedback
 * overlay. No DOM insertion, per-row cache, font loading or document scan. */
function createListMarkerMeasurer(document: Document) {
  let canvas: HTMLCanvasElement | null = null, context: CanvasRenderingContext2D | null = null;
  return {
    width(value: number, style: CSSStyleDeclaration, numberStyle?: string | null): number {
      const fontSize = Number.parseFloat(style.fontSize);
      const outlined = numberStyle === 'circle' || numberStyle === 'box';
      if (!Number.isFinite(fontSize) || style.listStylePosition === 'inside' || !outlined && style.listStyleType === 'none') return 0;
      if (!canvas) {
        canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
        try { context = canvas.getContext('2d'); } catch { context = null; }
      }
      const text = outlined ? formatNumbering(value, numberStyle) : orderedMarkerText(value, numberStyle ?? style.listStyleType);
      if (context) context.font = style.font || `${style.fontStyle || 'normal'} ${style.fontWeight || '400'} ${style.fontSize} ${style.fontFamily || 'sans-serif'}`;
      const spacing = (Number.parseFloat(style.letterSpacing) || 0) * text.length + (Number.parseFloat(style.wordSpacing) || 0);
      const width = (context?.measureText(text).width ?? text.length * fontSize) + spacing;
      // Keep the outlined counter's padding, border and gap aligned with styles.css.
      return outlined ? Math.max(1.35 * fontSize, width + .24 * fontSize + 2) + .45 * fontSize : Math.max(0, width + fontSize / 4);
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
      const width = surface.width(Number(parent.attrs.start ?? 1) + inside.index(depth - 1), style, parent.attrs.numberStyle) * scale;
      if (style.direction === 'rtl') right = Math.max(right, rect.right + width); else left = Math.min(left, rect.left - width);
      break;
    }
  }
  return { left, right };
}
