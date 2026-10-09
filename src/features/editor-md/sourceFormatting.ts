import type { EditorView } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { ChangeSet } from '@codemirror/state';
import { escapeMarkdownText } from './markdownTextEscape';
import { guardContextualBlocks, type SourceParagraph } from './sourceBlockGuards';

/** Removing inline wrappers must not turn their text into a new block. Inspect
 * only touched paragraph lines on the existing syntax tree and shared text rope. */
function preserveParagraphSyntax(view: EditorView, changes: { from: number; to: number; insert?: string }[], bodies: Map<number, number>, paragraphs: Iterable<SourceParagraph>) {
  const edits = ChangeSet.of(changes, view.state.doc.length), next = edits.apply(view.state.doc);
  const guards: { from: number; insert: string }[] = [], guarded = new Set<number>();
  const block = /^([ \t]{0,3})(?:#{1,6}(?:[ \t]+|$)|>|[-+*][ \t]+|\d{1,9}[.)][ \t]+|(?:(?:-[ \t]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})$|`{3,}|~{3,})/;
  for (const [lineNumber, bodyFrom] of bodies) {
    const before = view.state.doc.line(lineNumber), at = edits.mapPos(bodyFrom, -1), line = next.lineAt(at);
    if (guarded.has(line.number)) continue;
    const oldBody = view.state.sliceDoc(bodyFrom, before.to), body = next.sliceString(at, line.to);
    const prefix = block.exec(body);
    if (prefix && !block.test(oldBody)) {
      const digits = /^\d{1,9}(?=[.)])/.exec(body.slice(prefix[1].length))?.[0].length ?? 0;
      guards.push({ from: at + prefix[1].length + digits, insert: '\\' });
    }
    else if (/^(?: {4}| *\t)/.test(body) && !/^(?: {4}| *\t)/.test(oldBody)) {
      // A transparent inline wrapper represents leading spaces without creating
      // an indented code block or changing the literal text to nonbreaking spaces.
      guards.push({ from: at, insert: '<span style="white-space:pre">' }, { from: line.to, insert: '</span>' });
    }
    guarded.add(line.number);
  }
  const guardedEdits = guards.length ? edits.compose(ChangeSet.of(guards.sort((a, b) => a.from - b.from), next.length)) : edits;
  return guardContextualBlocks(view.state, guardedEdits, paragraphs, bodies);
}

/** Reuse the source editor's incremental grammar. Link targets, image sources,
 * escaped punctuation, fenced code and formulas never enter a regex rewrite. */
export function clearSourceTextFormatting(view: EditorView, range?: { from: number; to: number }): boolean {
  const selection = view.state.selection.main;
  const from = range?.from ?? (selection.empty ? view.state.doc.lineAt(selection.from).from : selection.from);
  const to = range?.to ?? (selection.empty ? view.state.doc.lineAt(selection.to).to : selection.to);
  const changes: { from: number; to: number; insert?: string }[] = [];
  const tags: { from: number; to: number; name: string; closing: boolean }[] = [];
  const tree = syntaxTree(view.state), bodies = new Map<number, number>(), paragraphs = new Map<number, SourceParagraph>();
  const rememberBody = (node: ReturnType<typeof tree.resolveInner>) => {
    let parent = node.parent;
    for (; parent && parent.name !== 'Paragraph'; parent = parent.parent) {
      if (parent.name.startsWith('ATXHeading') || parent.name === 'SetextHeading') return;
    }
    if (!parent) return;
    let quoted = false, quoteDepth = 0, listIndent = 0;
    for (let ancestor = parent.parent; ancestor; ancestor = ancestor.parent) {
      if (ancestor.name === 'Blockquote') { quoted = true; quoteDepth++; }
      if (ancestor.name === 'ListItem') listIndent = parent.from - view.state.doc.lineAt(parent.from).from;
    }
    paragraphs.set(parent.from, { from: parent.from, to: parent.to, quoted, quoteDepth, listIndent });
    const first = view.state.doc.lineAt(node.from), last = view.state.doc.lineAt(node.to);
    for (let number = first.number; number <= last.number; number++) {
      if (bodies.has(number)) continue;
      const line = view.state.doc.line(number); let bodyFrom = Math.max(parent.from, line.from);
      tree.iterate({ from: line.from, to: line.to, enter(prefix) {
        if (['QuoteMark', 'ListMark'].includes(prefix.name)) bodyFrom = Math.max(bodyFrom, prefix.to);
        if (prefix.name === 'Paragraph') return;
        if (prefix.from >= node.from && prefix.name !== 'Document') return false;
      } });
      bodies.set(number, bodyFrom);
    }
  };
  tree.iterate({ from, to, enter(node) {
    if (['FencedCode', 'CodeBlock', 'NBMath'].includes(node.name)) return false;
    if (node.from < from || node.to > to) return;
    if (node.name === 'InlineCode') {
      const first = node.node.firstChild, last = node.node.lastChild;
      if (first?.name === 'CodeMark' && last?.name === 'CodeMark' && first.from < last.from) {
        let body = view.state.sliceDoc(first.to, last.from).replace(/\r?\n/g, ' ');
        if (body.startsWith(' ') && body.endsWith(' ') && /\S/.test(body)) body = body.slice(1, -1);
        changes.push({ from: node.from, to: node.to, insert: escapeMarkdownText(body, true) });
        rememberBody(node.node);
      }
      return false;
    }
    if (['EmphasisMark', 'NBFormatMark'].includes(node.name) && node.node.parent && node.node.parent.from >= from && node.node.parent.to <= to) { changes.push({ from: node.from, to: node.to }); rememberBody(node.node); }
    if (node.name === 'HTMLTag') {
      const tag = /^<(\/)?(b|strong|i|em|u|s|strike|del|sub|sup|mark)(?:\s[^<>]*)?>$/i.exec(view.state.sliceDoc(node.from, node.to));
      if (tag) { tags.push({ from: node.from, to: node.to, name: tag[2].toLowerCase(), closing: !!tag[1] }); rememberBody(node.node); }
    }
  } });
  const stack: typeof tags = [];
  for (const tag of tags) {
    if (!tag.closing) stack.push(tag);
    else if (stack.at(-1)?.name === tag.name) {
      const opening = stack.pop()!;
      changes.push({ from: opening.from, to: opening.to }, { from: tag.from, to: tag.to });
    }
  }
  if (!changes.length) return false;
  view.dispatch({ changes: preserveParagraphSyntax(view, changes.sort((a, b) => a.from - b.from), bodies, paragraphs.values()), userEvent: 'input.format', scrollIntoView: true });
  return true;
}

export function restoreSourceParagraph(view: EditorView): boolean {
  const { from, to, empty } = view.state.selection.main;
  const first = view.state.doc.lineAt(from), last = view.state.doc.lineAt(to);
  const end = !empty && to === last.from ? last.number - 1 : last.number;
  const changes: { from: number; to: number }[] = [];
  for (let number = first.number; number <= end; number++) {
    const line = view.state.doc.line(number);
    const prefix = /^([ \t]*)(?:#{1,6}[ \t]+|(?:>[ \t]*)+|[-+*][ \t]+(?:\[[ xX]\][ \t]+)?|\d+[.)][ \t]+)/.exec(line.text);
    if (!prefix) continue;
    let context = syntaxTree(view.state).resolveInner(line.from + prefix[0].length, 1), code = false;
    for (; context; context = context.parent!) if (['FencedCode', 'CodeBlock'].includes(context.name)) { code = true; break; }
    if (!code) changes.push({ from: line.from + prefix[1].length, to: line.from + prefix[0].length });
  }
  if (!changes.length) return false;
  view.dispatch({ changes, userEvent: 'input.format', scrollIntoView: true });
  return true;
}

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
  if (!level) return restoreSourceParagraph(view);
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
  if (id === 'markdown.highlight') return sourceMarkRange(view, 'highlight') ? formatSourceMark(view, 'highlight', undefined, true) : true;
  const delimiters: Record<string, string> = { 'markdown.bold': '**', 'markdown.italic': '*', 'markdown.strike': '~~', 'markdown.code': '`' };
  const delimiter = delimiters[id];
  const { from, to } = view.state.selection.main;
  if (id === 'markdown.code') {
    for (let node = syntaxTree(view.state).resolveInner(from, 1); node; node = node.parent!) {
      if (node.name === 'InlineCode' && node.from <= from && node.to >= to) return clearSourceTextFormatting(view, { from: node.from, to: node.to });
    }
  }
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
  if (mark === 'highlight' && (!current || !remove)) return false;
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
