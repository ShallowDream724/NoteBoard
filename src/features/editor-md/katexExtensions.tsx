import { InputRule, type Editor } from '@tiptap/core';
import { NodeSelection, Plugin } from '@tiptap/pm/state';
import { Fragment } from '@tiptap/pm/model';
import { ReactNodeViewRenderer } from '@tiptap/react';
import 'katex/dist/katex.min.css';
import { MathNodeView } from './MathNodeView';
import { isDisplayMath, mathInInputRange, type MathMatch } from './mathSyntax';
import { MathInlineNode, MathBlockNode, mathSource as source } from './documentNodes';
export { clearKatexCache } from './mathRendering';

const compositions = new WeakMap<Editor, { start: number; pending: boolean }>();
type BatchMatch = Pick<MathMatch, 'start' | 'end' | 'latex' | 'delimiter'>;

/** Match TipTap's 500-character input-rule window so only this input batch is
 * considered, even when the caret sits inside a long paragraph. */
function textBeforeCaret(editor: Editor): string {
  const { $from } = editor.state.selection;
  const end = $from.parentOffset;
  let text = '';
  $from.parent.nodesBetween(Math.max(0, end - 500), end, (node, pos, parent, index) => {
    const chunk = node.type.spec.toText?.({ node, pos, parent, index }) || node.textContent || '%leaf%';
    text += node.isAtom && !node.isText ? chunk : chunk.slice(0, Math.max(0, end - pos));
  });
  return text;
}

function batchInputMatch(text: string, start: number) {
  const matches = mathInInputRange(text, start);
  if (!matches.length) return null;
  const first = matches[0];
  const replaceStart = Math.min(start, first.start);
  return { index: replaceStart, text: text.slice(replaceStart), data: {
    batch: matches.map(({ start, end, latex, delimiter }) => ({ start: start - replaceStart, end: end - replaceStart, latex, delimiter })),
  } };
}

export const MathInline = MathInlineNode.extend({
  addNodeView() { return ReactNodeViewRenderer(MathNodeView); },
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [new Plugin({
      state: { init: () => null, apply(tr) {
        const span = compositions.get(editor);
        if (span) span.start = tr.mapping.map(span.start, -1);
        return null;
      } },
      props: { handleDOMEvents: {
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
          return batchInputMatch(text, text.length - inserted);
        }
        const previous = textBeforeCaret(this.editor);
        if (!text.startsWith(previous)) return null;
        const input = text.slice(previous.length);
        if (!/[$)\]]/.test(input)) return null;
        return batchInputMatch(text, previous.length);
      },
      handler: ({ state, range, match }) => {
        const { tr } = state;
        const batch = match.data?.batch as BatchMatch[];
        const math = source(batch[0], false);
        const $from = tr.doc.resolve(range.from);
        const marks = tr.storedMarks ?? $from.marks();
        const raw = match[0], content = [];
        let cursor = 0;
        for (const item of batch) {
          if (item.start > cursor) content.push(this.editor.schema.text(raw.slice(cursor, item.start), marks));
          content.push(this.type.create(source(item, false), null, marks));
          cursor = item.end;
        }
        if (cursor < raw.length) content.push(this.editor.schema.text(raw.slice(cursor), marks));
        if (content.length === 1 && isDisplayMath(math.delimiter) && $from.parent.type.name === 'paragraph'
          && $from.parentOffset === 0 && range.to === $from.end()) {
          tr.replaceWith($from.before(), $from.after(), this.editor.schema.nodes.mathBlock.create(math));
        } else tr.replaceWith(range.from, range.to, Fragment.fromArray(content));
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
