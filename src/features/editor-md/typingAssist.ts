import { Extension } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import { Plugin } from '@tiptap/pm/state';
import { headingShortcut } from './headingShortcut';

/** Interactive conveniences only; never reinterpret imported Markdown. */
export const MarkdownTypingKeys = Extension.create({
  name: 'markdownTypingKeys',
  priority: 1100,
  addProseMirrorPlugins() {
    return [new Plugin({ props: { handleDOMEvents: { keydown: (_view, event) => {
      const level = headingShortcut(event);
      if (level === null) return false;
      const applied = level === 0 ? this.editor.commands.setParagraph() : this.editor.commands.setHeading({ level });
      if (applied) event.preventDefault();
      return applied;
    } } } })];
  },
  addKeyboardShortcuts() {
    return {
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
