import { Extension, InputRule, PasteRule, getTextContentFromNodes, type AnyExtension, type Editor } from '@tiptap/core';
import type { Transaction } from '@tiptap/pm/state';
import type { MarkdownManager } from '@tiptap/markdown';
import { formattingMatches, type FormattingMatch, type FormattingMark } from './inlineFormatting';

const names = new Set(['bold', 'italic', 'strike', 'highlight', 'underline']);
export function withoutFormattingRules(extension: AnyExtension): AnyExtension {
  return names.has(extension.name) ? extension.extend({ addInputRules: () => [], addPasteRules: () => [] }) : extension;
}
const grammar = (editor: Editor) => (editor.storage.markdown?.manager as MarkdownManager | undefined)?.instance;

function applyFormatting(tr: Transaction, from: number, match: FormattingMatch) {
  const offset = from - match.from;
  // Mark first, then remove delimiters from the end. Transaction mapping keeps
  // existing marks/text intact and gives nested formatting one undo step.
  for (const span of match.spans) {
    const type = tr.doc.type.schema.marks[span.mark];
    if (type) tr.addMark(offset + span.contentFrom, offset + span.contentTo, type.create());
  }
  const ranges = match.spans.flatMap(span => [
    { from: offset + span.from, to: offset + span.contentFrom },
    { from: offset + span.contentTo, to: offset + span.to },
  ]).sort((a, b) => b.from - a.from);
  for (const range of ranges) tr.delete(range.from, range.to);
  for (const name of names) if (tr.doc.type.schema.marks[name]) tr.removeStoredMark(tr.doc.type.schema.marks[name]);
}

/** The input-rule plugin already suspends rules during IME composition. Both
 * typing and pasting use the same token boundaries as open/import/export. */
export const InlineFormattingInput = Extension.create<{ canApply: (editor: Editor, marks: readonly FormattingMark[]) => boolean }>({
  name: 'inlineFormattingInput',
  addOptions() { return { canApply: () => true }; },
  addInputRules() {
    const editor = this.editor;
    return [new InputRule({
      find: text => {
        if (!/[*_~+=]$/.test(text)) return null;
        const instance = grammar(editor); if (!instance) return null;
        const previous = getTextContentFromNodes(editor.state.selection.$from);
        if (!text.startsWith(previous)) return null;
        const { $to } = editor.state.selection;
        const after = $to.parent.textBetween($to.parentOffset, Math.min($to.parent.content.size, $to.parentOffset + 2), '', '\ufffc');
        // Tiptap's node-based 500-character window can include an entire long
        // text node. Bound our lexer explicitly, including that case.
        const cut = Math.max(0, text.length - 4096);
        const match = formattingMatches(instance, text.slice(cut) + after).find(item => item.to === text.length - cut);
        if (!match || cut > 0 && match.from === 0) return null;
        if (!this.options.canApply(editor, match.spans.map(span => span.mark))) return null;
        // While __ / *** is still being closed, do not turn its first closer
        // into italic and consume an opener intended for the longer run.
        const run = /^[*_]+/.exec(match.raw)?.[0];
        if (run && (text[cut + match.from - 1] === run[0] || match.spans
          .filter(span => span.from >= match.from && span.contentFrom <= match.from + run.length)
          .reduce((length, span) => length + span.contentFrom - span.from, 0) < run.length)) return null;
        return { index: cut + match.from, text: match.raw, data: { match, inserted: text.slice(previous.length) } };
      },
      handler: ({ state, range, match }) => {
        const data = match.data as { match: FormattingMatch; inserted: string };
        const { tr } = state;
        if (data.inserted) tr.insertText(data.inserted, state.selection.from, range.to);
        applyFormatting(tr, range.from, data.match);
      },
    })];
  },
  addPasteRules() {
    const editor = this.editor;
    return [new PasteRule({
      find: text => {
        const instance = grammar(editor); if (!instance || !/[*_~+=]/.test(text)) return [];
        return formattingMatches(instance, text).filter(match => this.options.canApply(editor, match.spans.map(span => span.mark)))
          .map(match => ({ index: match.from, text: match.raw, data: match }));
      },
      handler: ({ state, range, match }) => {
        const data = match.data as FormattingMatch;
        let code = false;
        state.doc.nodesBetween(range.from, range.to, node => { if (node.type.spec.code || node.marks.some(mark => mark.type.spec.code)) code = true; });
        if (code) return null;
        applyFormatting(state.tr, range.from, data);
      },
    })];
  },
});
