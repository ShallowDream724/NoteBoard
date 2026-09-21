import { InputRule } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { ReactNodeViewRenderer } from '@tiptap/react';
import 'katex/dist/katex.min.css';
import { MathNodeView } from './MathNodeView';
import { isDisplayMath, mathAtTextEnd } from './mathSyntax';
import { MathInlineNode, MathBlockNode, mathSource as source } from './documentNodes';
export { clearKatexCache } from './mathRendering';

export const MathInline = MathInlineNode.extend({
  addNodeView() { return ReactNodeViewRenderer(MathNodeView); },
  addInputRules() {
    return [new InputRule({
      find: (text) => {
        const match = mathAtTextEnd(text);
        return match ? { index: match.start, text: match.raw, data: { latex: match.latex, delimiter: match.delimiter } } : null;
      },
      handler: ({ state, range, match }) => {
        const { tr } = state;
        const math = source(match.data, false);
        const $from = tr.doc.resolve(range.from);
        if (isDisplayMath(math.delimiter) && $from.parent.type.name === 'paragraph'
          && $from.parentOffset === 0 && range.to === $from.end()) {
          tr.replaceWith($from.before(), $from.after(), this.editor.schema.nodes.mathBlock.create(math));
        } else {
          tr.replaceWith(range.from, range.to, this.type.create(math));
        }
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
