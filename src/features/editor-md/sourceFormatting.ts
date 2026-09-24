import type { EditorView } from '@codemirror/view';
import { getLastHighlightColor } from '../toolbar/highlightPreference';
import { applySourceTextStyle } from '../document-style/sourceDocumentStyle';

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

/** Source shortcuts and toolbar actions operate on the same selection grammar. */
export function runSourceFormatCommand(view: EditorView, id: string): boolean | undefined {
  if (id === 'markdown.underline') return formatSourceMark(view, 'underline');
  if (id === 'markdown.highlight') return sourceMarkRange(view, 'highlight') ? formatSourceMark(view, 'highlight', undefined, true)
    : applySourceTextStyle(view, { background: getLastHighlightColor() }, true);
  const delimiters: Record<string, string> = { 'markdown.bold': '**', 'markdown.italic': '*', 'markdown.strike': '~~', 'markdown.code': '`' };
  const delimiter = delimiters[id];
  const { from, to } = view.state.selection.main;
  if (id === 'markdown.link') {
    const label = view.state.sliceDoc(from, to) || '链接文字', prefix = `[${label}](`, url = 'https://';
    view.dispatch({ changes: { from, to, insert: `${prefix}${url})` }, selection: { anchor: from + prefix.length, head: from + prefix.length + url.length }, scrollIntoView: true });
    return true;
  }
  if (delimiter) {
    const text = view.state.sliceDoc(from, to);
    const inside = text.length >= delimiter.length * 2 && text.startsWith(delimiter) && text.endsWith(delimiter);
    const surrounding = view.state.sliceDoc(Math.max(0, from - delimiter.length), from) === delimiter && view.state.sliceDoc(to, to + delimiter.length) === delimiter;
    const start = surrounding ? from - delimiter.length : from, end = surrounding ? to + delimiter.length : to;
    const content = inside ? text.slice(delimiter.length, -delimiter.length) : text;
    const remove = inside || surrounding, insert = remove ? content : delimiter + content + delimiter;
    view.dispatch({ changes: { from: start, to: end, insert }, selection: { anchor: start + (remove ? 0 : delimiter.length), head: start + (remove ? 0 : delimiter.length) + content.length }, scrollIntoView: true });
    return true;
  }
  const prefixes: Record<string, string> = { 'markdown.bulletList': '- ', 'markdown.orderedList': '1. ', 'markdown.taskList': '- [ ] ' };
  if (prefixes[id]) {
    const first = view.state.doc.lineAt(from), last = view.state.doc.lineAt(to);
    const changes = [];
    for (let number = first.number; number <= last.number; number++) {
      const line = view.state.doc.line(number), prefix = /^(?:[-+*] (?:\[[ xX]\] )?|\d+[.)] )/.exec(line.text)?.[0] ?? '';
      changes.push({ from: line.from, to: line.from + prefix.length, insert: prefix === prefixes[id] ? '' : prefixes[id] });
    }
    view.dispatch({ changes, scrollIntoView: true }); return true;
  }
  if (id === 'markdown.codeBlock' || id === 'markdown.rule') {
    const content = view.state.sliceDoc(from, to), insert = id === 'markdown.rule' ? '\n\n---\n\n' : `\n\n\`\`\`\n${content}\n\`\`\`\n\n`;
    view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + (id === 'markdown.rule' ? insert.length : 6) }, scrollIntoView: true }); return true;
  }
  return undefined;
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
  if (mark === 'highlight' && !current) return applySourceTextStyle(view, { background: remove ? null : color ?? getLastHighlightColor() });
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
