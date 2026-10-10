import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import { buildDocumentExtensions, parseMarkdownDocument } from '../../src/features/editor-md/documentExtensions';
import { setBlockColors } from '../../src/features/document-style/blockAppearance';
import { serializeNativeNode, parseNativeNode } from '../../src/features/editor-md/editorDocumentCodec';
import { serializeMarkdown } from '../../src/features/editor-md/serialize';
import { clearBlockFormatting, clearSelectionTextFormatting } from '../../src/features/editor-md/textFormatting';
import { renderDocument } from '../../src/features/export/renderDocument';
import { nativeTestEditor } from './nativeTestEditor';

const create = (content: string) => nativeTestEditor(new Editor({ extensions: buildDocumentExtensions(), content }));
const backspace = (editor: Editor) => editor.view.someProp('handleKeyDown', handler => handler(editor.view, new KeyboardEvent('keydown', { key: 'Backspace', keyCode: 8, bubbles: true })));
describe('block color defaults and independent inline color', () => {
  it('colors the full list item, preserves explicit text marks, and has one undo without moving the caret', () => {
    const editor = create('<ul><li><p>one <span data-text-color="#dc2626"><mark data-color="#fef08a">word</mark></span></p></li><li><p>two</p></li></ul>');
    try {
      editor.commands.setTextSelection(3);
      const before = editor.state.doc, selection = editor.state.selection, marks = before.firstChild!.firstChild!.firstChild!.lastChild!.marks;
      expect(setBlockColors(editor, 1, { color: '#2563eb', background: '#fff7ed' })).toBe(true);
      const item = editor.state.doc.nodeAt(1)!;
      expect(item.attrs).toMatchObject({ blockTextColor: '#2563eb', blockBackground: '#fff7ed' });
      expect(item.firstChild!.lastChild!.marks).toEqual(marks);
      expect(editor.state.selection.eq(selection)).toBe(true);
      const dom = editor.view.dom.querySelector('li')!;
      expect(dom.dataset.blockBackground).toBe('#fff7ed');
      expect(dom.style.color).toBe('rgb(37, 99, 235)');
      editor.commands.undo(); expect(editor.state.doc.eq(before)).toBe(true);
      editor.commands.redo(); expect(editor.state.doc.nodeAt(1)!.attrs.blockBackground).toBe('#fff7ed');
    } finally { editor.destroy(); }
  });
  it('retains row background after deleting text, removes it when deleting the last empty row, and undoes independently', () => {
    const editor = create('<p>word</p>');
    try {
      setBlockColors(editor, 0, { background: '#fff7ed' });
      editor.commands.deleteRange({ from: 1, to: 5 });
      expect(editor.state.doc.firstChild!.attrs.blockBackground).toBe('#fff7ed');
      editor.commands.setTextSelection(1);
      expect(backspace(editor)).toBe(true);
      expect(editor.state.doc.firstChild!.attrs.blockBackground).toBeNull();
      editor.commands.undo(); expect(editor.state.doc.firstChild!.attrs.blockBackground).toBe('#fff7ed');
      expect(editor.state.doc.textContent).toBe('');
      editor.commands.undo(); expect(editor.state.doc.textContent).toBe('word');
    } finally { editor.destroy(); }
  });
  it('deleting a colored empty row removes only that row, including undo', () => {
    const editor = create('<p>before</p><p></p><p>after</p>');
    try {
      const pos = editor.state.doc.firstChild!.nodeSize;
      setBlockColors(editor, pos, { background: '#fff7ed' });
      const before = editor.state.doc;
      editor.commands.setTextSelection(pos + 1); backspace(editor);
      expect(editor.state.doc.childCount).toBe(2);
      expect(editor.state.doc.textContent).toBe('beforeafter');
      expect(editor.state.doc.firstChild!.attrs.blockBackground).toBeNull();
      editor.commands.undo(); expect(editor.state.doc.eq(before)).toBe(true);
    } finally { editor.destroy(); }
  });
  it('roundtrips through NB and Markdown and exports task/list backgrounds with independent inline highlights', async () => {
    const editor = create('<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>A <mark data-color="#fef08a">task</mark></p></li></ul><blockquote><p>quote</p></blockquote>');
    try {
      setBlockColors(editor, 1, { color: '#2563eb', background: '#fff7ed' });
      setBlockColors(editor, editor.state.doc.firstChild!.nodeSize, { background: '#dbeafe' });
      expect(parseNativeNode(serializeNativeNode(editor.state.doc), editor.schema).eq(editor.state.doc)).toBe(true);
      // The editor adds an unstyled typing paragraph after a terminal container.
      expect(parseMarkdownDocument(serializeMarkdown(editor)).toJSON().content).toEqual(editor.getJSON().content!.slice(0, 2));
      const exported = await renderDocument('', 'test', '', undefined, editor.state.doc);
      const root = document.createElement('div'); root.innerHTML = exported.html;
      expect(root.querySelector('li')!.dataset.blockBackground).toBe('#fff7ed');
      expect(root.querySelector('li mark')).not.toBeNull();
      expect(root.querySelector('.export-task-check path')).not.toBeNull();
    } finally { editor.destroy(); }
  });
  it('preserves shared paragraph colors for partial text clearing and resets them for whole-block clearing with an independent undo', () => {
    const editor = create('<p><strong>text</strong></p>');
    try {
      setBlockColors(editor, 0, { color: '#2563eb', background: '#fff7ed' });
      editor.commands.setTextSelection({ from: 1, to: 3 }); clearSelectionTextFormatting(editor);
      expect(editor.state.doc.firstChild!.attrs).toMatchObject({ blockTextColor: '#2563eb', blockBackground: '#fff7ed' });
      expect(editor.state.doc.firstChild!.firstChild!.marks).toHaveLength(0);
      expect(editor.state.doc.firstChild!.lastChild!.marks.map(mark => mark.type.name)).toContain('bold');
      const partiallyCleared = editor.state.doc;
      editor.commands.setTextSelection(1);
      expect(clearBlockFormatting(editor, 0)).toBe(true);
      expect(editor.state.doc.firstChild!.attrs).toMatchObject({ blockTextColor: null, blockBackground: null });
      expect(editor.state.doc.firstChild!.firstChild!.marks).toHaveLength(0);
      editor.commands.undo(); expect(editor.state.doc.eq(partiallyCleared)).toBe(true);
    } finally { editor.destroy(); }
  });
});
