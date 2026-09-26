import type { EditorView } from '@tiptap/pm/view';
import type { CodeLine } from './codeBlockStructure';

export const WINDOWED_CODE_LINES = 2_000;
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
export function visibleCodeLines(view: EditorView, position: number, lines: CodeLine[]): [number, number] | undefined {
  const dom = view.nodeDOM(position);
  if (!(dom instanceof HTMLElement)) return;
  const code = dom.querySelector('pre > code');
  if (!code) return;
  const box = code.getBoundingClientRect();
  const scroller = dom.closest('[data-editor-scroll]')?.getBoundingClientRect();
  const top = Math.max(0, scroller?.top ?? 0), bottom = Math.min(view.dom.ownerDocument.defaultView?.innerHeight ?? 0, scroller?.bottom ?? Infinity);
  if (box.bottom < top || box.top > bottom || box.width <= 0) return;
  const x = Math.max(0, box.left + 2), start = position + 1;
  const first = box.top >= top ? 0 : lineAt(lines, (view.posAtCoords({ left: x, top: top + 1 })?.pos ?? start) - start);
  const last = box.bottom <= bottom ? lines.length - 1 : lineAt(lines, (view.posAtCoords({ left: x, top: bottom - 1 })?.pos ?? start) - start);
  const from = Math.max(0, first - 24);
  return [from, Math.min(lines.length, Math.max(first + 1, last + 25), from + 400)];
}
