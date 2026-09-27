import type { EditorView } from '@tiptap/pm/view';
import type { TopLevelBlockInfo } from './blockReorder';
import { isEmptyParagraph } from './blockInteractionScope';
let markerCanvas: CanvasRenderingContext2D | null | undefined;
function ordinalText(value: number, type: string) {
  if (value > 0 && /alpha|latin/.test(type)) {
    let text = ''; for (let n = value; n > 0; n = Math.floor((n - 1) / 26)) text = String.fromCharCode(97 + (n - 1) % 26) + text;
    return type.startsWith('upper') ? text.toUpperCase() : text;
  }
  if (value > 0 && value < 4000 && /roman/.test(type)) {
    let text = '', n = value;
    for (const [size, symbol] of [[1000,'m'],[900,'cm'],[500,'d'],[400,'cd'],[100,'c'],[90,'xc'],[50,'l'],[40,'xl'],[10,'x'],[9,'ix'],[5,'v'],[4,'iv'],[1,'i']] as const)
      while (n >= size) { text += symbol; n -= size; }
    return type.startsWith('upper') ? text.toUpperCase() : text;
  }
  return String(value);
}

/** Shared viewport-space edge for document-gutter placement and hit testing. */
export function editorContentLeft(view: EditorView) {
  const rect = view.dom.getBoundingClientRect();
  const scale = rect.width / view.dom.offsetWidth || 1;
  return rect.left + parseFloat(getComputedStyle(view.dom).paddingLeft || '0') * scale;
}

/** List markers and folding controls stay in the content lane. Convert the
 * resulting anchor once into the scroll host's coordinate space. */
export function blockHandlePosition(view: EditorView, block: TopLevelBlockInfo, host: HTMLElement, width = 50, height = 30) {
  const rect = block.element.getBoundingClientRect(), bounds = host.getBoundingClientRect();
  const scale = bounds.width / host.offsetWidth || 1;
  let edge = rect.left;
  if (block.element.closest('.nb-disclosure-body') || block.node.type.name === 'imageCollection') edge = editorContentLeft(view);
  else if (block.node.type.name === 'heading') {
    edge = block.element.querySelector('.nb-heading-fold-toggle')?.getBoundingClientRect().left ?? edge - 22 * scale;
  } else if (block.node.type.name === 'table') edge -= 22 * scale;
  else if (block.element.tagName === 'LI') {
    const list = block.element.parentElement!;
    edge = Math.min(edge, list.getBoundingClientRect().left);
    if (list.tagName === 'OL') {
      const at = view.state.doc.resolve(block.pos);
      const ordinal = Number(at.parent.attrs.start ?? 1) + at.index();
      const style = getComputedStyle(block.element);
      markerCanvas ??= document.createElement('canvas').getContext('2d');
      if (markerCanvas) markerCanvas.font = style.font || `${style.fontSize} ${style.fontFamily}`;
      const marker = ordinalText(ordinal, style.listStyleType) + '. ';
      const width = markerCanvas?.measureText(marker).width ?? marker.length * parseFloat(style.fontSize) * .65;
      edge = Math.min(edge, rect.left - width * scale);
    }
  }
  // A tall block can start above the viewport. Keep its control reachable without
  // a browser focus/hover scroll moving the anchor out from under the pointer.
  const blockTop = (rect.top - bounds.top) / scale;
  const anchorTop = isEmptyParagraph(block.node) ? blockTop + (rect.height / scale - height) / 2 : blockTop + 2;
  const viewportTop = Math.max(0, Math.min(anchorTop, host.clientHeight - height - 4));
  return { top: viewportTop + host.scrollTop,
    left: Math.max(4, (edge - bounds.left) / scale + host.scrollLeft - width - 8) };
}
