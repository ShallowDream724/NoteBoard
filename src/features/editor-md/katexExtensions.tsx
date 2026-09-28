import { InputRule, getTextContentFromNodes, type Editor } from '@tiptap/core';
import { NodeSelection, Plugin } from '@tiptap/pm/state';
import { Fragment } from '@tiptap/pm/model';
import { ReactNodeViewRenderer } from '@tiptap/react';
import 'katex/dist/katex.min.css';
import { MathNodeView } from './MathNodeView';
import { isDisplayMath, mathClosingDelimiter, mathInInputRange, type MathMatch } from './mathSyntax';
import { MathInlineNode, MathBlockNode, mathSource as source } from './documentNodes';
import { handleMathKey } from './mathNavigation';
import { mathEditingRequestPlugin, requestMathEditing } from './mathEditingRequest';
export { clearKatexCache } from './mathRendering';

const compositions = new WeakMap<Editor, { start: number; pending: boolean }>();
type BatchMatch = Pick<MathMatch, 'start' | 'end' | 'latex' | 'delimiter'>;

/** Look ahead only through adjacent text: a closing delimiter can already exist
 * when the user supplies an opener or edits the formula body. Never consume an
 * existing image/formula atom, another block or an unbounded document suffix. */
function textAfterSelection(editor: Editor): string {
  const { $from, $to } = editor.state.selection;
  if (!$from.sameParent($to)) return '';
  const start = $to.parentOffset, end = Math.min($to.parent.content.size, start + 500);
  let text = '', stopped = false;
  $to.parent.nodesBetween(start, end, (node, pos) => {
    if (stopped) return false;
    if (!node.isText) { stopped = true; return false; }
    text += node.text!.slice(Math.max(0, start - pos), end - pos);
  });
  return text;
}

function batchInputMatch(text: string, start: number, inputEnd = text.length) {
  // TipTap can include a whole text node at the edge of its nominal window.
  // Bound our scan even when that node is a very long paragraph.
  const offset = Math.max(0, start - 500);
  text = text.slice(offset); start -= offset; inputEnd -= offset;
  const matches = mathInInputRange(text, start).filter(match => match.start < inputEnd);
  if (!matches.length) return null;
  const first = matches[0];
  const replaceStart = Math.min(start, first.start);
  const replaceEnd = Math.max(inputEnd, matches[matches.length - 1].end);
  return { index: offset + replaceStart, text: text.slice(replaceStart, inputEnd), data: {
    source: text.slice(replaceStart, replaceEnd), after: replaceEnd - inputEnd,
    batch: matches.map(({ start, end, latex, delimiter }) => ({ start: start - replaceStart, end: end - replaceStart, latex, delimiter })),
  } };
}

export const MathInline = MathInlineNode.extend({
  addNodeView() { return ReactNodeViewRenderer(MathNodeView); },
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [mathEditingRequestPlugin(), new Plugin({
      state: { init: () => null, apply(tr) {
        const span = compositions.get(editor);
        if (span) span.start = tr.mapping.map(span.start, -1);
        return null;
      } },
      props: { handleKeyDown: (view, event) => handleMathKey(view, event, 'mathInline'), handleDOMEvents: {
        compositionstart(view) {
          if (view.state.selection.$from.parent.isTextblock) compositions.set(editor, { start: view.state.selection.from, pending: false });
          return false;
        },
        compositionend() {
          const span = compositions.get(editor);
          if (span) {
            span.pending = true;
            // TipTap runs input rules after compositionend in a zero-delay task.
            // Retire a span if another rule consumed the event first.
            setTimeout(() => { if (compositions.get(editor) === span) compositions.delete(editor); }, 100);
          }
          return false;
        },
      } },
    })];
  },
  addInputRules() {
    return [new InputRule({
      find: (text) => {
        const composition = compositions.get(this.editor);
        if (composition?.pending) {
          compositions.delete(this.editor);
          const { selection } = this.editor.state;
          const inserted = selection.from - composition.start;
          if (!selection.empty || inserted <= 0 || inserted > text.length) return null;
          return batchInputMatch(text + textAfterSelection(this.editor), text.length - inserted, text.length);
        }
        const previous = getTextContentFromNodes(this.editor.state.selection.$from);
        if (!text.startsWith(previous)) return null;
        if (text.length === previous.length) return null;
        return batchInputMatch(text + textAfterSelection(this.editor), previous.length, text.length);
      },
      handler: ({ state, range, match }) => {
        const { tr } = state;
        const batch = match.data?.batch as BatchMatch[];
        const math = source(batch[0], false);
        const $from = tr.doc.resolve(range.from);
        const marks = tr.storedMarks ?? $from.marks();
        const raw = String(match.data?.source ?? match[0]), content = [];
        const to = range.to + Number(match.data?.after ?? 0);
        const caret = match[0].length;
        const active = batch.find(item => caret >= item.start + item.delimiter.length && caret <= item.end - mathClosingDelimiter(item.delimiter).length);
        let cursor = 0, offset = 0, activePos = range.from;
        for (const item of batch) {
          if (item.start > cursor) { content.push(this.editor.schema.text(raw.slice(cursor, item.start), marks)); offset += item.start - cursor; }
          if (item === active) activePos = range.from + offset;
          content.push(this.type.create(source(item, false), null, marks));
          offset++;
          cursor = item.end;
        }
        if (cursor < raw.length) content.push(this.editor.schema.text(raw.slice(cursor), marks));
        if (content.length === 1 && isDisplayMath(math.delimiter) && $from.parent.type.name === 'paragraph'
          && $from.parentOffset === 0 && to === $from.end()) {
          tr.replaceWith($from.before(), $from.after(), this.editor.schema.nodes.mathBlock.create(math));
          activePos = $from.before();
        } else tr.replaceWith(range.from, to, Fragment.fromArray(content));
        if (active) requestMathEditing(tr, activePos, Math.max(0, Math.min(active.latex.length, caret - active.start - active.delimiter.length)));
      },
    })];
  },
  addCommands() {
    return { insertMathInline: (latex: string) => ({ commands }: { commands: { insertContent: (content: unknown) => boolean } }) => (
      commands.insertContent({ type: this.name, attrs: { latex } })
    ) } as never;
  },
});

export const MathBlock = MathBlockNode.extend({
  addNodeView() { return ReactNodeViewRenderer(MathNodeView); },
  addProseMirrorPlugins() { return [new Plugin({ props: { handleKeyDown: (view, event) => handleMathKey(view, event, 'mathBlock') } })]; },
  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const { state, view } = this.editor;
        if (view.composing || !state.selection.empty) return false;
        const { $from } = state.selection;
        if ($from.parent.type.name !== 'paragraph' || $from.parentOffset !== $from.parent.content.size) return false;
        let code = false;
        $from.parent.forEach((child) => { if (child.marks.some((mark) => mark.type.spec.code)) code = true; });
        if (code) return false;
        const opener = $from.parent.textContent.trim();
        if (opener !== '$$' && opener !== '\\[' && opener !== '￥￥') return false;
        // Chinese IME convenience is an editing gesture, never a Markdown rewrite.
        const delimiter = opener === '￥￥' ? '$$' : opener;
        const pos = $from.before();
        const tr = state.tr.replaceWith(pos, $from.after(), this.type.create({ latex: '', delimiter }));
        tr.setSelection(NodeSelection.create(tr.doc, pos));
        view.dispatch(tr.scrollIntoView());
        return true;
      },
    };
  },
  addCommands() {
    return { insertMathBlock: (latex: string) => ({ commands }: { commands: { insertContent: (content: unknown) => boolean } }) => (
      commands.insertContent({ type: this.name, attrs: { latex } })
    ) } as never;
  },
});
