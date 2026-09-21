import { InputRule, Node, mergeAttributes, type MarkdownToken, type MarkdownTokenizer } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { ReactNodeViewRenderer } from '@tiptap/react';
import 'katex/dist/katex.min.css';
import { MathNodeView } from './MathNodeView';
import {
  findMathStart, isDisplayMath, mathAtTextEnd, readMath, readMathBlock, writeMath,
  type MathDelimiter, type MathSource,
} from './mathSyntax';
export { clearKatexCache } from './mathRendering';

type MathToken = MarkdownToken & MathSource;
const inlineTokenizer: MarkdownTokenizer = {
  name: 'mathInline', level: 'inline', start: findMathStart,
  tokenize(source) {
    const match = readMath(source);
    return match ? { type: 'mathInline', raw: match.raw, latex: match.latex, delimiter: match.delimiter } : undefined;
  },
};
const blockTokenizer: MarkdownTokenizer = {
  name: 'mathBlock', level: 'block',
  start: (source) => /^ {0,3}(?:\$\$|\\\[)/m.exec(source)?.index ?? -1,
  tokenize(source) {
    const match = readMathBlock(source);
    return match ? { type: 'mathBlock', raw: match.raw, latex: match.latex, delimiter: match.delimiter } : undefined;
  },
};
function attrs(block: boolean) {
  return { latex: { default: '' }, delimiter: { default: block ? '$$' : '$' } };
}
function source(attrs: Record<string, unknown> | undefined, block: boolean): MathSource {
  return { latex: String(attrs?.latex ?? ''), delimiter: (attrs?.delimiter ?? (block ? '$$' : '$')) as MathDelimiter };
}

export const MathInline = Node.create({
  name: 'mathInline', group: 'inline', inline: true, atom: true, selectable: true,
  addAttributes() { return attrs(false); },
  parseHTML() { return [{ tag: 'span[data-math-inline]' }]; },
  renderHTML({ HTMLAttributes }) { return ['span', mergeAttributes(HTMLAttributes, { 'data-math-inline': '' })]; },
  renderText({ node }) { return writeMath(source(node.attrs, false)); },
  addNodeView() { return ReactNodeViewRenderer(MathNodeView); },
  markdownTokenName: 'mathInline',
  markdownTokenizer: inlineTokenizer,
  parseMarkdown(token, helpers) { return helpers.createNode('mathInline', source(token as MathToken, false)); },
  renderMarkdown(node) { return writeMath(source(node.attrs, false)); },
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

export const MathBlock = Node.create({
  name: 'mathBlock', group: 'block', atom: true, selectable: true,
  addAttributes() { return attrs(true); },
  parseHTML() { return [{ tag: 'div[data-math-block]' }]; },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes(HTMLAttributes, { 'data-math-block': '' })]; },
  renderText({ node }) { return writeMath(source(node.attrs, true), true); },
  addNodeView() { return ReactNodeViewRenderer(MathNodeView); },
  markdownTokenName: 'mathBlock',
  markdownTokenizer: blockTokenizer,
  parseMarkdown(token, helpers) { return helpers.createNode('mathBlock', source(token as MathToken, true)); },
  renderMarkdown(node) { return writeMath(source(node.attrs, true), true); },
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
