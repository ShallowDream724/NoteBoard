export function findScrollContainer(element: HTMLElement): HTMLElement {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (/(auto|scroll|overlay)/.test(getComputedStyle(parent).overflowY)) return parent;
  }
  return document.documentElement;
}
