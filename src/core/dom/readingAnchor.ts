import { clientBounds } from './contentViewport';
import { findScrollContainer } from './scrollContainer';

/** Keep the visible content when a document-wide policy transfers scrolling
 * between the page and a local viewport. One read/write boundary per command;
 * no document scan, scroll listener or retained anchor. */
export function preserveReadingAnchor(viewport: HTMLElement | null, change: () => unknown): void {
  if (!viewport?.isConnected) { change(); return; }
  const page = findScrollContainer(viewport), outer = clientBounds(page), before = clientBounds(viewport);
  if (!before.width || !before.height || before.bottom <= outer.top || before.top >= outer.bottom || before.right <= outer.left || before.left >= outer.right) { change(); return; }
  const scaleX = before.width / (viewport.clientWidth || before.width || 1), scaleY = before.height / (viewport.clientHeight || before.height || 1);
  const point = { x: Math.max(before.left, outer.left), y: Math.max(before.top, outer.top) };
  const offset = { x: viewport.scrollLeft + (point.x - before.left) / scaleX, y: viewport.scrollTop + (point.y - before.top) / scaleY };
  change();
  const style = getComputedStyle(viewport), scrolls = /^(auto|scroll|overlay)$/;
  const localX = scrolls.test(style.overflowX), localY = scrolls.test(style.overflowY);
  if (localX) viewport.scrollLeft = offset.x;
  if (localY) viewport.scrollTop = offset.y;
  const after = clientBounds(viewport);
  const pageX = outer.width / (page.clientWidth || outer.width || 1), pageY = outer.height / (page.clientHeight || outer.height || 1);
  page.scrollLeft += (after.left - (point.x - (localX ? 0 : offset.x * scaleX))) / pageX;
  page.scrollTop += (after.top - (point.y - (localY ? 0 : offset.y * scaleY))) / pageY;
}
