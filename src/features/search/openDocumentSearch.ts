import { getEditorCapabilities } from '../../core/editor/editorRegistry';
import { useSearchStore } from '../../stores/searchStore';
import { useWindowStore } from '../../stores/windowStore';

export interface DocumentSearchSelection { key: string; text: string }

export function captureDocumentSearchSelection(): DocumentSearchSelection | undefined {
  const key = useWindowStore.getState().activeKey;
  if (!key) return;
  const focused = document.activeElement;
  if (focused?.closest('[data-document-search]')) return { key, text: '' };
  const selection = document.getSelection();
  // Native Shift+Arrow selection can reach the DOM just before ProseMirror
  // reports it. Read that visible selection before an overlay moves focus.
  if (focused?.matches('.ProseMirror') && selection && !selection.isCollapsed
    && focused.contains(selection.anchorNode) && focused.contains(selection.focusNode)) {
    const visibleText = selection.toString().replace(/\r?\n+/g, ' ');
    if (visibleText.trim()) return { key, text: visibleText };
  }
  return { key, text: getEditorCapabilities(key)?.getSelectedText() ?? '' };
}

export function openDocumentSearch(target: 'search' | 'replace', selection?: DocumentSearchSelection) {
  const key = useWindowStore.getState().activeKey;
  if (!key) return;
  const text = selection?.key === key ? selection.text : captureDocumentSearchSelection()?.text;
  useSearchStore.getState().openSearch(text?.trim() ? text : undefined, target);
}
