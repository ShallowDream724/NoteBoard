import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import { AllSelection, Selection, TextSelection } from '@tiptap/pm/state';
import { CellSelection } from '@tiptap/pm/tables';
import { buildDocumentExtensions } from '../../src/features/editor-md/documentExtensions';
import { ContainerContentSelection, ContainerSelectAll } from '../../src/features/editor-md/containerSelection';
import { useToastStore } from '../../src/stores/toastStore';

const editors: Editor[] = [];
const p = (text: string): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const image: JSONContent = { type: 'image', attrs: { src: 'one.png' } };
function create(content: JSONContent[]) {
  const editor = new Editor({ extensions: [...buildDocumentExtensions(), ContainerSelectAll], content: { type: 'doc', content } });
  editors.push(editor); return editor;
}
function cursor(editor: Editor, text: string) {
  editor.state.doc.descendants((node, pos) => { if (node.isText && node.text === text) editor.commands.setTextSelection(pos + 1); });
}
function selectAll(editor: Editor, repeat = false) {
  const event = new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, repeat, bubbles: true, cancelable: true });
  editor.view.dom.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
}
afterEach(() => { editors.splice(0).forEach(editor => editor.destroy()); useToastStore.setState({ toasts: [] }); });

describe('container-first select all', () => {
  it.each(['githubAlert', 'disclosure', 'blockquote', 'codeBlock', 'bulletList', 'orderedList', 'taskList', 'imageCollection'])('%s selects its content then the document', type => {
    const content: JSONContent[] = type === 'codeBlock' ? [{ type: 'text', text: 'inside' }]
      : type.endsWith('List') ? [{ type: type === 'taskList' ? 'taskItem' : 'listItem', content: [p('inside')] }]
      : type === 'imageCollection' ? [{ type: 'imageSlot', content: [image, p('inside')] }]
      : [image, p('inside'), image];
    const editor = create([p('before'), { type, content }, p('after')]); cursor(editor, 'inside');
    const before = editor.state.doc, at = before.firstChild!.nodeSize, node = before.nodeAt(at)!;
    selectAll(editor);
    expect(editor.state.selection.from).toBe(at + 1); expect(editor.state.selection.to).toBe(at + node.nodeSize - 1);
    expect(editor.state.doc).toBe(before);
    expect(useToastStore.getState().toasts).toHaveLength(1);
    selectAll(editor, true); expect(editor.state.selection).not.toBeInstanceOf(AllSelection);
    selectAll(editor); expect(editor.state.selection).toBeInstanceOf(AllSelection);
    expect(useToastStore.getState().toasts).toHaveLength(1);
  });
  it('selects the nearest nested container, then jumps directly to the whole document', () => {
    const editor = create([{ type: 'githubAlert', content: [p('outer'), { type: 'disclosure', content: [p('inside')] }] }, p('after')]);
    cursor(editor, 'inside'); selectAll(editor);
    expect(editor.state.selection.$from.parent.type.name).toBe('disclosure');
    selectAll(editor); expect(editor.state.selection).toBeInstanceOf(AllSelection);
  });
  it('uses all table cells, retaining the table and its properties when clearing content', () => {
    const cell = (text: string) => ({ type: 'tableCell', content: [p(text)] });
    const editor = create([{ type: 'table', content: [{ type: 'tableRow', content: [cell('inside'), cell('other')] }] }, p('after')]);
    cursor(editor, 'inside'); selectAll(editor);
    const selection = editor.state.selection as CellSelection;
    expect(selection).toBeInstanceOf(CellSelection); expect(selection.isRowSelection() && selection.isColSelection()).toBe(true);
    selectAll(editor); expect(editor.state.selection).toBeInstanceOf(AllSelection);
  });
  it('resets after a pointer action or edit and leaves ordinary paragraphs as one-step full selection', () => {
    const editor = create([{ type: 'githubAlert', content: [p('inside')] }, p('after')]);
    cursor(editor, 'inside'); selectAll(editor);
    vi.spyOn(editor.view, 'posAtCoords').mockReturnValue(null);
    editor.view.dom.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); selectAll(editor);
    expect(editor.state.selection).toBeInstanceOf(ContainerContentSelection);
    editor.commands.insertContent('replacement'); selectAll(editor);
    expect(editor.state.selection).toBeInstanceOf(ContainerContentSelection);
    cursor(editor, 'after'); selectAll(editor); expect(editor.state.selection).toBeInstanceOf(AllSelection);
  });
  it('deletes all rich content including boundary images, preserving the wrapper, with undo and selection serialization', () => {
    const editor = create([{ type: 'githubAlert', content: [image, p('inside'), image] }, p('after')]);
    cursor(editor, 'inside'); selectAll(editor);
    const before = editor.state.doc, selection = editor.state.selection;
    expect(Selection.fromJSON(before, selection.toJSON()).eq(selection)).toBe(true);
    editor.commands.deleteSelection();
    expect(editor.state.doc.firstChild!.type.name).toBe('githubAlert');
    expect(editor.state.doc.firstChild!.firstChild!.type.name).toBe('paragraph');
    expect(editor.state.doc.firstChild!.childCount).toBe(1);
    expect(editor.state.doc.lastChild!.textContent).toBe('after');
    editor.commands.undo(); expect(editor.state.doc.eq(before)).toBe(true);
    expect(editor.state.selection.eq(selection)).toBe(true);
  });
  it('handles an empty code block without selecting outside it on the first press', () => {
    const editor = create([{ type: 'codeBlock' }, p('after')]); editor.commands.setTextSelection(1);
    selectAll(editor); expect(editor.state.selection).toBeInstanceOf(TextSelection); expect(editor.state.selection.empty).toBe(true);
    selectAll(editor); expect(editor.state.selection).toBeInstanceOf(AllSelection);
  });
});
