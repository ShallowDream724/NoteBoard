/** A native source surface owns only text and a caret, never document history. */
export type SourceSelection = { anchor: number; head: number };
export const readSourceText = (element: HTMLElement): string => element.tagName === 'TEXTAREA'
  ? (element as HTMLTextAreaElement).value : element.textContent ?? '';

export function writeSourceText(element: HTMLElement, value: string) {
  if (element.tagName === 'TEXTAREA') (element as HTMLTextAreaElement).value = value;
  else element.textContent = value;
}

export function readSourceSelection(element: HTMLElement): SourceSelection {
  if (element.tagName === 'TEXTAREA') {
    const { selectionStart: start, selectionEnd: end, selectionDirection } = element as HTMLTextAreaElement;
    return selectionDirection === 'backward' ? { anchor: end, head: start } : { anchor: start, head: end };
  }
  const selection = element.ownerDocument.getSelection();
  if (!selection?.anchorNode || !selection.focusNode || !element.contains(selection.anchorNode) || !element.contains(selection.focusNode)) {
    const end = readSourceText(element).length;
    return { anchor: end, head: end };
  }
  const offset = (node: Node, position: number) => {
    const range = element.ownerDocument.createRange();
    range.selectNodeContents(element); range.setEnd(node, position);
    return range.toString().length;
  };
  return { anchor: offset(selection.anchorNode, selection.anchorOffset), head: offset(selection.focusNode, selection.focusOffset) };
}

export function writeSourceSelection(element: HTMLElement, { anchor, head }: SourceSelection) {
  const length = readSourceText(element).length;
  anchor = Math.max(0, Math.min(length, anchor)); head = Math.max(0, Math.min(length, head));
  if (element.tagName === 'TEXTAREA') {
    (element as HTMLTextAreaElement).setSelectionRange(Math.min(anchor, head), Math.max(anchor, head), anchor > head ? 'backward' : 'forward');
    return;
  }
  const point = (offset: number): [Node, number] => {
    const walker = element.ownerDocument.createTreeWalker(element, 4 /* SHOW_TEXT */);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const size = node.textContent?.length ?? 0;
      if (offset <= size) return [node, offset];
      offset -= size;
    }
    return [element, element.childNodes.length];
  };
  const [a, ao] = point(anchor), [h, ho] = point(head);
  element.ownerDocument.getSelection()?.setBaseAndExtent(a, ao, h, ho);
}

/** Plain-text paste/newline insertion. Never called during an IME composition. */
export function replaceSourceSelection(element: HTMLElement, inserted: string): string {
  const text = readSourceText(element), { anchor, head } = readSourceSelection(element);
  const from = Math.min(anchor, head), to = Math.max(anchor, head);
  const next = text.slice(0, from) + inserted + text.slice(to);
  writeSourceText(element, next);
  writeSourceSelection(element, { anchor: from + inserted.length, head: from + inserted.length });
  return next;
}
