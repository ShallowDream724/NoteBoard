import type { EditorView } from '@tiptap/pm/view';
import type { TopLevelBlockInfo } from './blockReorder';
import { isEmptyParagraph } from './blockInteractionScope';
import { listItemHorizontalBounds } from './listMarkerGeometry';

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
    edge = listItemHorizontalBounds(view, block.pos, block.element, rect, scale).left;
  }
  // A tall block can start above the viewport. Keep its control reachable without
  // a browser focus/hover scroll moving the anchor out from under the pointer.
  const blockTop = (rect.top - bounds.top) / scale;
  const text = block.element.tagName === 'LI' ? block.element.firstElementChild : block.element;
  const textRow = text instanceof HTMLElement && text.matches('p,h1,h2,h3,h4,h5,h6');
  const lineHeight = textRow ? parseFloat(getComputedStyle(text).lineHeight) || (parseFloat(getComputedStyle(text).fontSize) || 16) * 1.5 : 0;
  const textRect = textRow ? text.getBoundingClientRect() : rect;
  const anchorTop = isEmptyParagraph(block.node) ? blockTop + (rect.height / scale - height) / 2
    : textRow ? (textRect.top - bounds.top) / scale + (Math.min(textRect.height / scale, lineHeight) - height) / 2
    : blockTop + 2;
  const viewportTop = Math.max(0, Math.min(anchorTop, host.clientHeight - height - 4));
  let controlWidth = width, left = (edge - bounds.left) / scale + host.scrollLeft - controlWidth - 8;
  if (block.element.tagName === 'LI' && left < host.scrollLeft + 4) {
    controlWidth = Math.min(width, 30);
    left = (edge - bounds.left) / scale + host.scrollLeft - controlWidth - 8;
    // Extremely wide counters can consume the entire left gutter. Keep the
    // same row action in the right gutter rather than covering its number.
    const right = (rect.right - bounds.left) / scale + host.scrollLeft + 8;
    if (left < host.scrollLeft + 4 && right + controlWidth <= host.scrollLeft + host.clientWidth - 4) left = right;
  }
  return { top: viewportTop + host.scrollTop, left: Math.max(4, left), width: controlWidth };
}
