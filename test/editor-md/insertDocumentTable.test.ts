import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table';
import { insertDocumentTable } from '../../src/features/editor-md/insertDocumentTable';
import { Disclosure } from '../../src/features/editor-md/rich-content/schema';

let editor: Editor;
const caretScroll = vi.fn(() => true);
beforeEach(() => {
  caretScroll.mockClear();
  editor = new Editor({ extensions: [StarterKit, Table, TableRow, TableCell, TableHeader, Disclosure],
    content: '<p>before</p><p></p>', editorProps: { handleScrollToSelection: caretScroll } });
});
afterEach(() => editor.destroy());

it('inserts a toolbar table with first-cell selection and one undo, without caret scrolling', () => {
  editor.commands.setTextSelection(editor.state.doc.content.size - 1);
  const before = editor.getJSON();
  expect(insertDocumentTable(editor, 3, 3)).toBe(true);
  expect(editor.state.doc.child(1).type.name).toBe('table');
  expect(editor.state.doc.child(1).childCount).toBe(3);
  expect(editor.state.doc.child(1).firstChild?.childCount).toBe(3);
  expect(editor.state.selection.$from.node(3).type.name).toBe('tableHeader');
  expect(caretScroll).not.toHaveBeenCalled();
  expect(editor.commands.undo()).toBe(true);
  expect(editor.getJSON()).toEqual(before);
});

it('deletes the slash query and inserts the table in one edit at the declared range', () => {
  editor.commands.setContent('<p>before</p><p>/table4</p>');
  const from = editor.state.doc.firstChild!.nodeSize + 1, to = from + '/table4'.length;
  editor.commands.setTextSelection(1);
  const before = editor.getJSON();
  expect(insertDocumentTable(editor, 4, 4, { from, to })).toBe(true);
  expect(editor.state.doc.firstChild?.textContent).toBe('before');
  expect(editor.state.doc.child(1).childCount).toBe(4);
  expect(editor.state.doc.textContent).not.toContain('/table4');
  expect(caretScroll).not.toHaveBeenCalled();
  expect(editor.commands.undo()).toBe(true);
  expect(editor.getJSON()).toEqual(before);
});

it('splits a text paragraph around a table without changing existing text', () => {
  editor.commands.setContent('<p>beforeafter</p>'); editor.commands.setTextSelection(7);
  expect(insertDocumentTable(editor, 2, 2)).toBe(true);
  expect(editor.state.doc.childCount).toBe(3);
  expect(editor.state.doc.child(0).textContent).toBe('before');
  expect(editor.state.doc.child(1).type.name).toBe('table');
  expect(editor.state.doc.child(2).textContent).toBe('after');
  expect(editor.state.selection.$from.node(1).type.name).toBe('table');
});

it('keeps a disclosure editable after its table while focusing the first cell', () => {
  editor.commands.setContent({ type: 'doc', content: [{ type: 'disclosure', content: [{ type: 'paragraph' }] }] });
  editor.commands.setTextSelection(2);
  expect(insertDocumentTable(editor, 3, 3)).toBe(true);
  expect(editor.state.doc.firstChild?.child(0).type.name).toBe('table');
  expect(editor.state.doc.firstChild?.child(1).type.name).toBe('paragraph');
  expect(editor.state.selection.$from.node(2).type.name).toBe('table');
});
