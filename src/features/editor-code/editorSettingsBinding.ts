import { ViewPlugin, type EditorView } from '@codemirror/view';
import { useSettingsStore } from '../../stores/settingsStore';
import { editorDisplayEffects, type BaseExtensionsOptions } from './setup';

const displayKeys = ['showWhitespace', 'showLineEndings', 'showLineNumbers', 'softWrap', 'tabSize', 'insertSpaces', 'showIndentGuides'] as const;

/** Lifetime follows the actual CM instance, including lazily-created Markdown source views. */
export function bindLiveEditorSettings(readOptions: () => BaseExtensionsOptions) {
  return ViewPlugin.fromClass(class {
    private dispose: () => void;
    private destroyed = false;
    private scheduled = false;
    constructor(view: EditorView) {
      this.dispose = useSettingsStore.subscribe((next, previous) => {
        if (displayKeys.every(key => next.settings.editor[key] === previous.settings.editor[key]) || this.scheduled) return;
        this.scheduled = true;
        queueMicrotask(() => {
          this.scheduled = false;
          if (!this.destroyed) view.dispatch({ effects: editorDisplayEffects(readOptions()) });
        });
      });
    }
    destroy() { this.destroyed = true; this.dispose(); }
  });
}

export const liveEditorSettings = bindLiveEditorSettings(() => useSettingsStore.getState().settings.editor);
