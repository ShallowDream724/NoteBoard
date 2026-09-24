import { Extension } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import { Plugin } from '@tiptap/pm/state';
import { resolveShortcut, isRetiredShortcut } from '../../core/shortcutBindings';

/** Interactive conveniences only; never reinterpret imported Markdown. */
export const MarkdownTypingKeys = Extension.create({
  name: 'markdownTypingKeys',
  priority: 1100,
  addProseMirrorPlugins() {
    return [new Plugin({ props: { handleDOMEvents: { keydown: (_view, event) => {
      if (event.defaultPrevented || event.isComposing) return false;
      const command = resolveShortcut(event, 'markdown');
      if (!command) {
        if (isRetiredShortcut(event, 'markdown')) { event.preventDefault(); return true; }
        return false;
      }
      const level = /^markdown\.heading([0-6])$/.exec(command.id)?.[1];
      level !== undefined ? Number(level) === 0 ? this.editor.commands.setParagraph() : this.editor.commands.setHeading({ level: Number(level) as 1|2|3|4|5|6 })
        : this.editor.commands.keyboardShortcut(command.defaults[0].replaceAll('+', '-').replace('Ctrl-', 'Mod-'));
      event.preventDefault();
      return true;
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
