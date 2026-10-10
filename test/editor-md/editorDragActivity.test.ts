import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { buildDocumentExtensions } from '@/features/editor-md/documentExtensions';
import { beginEditorDrag, EditorDragActivity, isEditorDragging } from '@/features/editor-md/editorDragActivity';

const editors: Editor[] = [];
function create() {
  const editor = new Editor({ element: document.body.appendChild(document.createElement('div')), extensions: [...buildDocumentExtensions(), EditorDragActivity], content: '<p>text</p>' });
  editors.push(editor); return editor;
}
afterEach(() => { editors.splice(0).forEach(editor => editor.destroy()); document.body.replaceChildren(); });
describe('temporary editor drag ownership', () => {
  it('keeps overlapping gestures suppressed without editing content, selection or history', () => {
    const editor = create(); editor.commands.setTextSelection({ from: 1, to: 5 });
    const doc = editor.state.doc, selection = editor.state.selection;
    const first = beginEditorDrag(editor.view), second = beginEditorDrag(editor.view);
    expect(isEditorDragging(editor.view)).toBe(true); first(); first();
    expect(isEditorDragging(editor.view)).toBe(true); second();
    expect(isEditorDragging(editor.view)).toBe(false);
    expect(editor.view.dom.classList.contains('nb-editor-dragging')).toBe(false);
    expect(editor.state.doc).toBe(doc); expect(editor.state.selection.eq(selection)).toBe(true);
    expect(editor.commands.undo()).toBe(false);
  });
  it('releases native gestures on outside drop, blur and view destruction', () => {
    const editor = create();
    editor.view.dom.dispatchEvent(new Event('dragstart'));
    expect(isEditorDragging(editor.view)).toBe(true);
    document.dispatchEvent(new Event('drop')); expect(isEditorDragging(editor.view)).toBe(false);
    editor.view.dom.dispatchEvent(new Event('dragstart'));
    editor.view.dragging = { slice: editor.state.doc.slice(1, 5), move: true };
    window.dispatchEvent(new Event('blur'));
    expect(isEditorDragging(editor.view)).toBe(false);
    const view = editor.view, end = beginEditorDrag(view);
    editor.destroy(); end(); expect(isEditorDragging(view)).toBe(false);
  });
});
