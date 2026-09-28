import { InputRule, getTextContentFromNodes, type Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';

const WINDOW = 500;

function escaped(text: string, at: number): boolean {
  let slashes = 0;
  while (at > 0 && text[--at] === '\\') slashes++;
  return slashes % 2 === 1;
}

interface CodeSpan { start: number; end: number; content: string }

/** Single-backtick spans only. Runs of two or more backticks belong to Markdown's
 * longer code-span syntax and must not be partially consumed by typing. */
export function codeSpanInInput(text: string, inputStart: number, inputEnd = text.length): CodeSpan | null {
  let opener = -1;
  for (let at = 0; at < text.length; at++) {
    if (text[at] !== '`' || escaped(text, at)) continue;
    if (text[at + 1] === '`' || text[at - 1] === '`') continue;
    if (opener < 0) { opener = at; continue; }
    const content = text.slice(opener + 1, at);
    if (content && at + 1 > inputStart && opener < inputEnd) {
      return { start: opener, end: at + 1, content };
    }
    opener = -1;
  }
  return null;
}

function textAfterSelection(editor: Editor): string {
  const { $from, $to } = editor.state.selection;
  if (!$from.sameParent($to)) return '';
  const start = $to.parentOffset, end = Math.min($to.parent.content.size, start + WINDOW);
  let text = '', stopped = false;
  $to.parent.nodesBetween(start, end, (node, pos) => {
    if (stopped) return false;
    if (!node.isText) { stopped = true; return false; }
    text += node.text!.slice(Math.max(0, start - pos), end - pos);
  });
  return text;
}

const compositions = new WeakMap<Editor, { start: number; pending: boolean }>();

export function inlineCodeComposition(editor: Editor) {
  return {
    compositionstart() {
      if (editor.state.selection.$from.parent.isTextblock) {
        compositions.set(editor, { start: editor.state.selection.from, pending: false });
      }
      return false;
    },
    compositionend() {
      const span = compositions.get(editor);
      if (span) {
        span.pending = true;
        setTimeout(() => { if (compositions.get(editor) === span) compositions.delete(editor); }, 100);
      }
      return false;
    },
  };
}

export function mapInlineCodeComposition(editor: Editor, tr: import('@tiptap/pm/state').Transaction): void {
  const span = compositions.get(editor);
  if (span) span.start = tr.mapping.map(span.start, -1);
}

/** The input rule handles both a newly typed closer and a closer already to the
 * right of the caret. It changes one paragraph in the same input transaction. */
export function inlineCodeInputRule(editor: Editor, code: import('@tiptap/pm/model').MarkType): InputRule {
  return new InputRule({
    find: text => {
      const previous = getTextContentFromNodes(editor.state.selection.$from);
      let start = previous.length;
      const composition = compositions.get(editor);
      const composed = !!composition?.pending;
      if (composition?.pending) {
        compositions.delete(editor);
        const inserted = editor.state.selection.from - composition.start;
        if (!editor.state.selection.empty || inserted <= 0 || inserted > text.length) return null;
        start = text.length - inserted;
      } else if (!text.startsWith(previous) || text.length === previous.length) return null;
      const inputEnd = text.length;
      const offset = Math.max(0, start - WINDOW);
      const source = (text + textAfterSelection(editor)).slice(offset);
      const span = codeSpanInInput(source, start - offset, inputEnd - offset);
      if (!span || span.end > source.length) return null;
      // TipTap requires the match to include the whole inserted text. The
      // opener may be inside a multi-character input (paste/IME commit).
      const openerAt = offset + span.start;
      const matchStart = Math.min(start, openerAt);
      const prefix = text.slice(matchStart);
      return { text: prefix, index: matchStart, data: {
        after: span.end - (inputEnd - offset),
        inputEnd: inputEnd - openerAt, prefixLength: start - matchStart,
        openerOffset: openerAt - matchStart,
        inserted: composed ? '' : text.slice(start), composed,
      } };
    },
    handler: ({ state, range, match }) => {
      const data = match.data as { after: number; inputEnd: number; prefixLength: number; openerOffset: number; inserted: string; composed: boolean };
      const { tr } = state;
      const spanEnd = range.to + Math.max(0, data.after);
      const $from = state.doc.resolve(range.from);
      if (!$from.parent.isTextblock || $from.parent.type.spec.code || spanEnd > $from.end()) return null;
      let invalid = false;
      state.doc.nodesBetween(range.from, spanEnd, node => {
        if (node.isInline && !node.isText) invalid = true;
        if (node.isText && node.marks.some(mark => mark.type === code)) invalid = true;
      });
      if (invalid) return null;
      // Keep each payload text node and its other marks in place. Only the two
      // delimiters disappear; the input and mark are one undoable transaction.
      if (!data.composed) tr.insertText(data.inserted, range.from + data.prefixLength, range.to);
      const open = tr.mapping.map(range.from, -1) + data.openerOffset;
      const end = tr.mapping.map(range.to, 1) + data.after;
      tr.delete(end - 1, end);
      tr.delete(open, open + 1);
      tr.addMark(open, end - 2, code.create());
      const inside = data.after > 0;
      const caret = inside ? open + Math.min(end - open - 2, data.inputEnd - 1) : tr.mapping.map(range.to, 1);
      tr.setSelection(TextSelection.create(tr.doc, caret));
      const caretMarks = tr.doc.resolve(caret).marks().filter(mark => mark.type !== code);
      tr.setStoredMarks(inside ? [...caretMarks, code.create()] : caretMarks);
    },
  });
}
