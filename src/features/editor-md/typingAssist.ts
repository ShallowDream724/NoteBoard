import { Extension } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import { Plugin } from '@tiptap/pm/state';
import { resolveShortcut, isRetiredShortcut } from '../../core/shortcutBindings';
import { dispatchEditorShortcut } from './dispatchEditorShortcut';
import { useSettingsStore } from '../../stores/settingsStore';
import { selectionPresentation } from '../document-style/selectionPresentation';
import { setParagraphPresentation } from '../document-style/documentStyles';
import type { Editor } from '@tiptap/core';

/** Tables, list nesting and embedded code editors retain their own Tab keys. */
export function handleProseTab(editor: Editor, backwards = false): boolean {
  const { state, view } = editor, { selection } = state;
  if (view.composing) return false;
  const scope = selectionPresentation(state);
  if (scope.cells) return false;
  for (let depth = selection.$from.depth; depth > 0; depth--) {
    if (['listItem', 'taskItem', 'codeBlock'].includes(selection.$from.node(depth).type.name)) return false;
  }
  if (scope.indentBlocks.length && scope.indentBlocks.every(({ node }) => ['heading', 'horizontalRule'].includes(node.type.name))) {
    setParagraphPresentation(editor, { indentBy: backwards ? -1 : 1 });
    return true;
  }
  if (backwards || !selection.$from.sameParent(selection.$to) || selection.$from.parent.type.name !== 'paragraph') return false;
  const settings = useSettingsStore.getState().settings.editor;
  const size = Math.max(1, Math.min(8, Math.trunc(settings.tabSize) || 2));
  view.dispatch(state.tr.insertText(settings.insertSpaces === false ? '\t' : ' '.repeat(size)).scrollIntoView());
  return true;
}

/** Interactive conveniences only; never reinterpret imported Markdown. */
export const MarkdownTypingKeys = Extension.create({
  name: 'markdownTypingKeys',
  priority: 1100,
  addProseMirrorPlugins() {
    return [new Plugin({ props: { handleDOMEvents: { keydown: (view, event) => {
      if (event.defaultPrevented || event.isComposing) return false;
      const command = resolveShortcut(event, 'markdown');
      if (!command) {
        if (isRetiredShortcut(event, 'markdown')) { event.preventDefault(); return true; }
        return false;
      }
      const level = /^markdown\.heading([0-6])$/.exec(command.id)?.[1];
      if (level === undefined) dispatchEditorShortcut(view, command.defaults[0]);
      else if (Number(level) === 0) this.editor.commands.setParagraph();
      else this.editor.commands.setHeading({ level: Number(level) as 1|2|3|4|5|6 });
      event.preventDefault();
      return true;
    } } } })];
  },
  addKeyboardShortcuts() {
    return {
      Tab: () => handleProseTab(this.editor),
      'Shift-Tab': () => handleProseTab(this.editor, true),
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
