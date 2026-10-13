import { contentViewport, type ViewportBounds } from '../../core/dom/contentViewport';

/** Control anchors follow the visible content, never the full-width NodeView
 * shell. This geometry is deliberately separate from selection/drop bounds. */
export function blockVisualBounds(element: HTMLElement, type: string): ViewportBounds {
  const shell = element.getBoundingClientRect();
  if ((type === 'paragraph' || type === 'heading') && /^(center|right|end)$/.test(getComputedStyle(element).textAlign)) {
    // A bounded first-glyph measurement follows aligned text without allocating
    // line rectangles for a huge paragraph or changing its selection.
    const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let count = 0, text = walker.nextNode(); text && count < 64; text = walker.nextNode(), count++) {
      if (!text.textContent?.trim() || text.parentElement?.closest('[contenteditable="false"]')) continue;
      const range = element.ownerDocument.createRange();
      range.setStart(text, 0); range.setEnd(text, Math.min(2, text.textContent.length));
      const rect = range.getBoundingClientRect?.();
      if (rect?.width && rect.height) return rect;
      break;
    }
  }
  const selector = type === 'table' ? 'table'
    : type === 'image' ? '[data-image-frame]'
    : type === 'mathBlock' ? '.math-node-preview .katex-html > .base, .math-node-preview .nb-matrix-view'
    : null;
  const content = selector ? element.querySelector<HTMLElement>(selector) : null;
  if (!content) return shell;
  const rect = content.getBoundingClientRect();
  if (!rect.width || !rect.height) return shell;
  // Local table/formula scrollers can hide the original content edge. Anchor
  // to the visible edge without measuring rows or changing reading layout.
  const { bounds } = contentViewport(content, element);
  const left = Math.max(rect.left, bounds.left), right = Math.min(rect.right, bounds.right);
  const top = Math.max(rect.top, bounds.top), bottom = Math.min(rect.bottom, bounds.bottom);
  return right > left && bottom > top ? { left, right, top, bottom, width: right - left, height: bottom - top } : shell;
}

/** Keep the table's row-selection rail separate from the block controls. */
export function blockControlAnchor(element: HTMLElement, type: string, scale = 1) {
  const bounds = blockVisualBounds(element, type);
  return { left: bounds.left - (type === 'table' ? 22 * scale : 0), top: bounds.top };
}
