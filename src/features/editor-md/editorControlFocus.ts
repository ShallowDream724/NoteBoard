import type { EditorView } from '@tiptap/pm/view';

/** Controls inside the document keep their own caret while their owner survives.
 * Mark the control host, rather than enumerating formula/caption/node types. */
export function focusedEditorControl(view: EditorView): HTMLElement | null {
  const active = view.dom.ownerDocument.activeElement;
  return active instanceof HTMLElement && view.dom.contains(active)
    && active.matches('textarea,input,[contenteditable="true"],[contenteditable="plaintext-only"]')
    && active.closest('[data-editor-control]') ? active : null;
}
