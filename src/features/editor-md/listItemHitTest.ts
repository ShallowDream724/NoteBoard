/** Find the block occupying this row without enumerating a large list. */
function childAtY(parent: Element, clientY: number): Element | null {
  const children = parent.children;
  let low = 0, high = children.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const child = children[middle], rect = child.getBoundingClientRect();
    if (clientY < rect.top) high = middle;
    else if (clientY >= rect.bottom) low = middle + 1;
    else return child;
  }
  return null;
}

/** Generated markers and list padding hit OL/UL rather than LI. Resolve the
 * visible item at that y, including a nested list's own row. Task labels share
 * a row with the content DIV, so only the latter participates in block lookup.
 * Work follows one ancestor branch; no index, listeners or retained DOM state. */
export function listItemAtY(list: Element, clientY: number): HTMLElement | null {
  let current = list;
  while (current.matches('ol,ul')) {
    const item = childAtY(current, clientY);
    if (!(item instanceof HTMLElement) || item.tagName !== 'LI') return null;
    const content = item.dataset.type === 'taskItem' ? item.querySelector(':scope > div') ?? item : item;
    const block = childAtY(content, clientY);
    if (!block?.matches('ol,ul')) return item;
    current = block;
  }
  return null;
}
