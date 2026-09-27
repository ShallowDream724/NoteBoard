import type { EditorView } from '@tiptap/pm/view';
import type { CodeLine } from './codeBlockStructure';
import type { CodeViewport } from './codeVisibility';

export const WINDOWED_CODE_LINES = 400;
export const INITIAL_CODE_GUTTERS = 160;

function lineAt(lines: CodeLine[], offset: number): number {
  let low = 0, high = lines.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (lines[mid].from <= offset) low = mid + 1; else high = mid;
  }
  return Math.max(0, low - 1);
}

/** Two coordinate probes and binary searches, independent of document length. */
export function visibleCodeLines(view: EditorView, position: number, lines: CodeLine[], viewport?: CodeViewport): [number, number] | undefined {
  const dom = view.nodeDOM(position);
  if (!(dom instanceof HTMLElement)) return;
  const code = dom.querySelector('pre > code');
  if (!code) return;
  const box = code.getBoundingClientRect();
  const scroller = dom.closest('[data-editor-scroll]')?.getBoundingClientRect();
  const top = viewport?.top ?? Math.max(0, scroller?.top ?? 0), bottom = viewport?.bottom ?? Math.min(view.dom.ownerDocument.defaultView?.innerHeight ?? 0, scroller?.bottom ?? Infinity);
  if (box.bottom < top || box.top > bottom || box.width <= 0) return;
  const x = Math.min(viewport?.right ?? Infinity, Math.max(viewport?.left ?? 0, box.left) + 2), start = position + 1;
  const at = (y: number) => {
    const offset = (view.posAtCoords({ left: x, top: y })?.pos ?? -1) - start;
    // A transient layout/caret probe failure must not park the gutter at line 1.
    // The estimate is used only until the next resize/scroll geometry sample.
    return offset >= 0 && offset <= lines[lines.length - 1].to ? lineAt(lines, offset)
      : Math.max(0, Math.min(lines.length - 1, Math.floor((y - box.top) / Math.max(1, box.height) * lines.length)));
  };
  const first = box.top >= top ? 0 : at(top + 1);
  const last = box.bottom <= bottom ? lines.length - 1 : at(bottom - 1);
  const from = Math.max(0, first - 24);
  return [from, Math.min(lines.length, Math.max(first + 1, last + 25), from + 400)];
}
