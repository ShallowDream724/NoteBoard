import { getEditorCapabilities } from '../../core/editor/editorRegistry';
import { useWindowStore } from '../../stores/windowStore';
import { saveViewState } from '../session/editorSuspension';

export type FilePreviewMode = 'preview' | 'source';

export function useFilePreviewMode(docKey: string): FilePreviewMode {
  return useWindowStore(state => state.getTab(docKey)?.viewMode === 'source' ? 'source' : 'preview');
}

export function switchFilePreviewMode(docKey: string, mode: FilePreviewMode) {
  const store = useWindowStore.getState(), tab = store.getTab(docKey);
  if (!tab || store.isTransferring(docKey) || (tab.viewMode === 'source') === (mode === 'source')) return;
  if (mode === 'preview') {
    // Capture before unmount: CodeMirror materializes any pending edits alongside the caret.
    const snapshot = getEditorCapabilities(docKey)?.captureViewState?.();
    if (snapshot) saveViewState(docKey, snapshot);
  }
  store.setTabViewMode(docKey, mode === 'source' ? 'source' : 'visual');
}

export function toggleFilePreviewMode(docKey: string) {
  const tab = useWindowStore.getState().getTab(docKey);
  if (tab) switchFilePreviewMode(docKey, tab.viewMode === 'source' ? 'preview' : 'source');
}
