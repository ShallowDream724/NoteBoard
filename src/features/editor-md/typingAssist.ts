import { Extension } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import { NodeSelection, Plugin } from '@tiptap/pm/state';
import { resolveShortcut, isRetiredShortcut } from '../../core/shortcutBindings';
import { dispatchEditorShortcut } from './dispatchEditorShortcut';
import { useSettingsStore } from '../../stores/settingsStore';
import { selectionPresentation } from '../document-style/selectionPresentation';
import { setParagraphPresentation } from '../document-style/documentStyles';
import type { Editor } from '@tiptap/core';
import { dispatchDiscreteEdit } from './discreteEdit';

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

/** Delete only the empty paragraph, before the default input-rule undo shortcut. */
function removeEmptyParagraphAfterDivider(editor: Editor): boolean {
  const { state, view } = editor, { selection } = state, { $from } = selection;
  if (view.composing || !selection.empty || $from.parent.type.name !== 'paragraph' || $from.parent.content.size) return false;
  const start = $from.before(), parent = $from.node(-1), index = $from.index(-1);
  const divider = index > 0 ? parent.child(index - 1) : null;
  if (divider?.type.name !== 'horizontalRule' || !parent.canReplace(index, index + 1)) return false;
  const tr = state.tr.delete(start, $from.after());
  tr.setSelection(NodeSelection.create(tr.doc, start - divider.nodeSize));
  dispatchDiscreteEdit(view, tr.scrollIntoView());
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
      else if (Number(level) === 0) this.editor.commands.restoreParagraph();
      else this.editor.commands.setHeading({ level: Number(level) as 1|2|3|4|5|6 });
      event.preventDefault();
      return true;
    } } } })];
  },
  addKeyboardShortcuts() {
    return {
      Tab: () => handleProseTab(this.editor),
      'Shift-Tab': () => handleProseTab(this.editor, true),
      Backspace: () => removeEmptyParagraphAfterDivider(this.editor),
      Enter: () => {
        const { state, view } = this.editor;
        const { $from, empty } = state.selection;
        if (view.composing || !empty || $from.parent.type.name !== 'paragraph'
          || $from.parentOffset !== $from.parent.content.size) return false;
        const fence = /^···([^\s`·]+)?$/u.exec($from.parent.textContent);
        if (!fence) return false;
        const language = fence[1] ?? null;
        if (!this.editor.can().setCodeBlock({ language })) return false;
        const tr = closeHistory(state.tr).delete($from.start(), $from.end())
          .setBlockType($from.before(), $from.before() + 1, state.schema.nodes.codeBlock, { language }).setStoredMarks(null);
        view.dispatch(tr.scrollIntoView());
        return true;
      },
    };
  },
});
