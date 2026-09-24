import { Prec } from '@codemirror/state';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import { resolveShortcut, isRetiredShortcut } from '../shortcutBindings';
import type { ShortcutContext } from '../shortcutCatalog';

/** Execute existing engine keymaps directly; never dispatch fake DOM input. */
export function engineShortcutEvent(binding: string) {
  const parts = binding.split('+'), key = parts.pop()!;
  return new KeyboardEvent('keydown', { key: key.length === 1 ? key.toLowerCase() : key,
    ctrlKey: parts.includes('Ctrl'), shiftKey: parts.includes('Shift'), altKey: parts.includes('Alt'), metaKey: parts.includes('Meta') });
}
export function customCodeMirrorShortcuts(context: ShortcutContext, execute?: (view: EditorView, id: string) => boolean | undefined) {
  return Prec.highest(EditorView.domEventHandlers({ keydown(event, view) {
    if (event.defaultPrevented || event.isComposing || view.composing) return false;
    const command = resolveShortcut(event, context);
    if (command) {
      execute?.(view, command.id) ?? runScopeHandlers(view, engineShortcutEvent(command.defaults[0]), 'editor');
      // A claimed command can be a no-op at a document boundary. Never fall
      // through to the library's unrelated action on this physical key.
      event.preventDefault();
      return true;
    }
    if (isRetiredShortcut(event, context)) { event.preventDefault(); return true; }
    return false;
  } }));
}
