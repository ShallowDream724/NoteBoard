export function findScrollContainer(element: HTMLElement): HTMLElement {
  // Editors declare their scroll owner. This also avoids computed-style reads in
  // pointer/viewport callbacks while a newly rendered formula is awaiting layout.
  const owner = element.closest<HTMLElement>('[data-editor-scroll]');
  if (owner) return owner;
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (/(auto|scroll|overlay)/.test(getComputedStyle(parent).overflowY)) return parent;
  }
  return document.documentElement;
}
