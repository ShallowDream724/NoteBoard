import { renderedScale } from './layoutMetrics';

const PROSE = 'p,h1,h2,h3,h4,h5,h6,pre,li,blockquote,.github-alert';

/** The document is immutable within a layout session. Item overrides can only
 * change horizontal overflow in their containing prose, not unrelated blocks. */
export function createProseOverflowCheck(root: HTMLElement) {
  const overflowing = new Set<HTMLElement>();
  return (global: boolean, changed: Iterable<HTMLElement>): boolean => {
    let candidates: Iterable<HTMLElement>;
    if (global) {
      overflowing.clear();
      candidates = root.querySelectorAll<HTMLElement>(PROSE);
    } else {
      const ancestors = new Set<HTMLElement>();
      for (const item of changed) {
        for (let parent = item.parentElement; parent && parent !== root && !ancestors.has(parent); parent = parent.parentElement) ancestors.add(parent);
      }
      candidates = [...ancestors].filter(element => element.matches(PROSE));
    }
    let boundary: DOMRect | undefined;
    for (const element of candidates) {
      if (element.closest('[data-export-item]')) continue;
      boundary ??= root.getBoundingClientRect();
      const box = element.getBoundingClientRect();
      const outside = box.right > boundary.right + 1 || box.left < boundary.left - 1 || element.scrollWidth * renderedScale(element) > box.width + 1;
      if (outside) overflowing.add(element); else overflowing.delete(element);
    }
    return overflowing.size > 0;
  };
}
