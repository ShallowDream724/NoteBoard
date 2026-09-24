import type { EditorView } from '@codemirror/view';

function containsClosingTag(view: EditorView, from: number, to: number, tag: string) {
  let tail = '';
  const text = view.state.doc.iterRange(from, to);
  while (!text.next().done) {
    const chunk = tail + text.value;
    if (chunk.includes(tag)) return true;
    tail = chunk.slice(-(tag.length - 1));
  }
  return false;
}

export function setSourceHeading(view: EditorView, level: number) {
  const selection = view.state.selection.main, line = view.state.doc.lineAt(selection.from);
  const oldPrefix = /^#{1,6}\s+/.exec(line.text)?.[0] ?? '';
  const prefix = level ? '#'.repeat(level) + ' ' : '';
  view.dispatch({ changes: { from: line.from, to: line.from + oldPrefix.length, insert: prefix },
    selection: { anchor: Math.max(line.from + prefix.length, selection.anchor + prefix.length - oldPrefix.length),
      head: Math.max(line.from + prefix.length, selection.head + prefix.length - oldPrefix.length) }, scrollIntoView: true });
  return true;
}

/** Inspect only the selection boundary, never stringify or scan the whole document. */
export function sourceMarkRange(view: EditorView, mark: 'underline' | 'highlight') {
  const { from, to } = view.state.selection.main;
  const opening = mark === 'underline' ? /^<u>/ : /^<mark data-color="([^"<>]+)">/;
  const closing = mark === 'underline' ? '</u>' : '</mark>';
  const inside = opening.exec(view.state.sliceDoc(from, Math.min(from + 96, to)));
  if (inside && to - from >= inside[0].length + closing.length && view.state.sliceDoc(to - closing.length, to) === closing
    && !containsClosingTag(view, from + inside[0].length, to - closing.length, closing))
    return { from, to, contentFrom: from + inside[0].length, contentTo: to - closing.length, color: inside[1] };
  const before = view.state.sliceDoc(Math.max(0, from - 96), from);
  const surrounding = (mark === 'underline' ? /<u>$/ : /<mark data-color="([^"<>]+)">$/).exec(before);
  if (surrounding && view.state.sliceDoc(to, to + closing.length) === closing && !containsClosingTag(view, from, to, closing))
    return { from: from - surrounding[0].length, to: to + closing.length, contentFrom: from, contentTo: to, color: surrounding[1] };
  return null;
}

export function formatSourceMark(view: EditorView, mark: 'underline' | 'highlight', color?: string, remove = false) {
  const current = sourceMarkRange(view, mark), selection = view.state.selection.main;
  const from = current?.from ?? selection.from, to = current?.to ?? selection.to;
  if (remove && !current) return false;
  const text = view.state.sliceDoc(current?.contentFrom ?? from, current?.contentTo ?? to);
  const unset = remove || (mark === 'underline' && current !== null);
  const open = unset ? '' : mark === 'underline' ? '<u>' : `<mark data-color="${color}">`;
  const close = unset ? '' : mark === 'underline' ? '</u>' : '</mark>';
  view.dispatch({ changes: { from, to, insert: open + text + close },
    selection: { anchor: from + open.length, head: from + open.length + text.length }, scrollIntoView: true });
  return true;
}
