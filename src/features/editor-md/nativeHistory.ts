import { history, redoDepth, undoDepth } from '@tiptap/pm/history';
import type { AnyExtension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

// The history factory publishes its shared PluginKey through Plugin.spec. Use
// that public handle rather than depending on private key strings/state fields.
const nativeHistoryKey = history().spec.key!;
const resetHistory = new PluginKey('noteboardNativeHistoryReset');

export function withNativeHistoryReset(plugin: Plugin): Plugin {
  const field = plugin.spec.state;
  if (plugin.spec.key !== nativeHistoryKey || !field) return plugin;
  return new Plugin({ ...plugin.spec, state: {
    init: field.init,
    apply(tr, value, previous, next) {
      return tr.getMeta(resetHistory) ? field.init({}, next) : field.apply(tr, value, previous, next);
    },
  } });
}

/** Only the main document uses application history. Embedded editors keep the
 * ordinary native UndoRedo extension and its commands/keyboard behavior. */
export function withApplicationHistory(extension: AnyExtension): AnyExtension {
  if (extension.name !== 'starterKit') return extension;
  return extension.extend({ addExtensions() {
    return (this.parent?.() ?? []).map(child => child.name !== 'undoRedo' ? child : child.extend({
      addProseMirrorPlugins() { return (this.parent?.() ?? []).map(withNativeHistoryReset); },
    }));
  } });
}

/** Application history owns navigation. Native history supplies grouping while
 * editing, but must not keep an unused copy of every edit across app undo/redo.
 * Reset only its state field through metadata. Plugin arrays/views, document and
 * selection remain intact; no document transaction is published. */
export function releaseNativeHistory(view: Pick<EditorView, 'state' | 'dispatch'>): boolean {
  const { state } = view;
  if (!undoDepth(state) && !redoDepth(state)) return false;
  if (!nativeHistoryKey.get(state)) return false;
  view.dispatch(state.tr.setMeta(resetHistory, true).setMeta('addToHistory', false));
  return true;
}
