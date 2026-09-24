import { Extension } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';

/** Interactive conveniences only; never reinterpret imported Markdown. */
export const MarkdownTypingKeys = Extension.create({
  name: 'markdownTypingKeys',
  priority: 1100,
  addKeyboardShortcuts() {
    return {
      ...Object.fromEntries(([1, 2, 3, 4, 5, 6] as const).map(level =>
        [`Mod-${level}`, () => this.editor.commands.setHeading({ level })])),
      'Mod-0': () => this.editor.commands.setParagraph(),
      Enter: () => {
        const { state, view } = this.editor;
        const { $from, empty } = state.selection;
        if (view.composing || !empty || $from.parent.type.name !== 'paragraph'
          || $from.parentOffset !== $from.parent.content.size || $from.parent.textContent !== '···') return false;
        if (!this.editor.can().setCodeBlock()) return false;
        const tr = closeHistory(state.tr).delete($from.start(), $from.end())
          .setBlockType($from.before(), $from.before() + 1, state.schema.nodes.codeBlock).setStoredMarks(null);
        view.dispatch(tr.scrollIntoView());
        return true;
      },
    };
  },
});
