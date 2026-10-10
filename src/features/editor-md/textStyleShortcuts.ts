import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { commandBindings, resolveShortcut, shortcutFromEvent } from '../../core/shortcutBindings';
import { clearTextStyleMarks } from './textStyleMarks';
import { dispatchDiscreteEdit } from './discreteEdit';

/** The same remappable command in small caption/draft/cell editors, without
 * importing the document view, media controls or a second editor instance. */
export function handleTextStyleShortcut(view: EditorView, event: KeyboardEvent, clear?: () => boolean): boolean {
  if (event.defaultPrevented || event.isComposing || view.composing) return false;
  const command = resolveShortcut(event, 'markdown');
  if (command?.id !== 'markdown.clearStyles') {
    if (command || shortcutFromEvent(event) !== 'Ctrl+\\' || commandBindings('markdown.clearStyles').includes('Ctrl+\\')) return false;
  } else if (clear) clear();
  else {
    const tr = view.state.tr;
    if (clearTextStyleMarks(tr)) dispatchDiscreteEdit(view, tr);
  }
  event.preventDefault(); return true;
}
export const TextStyleKeys = Extension.create({
  name: 'textStyleKeys', priority: 1100,
  addProseMirrorPlugins() { return [new Plugin({ props: { handleDOMEvents: { keydown: handleTextStyleShortcut } } })]; },
});
