import type { EditorView } from '@tiptap/pm/view';
import { engineShortcutEvent } from '../../core/editor/shortcutEvent';

/** Run a keymap without TipTap's transaction capture. History adapters must
 * observe the applied document immediately, including replacement metadata. */
export function dispatchEditorShortcut(view: EditorView, binding: string): boolean {
  const event = engineShortcutEvent(binding);
  return Boolean(view.someProp('handleKeyDown', handler => handler(view, event)));
}
