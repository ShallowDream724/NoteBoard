import { afterEach, describe, expect, it } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import { AllSelection, NodeSelection, TextSelection } from '@tiptap/pm/state';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import { buildDocumentExtensions } from '@/features/editor-md/documentExtensions';
import { clearBlockFormatting, clearSelectionTextFormatting } from '@/features/editor-md/textFormatting';
import { imageCollectionTemplate } from '@/features/editor-md/rich-content/commands';
import { nativeTestEditor } from './nativeTestEditor';
import { restoreBlockParagraph } from '@/features/editor-md/blockActions';
import { clearDraftTextFormatting } from '@/features/editor-md/annotations/bodyFormatting';

const editors: Editor[] = [];
const p = (text: string, attrs = {}): JSONContent => ({ type: 'paragraph', attrs, content: [{ type: 'text', text, marks: [{ type: 'bold' }, { type: 'link', attrs: { href: 'https://example.com' } }] }] });
const color = { blockTextColor: '#aa0000', blockBackground: '#ffeecc', textAlign: 'center' };
function create(content: JSONContent[]) {
  const editor = nativeTestEditor(new Editor({ extensions: buildDocumentExtensions(), content: { type: 'doc', content } }));
  editors.push(editor); return editor;
}
afterEach(() => editors.splice(0).forEach(editor => editor.destroy()));

describe('reset boundaries keep content and layout separate', () => {
  it.each(['selection', 'block'])('clears a complete paragraph appearance through %s while keeping links', entry => {
    const editor = create([p('colored', color), p('tail')]), before = editor.state.doc;
    if (entry === 'selection') { editor.commands.setTextSelection({ from: 1, to: 8 }); clearSelectionTextFormatting(editor); }
    else clearBlockFormatting(editor, 0);
    const paragraph = editor.state.doc.firstChild!;
    expect(paragraph.attrs).toMatchObject({ blockTextColor: null, blockBackground: null, textAlign: null });
    expect(paragraph.firstChild!.marks.map(mark => mark.type.name)).toEqual(['link']);
    editor.commands.undo(); expect(editor.state.doc.eq(before)).toBe(true);
  });
  it('does not change the shared paragraph color or unselected text during a partial clear', () => {
    const editor = create([p('colored', color), p('tail')]);
    editor.commands.setTextSelection({ from: 2, to: 4 }); clearSelectionTextFormatting(editor);
    const paragraph = editor.state.doc.firstChild!;
    expect(paragraph.attrs).toMatchObject(color);
    expect(paragraph.firstChild!.marks.some(mark => mark.type.name === 'bold')).toBe(true);
    expect(paragraph.child(1).marks.map(mark => mark.type.name)).toEqual(['link']);
  });
  it('clears selected cell text but keeps the colored formula, cell fill and table alignment', () => {
    const editor = create([{ type: 'table', attrs: { tableAlign: 'right' }, content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [p('cell', color), { type: 'mathBlock', attrs: { latex: 'x+1', textAlign: 'right', textColor: '#123456', background: '#ffeecc' } }] }] }] }, p('tail')]);
    const before = editor.state.doc, table = before.firstChild!, map = TableMap.get(table), formula = table.firstChild!.firstChild!.lastChild!;
    expect(formula.attrs).toMatchObject({ textAlign: 'right', textColor: '#123456', background: '#ffeecc' });
    editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(before, 1 + map.map[0])));
    expect(clearSelectionTextFormatting(editor)).toBe(true);
    const nextTable = editor.state.doc.firstChild!, cell = nextTable.firstChild!.firstChild!;
    expect(nextTable.attrs).toEqual(table.attrs); expect(cell.attrs).toEqual(table.firstChild!.firstChild!.attrs);
    expect(cell.lastChild).toBe(formula); expect(cell.firstChild!.attrs).toMatchObject({ blockTextColor: null, blockBackground: null, textAlign: null });
    expect(cell.firstChild!.firstChild!.marks.map(mark => mark.type.name)).toEqual(['link']);
    editor.commands.undo(); expect(editor.state.doc.eq(before)).toBe(true);
  });
  it.each(['clear', 'restore'])('preserves right-aligned media shells across a mixed %s selection', action => {
    const gallery = imageCollectionTemplate('carousel'); gallery.attrs = { ...gallery.attrs, align: 'right', width: '50%' };
    const editor = create([
      { ...p('heading', color), type: 'heading', attrs: { ...color, level: 2 } },
      { type: 'image', attrs: { src: 'one.png', align: 'right', width: '50%', caption: 'caption' } },
      { type: 'mathBlock', attrs: { latex: 'x+1', textAlign: 'right', textColor: '#123456', background: '#ffeecc' } },
      gallery,
      { type: 'table', attrs: { tableAlign: 'right' }, content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [p('cell')] }] }] },
      p('tail'),
    ]);
    const before = editor.state.doc, media = before.content.content.slice(1, 5);
    editor.view.dispatch(editor.state.tr.setSelection(new AllSelection(before)));
    if (action === 'clear') clearSelectionTextFormatting(editor); else expect(editor.commands.restoreParagraph()).toBe(true);
    const next = editor.state.doc;
    for (let index = 0; index < media.length; index++) {
      expect(next.child(index + 1).type).toBe(media[index].type);
      expect(next.child(index + 1).attrs).toEqual(media[index].attrs);
    }
    expect(next.child(1).eq(media[0])).toBe(true); expect(next.child(2).eq(media[1])).toBe(true);
    expect(next.firstChild!.attrs).toMatchObject(action === 'clear' ? { blockTextColor: null, blockBackground: null, textAlign: null } : color);
    expect(next.firstChild!.type.name).toBe(action === 'clear' ? 'heading' : 'paragraph');
    expect(next.firstChild!.firstChild!.marks.map(mark => mark.type.name)).toEqual(action === 'clear' ? ['link'] : before.firstChild!.firstChild!.marks.map(mark => mark.type.name));
    next.check(); editor.commands.undo(); expect(editor.state.doc.eq(before)).toBe(true);
  });
  it.each(['bulletList', 'orderedList', 'blockquote'])('removes the selected %s shell and keeps the body own style, sibling shells and links', type => {
    const children = [p('one', color), p('two', color), p('three', color)];
    const content = type === 'blockquote' ? children : children.map(child => ({ type: 'listItem', content: [child] }));
    const editor = create([{ type, attrs: { blockTextColor: '#0000aa', blockBackground: '#eeffff' }, content }, p('tail')]), before = editor.state.doc;
    let pos = 0; before.descendants((node, at) => { if (node.type.name === 'paragraph' && node.textContent === 'two') pos = at; });
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(before, pos + 1)));
    expect(editor.commands.restoreParagraph()).toBe(true);
    expect(editor.state.doc.child(1).type.name).toBe('paragraph');
    expect(editor.state.doc.child(1).attrs).toEqual(before.nodeAt(pos)!.attrs);
    const shellColors = { blockTextColor: before.firstChild!.attrs.blockTextColor, blockBackground: before.firstChild!.attrs.blockBackground };
    expect(editor.state.doc.child(0).attrs).toMatchObject(shellColors);
    expect(editor.state.doc.child(2).attrs).toMatchObject(shellColors);
    editor.commands.undo(); expect(editor.state.doc.eq(before)).toBe(true);
  });
  it('clears a whole Note appearance and descendants, while keeping its type, title, media placement and cell fill', () => {
    const editor = create([{ type: 'githubAlert', attrs: { kind: 'tip', title: 'Custom', icon: 'bookmark', textColor: '#123456', backgroundColor: '#ffeecc', borderColor: '#abcdef', concealed: true }, content: [
      p('inside', { ...color, concealed: true, indent: 2 }),
      { type: 'image', attrs: { src: 'one.png', align: 'right', width: '50%', concealed: true, caption: 'caption', captionContent: p('caption').content } },
      { type: 'table', attrs: { tableAlign: 'right' }, content: [{ type: 'tableRow', content: [{ type: 'tableCell', attrs: { background: '#ffeecc' }, content: [p('cell', color)] }] }] },
    ] }, p('tail')]);
    const before = editor.state.doc;
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(before, 0)));
    expect(clearSelectionTextFormatting(editor)).toBe(true);
    const note = editor.state.doc.firstChild!;
    expect(editor.state.selection).toBeInstanceOf(NodeSelection); expect(editor.state.selection.from).toBe(0);
    expect(note.attrs).toMatchObject({ kind: 'tip', title: 'Custom', icon: null, textColor: null, backgroundColor: null, borderColor: null, concealed: false });
    expect(note.firstChild!.attrs).toMatchObject({ blockTextColor: null, blockBackground: null, textAlign: null, indent: 0, concealed: false });
    expect(note.child(1).attrs).toMatchObject({ align: 'right', width: '50%', concealed: false });
    expect(note.child(1).attrs.captionContent[0].marks.map((mark: { type: string }) => mark.type)).toEqual(['link']);
    expect(note.child(2).attrs.tableAlign).toBe('right'); expect(note.child(2).firstChild!.firstChild!.attrs.background).toBe('#ffeecc');
    editor.commands.undo(); expect(editor.state.doc.eq(before)).toBe(true);
  });
  it.each(['main', 'draft'])('clears metadata captions through a mixed %s selection and keeps their text/links', entry => {
    const editor = create([p('prose', color), { type: 'image', attrs: { src: 'one.png', align: 'right', width: '50%', caption: 'caption', captionContent: p('caption').content } }, p('tail')]);
    const before = editor.state.doc;
    editor.view.dispatch(editor.state.tr.setSelection(new AllSelection(before)));
    if (entry === 'main') clearSelectionTextFormatting(editor);
    else clearDraftTextFormatting(editor.state, tr => editor.view.dispatch(tr));
    const image = editor.state.doc.child(1);
    expect(image.attrs).toMatchObject({ src: 'one.png', align: 'right', width: '50%', caption: 'caption' });
    expect(image.attrs.captionContent[0].marks.map((mark: { type: string }) => mark.type)).toEqual(['link']);
    editor.commands.undo(); expect(editor.state.doc.eq(before)).toBe(true);
  });
  it.each(['selection', 'block'])('includes the outside table caption only for the whole-table %s operation', entry => {
    const editor = create([{ type: 'table', attrs: { tableAlign: 'right', caption: 'caption', captionContent: p('caption').content }, content: [{ type: 'tableRow', content: [{ type: 'tableCell', attrs: { background: '#ffeecc' }, content: [p('cell', color)] }] }] }, p('tail')]);
    const before = editor.state.doc;
    if (entry === 'block') clearBlockFormatting(editor, 0);
    else { editor.view.dispatch(editor.state.tr.setSelection(new AllSelection(before))); clearSelectionTextFormatting(editor); }
    const table = editor.state.doc.firstChild!;
    expect(table.attrs.tableAlign).toBe('right'); expect(table.attrs.captionContent[0].marks.map((mark: { type: string }) => mark.type)).toEqual(['link']);
    expect(table.firstChild!.firstChild!.attrs.background).toBe('#ffeecc');
    editor.commands.undo(); expect(editor.state.doc.eq(before)).toBe(true);
  });
  it.each(['githubAlert', 'disclosure'])('restores a whole %s while retaining its title, concealment, own body styles and both annotations', type => {
    const editor = create([{ type, attrs: { kind: 'note', title: 'User title', annotationId: 'shell-note', concealed: true, ...(type === 'githubAlert' ? { textColor: '#123456' } : {}) }, content: [{ ...p('inside', color), type: 'heading', attrs: { ...color, level: 2, annotationId: 'body-note' } }, { type: 'image', attrs: { src: 'one.png', align: 'right', width: '50%' } }] }, p('tail')]);
    const before = editor.state.doc;
    expect(restoreBlockParagraph(editor, 0)).toBe(true);
    const next = editor.state.doc;
    expect(next.child(0).textContent).toBe('User title'); expect(next.child(0).attrs.annotationId).toBe('shell-note');
    expect(next.child(1).type.name).toBe('paragraph'); expect(next.child(1).attrs).toMatchObject({ ...color, annotationId: 'body-note', concealed: true });
    expect(next.child(2).attrs).toMatchObject({ src: 'one.png', align: 'right', width: '50%', concealed: true });
    expect(next.child(1).firstChild!.marks).toEqual(before.firstChild!.firstChild!.firstChild!.marks);
    next.check(); editor.commands.undo(); expect(editor.state.doc.eq(before)).toBe(true);
  });
  it.each(['githubAlert', 'disclosure'])('keeps the %s shell during a partial clear or local restoration', type => {
    const editor = create([{ type, attrs: { kind: 'note', title: 'User title', annotationId: 'shell-note', concealed: true, textColor: '#123456' }, content: [{ ...p('inside', color), type: 'heading', attrs: { ...color, level: 2 } }, p('after')] }, p('tail')]);
    const before = editor.state.doc;
    editor.commands.setTextSelection({ from: 3, to: 5 }); clearSelectionTextFormatting(editor);
    expect(editor.state.doc.firstChild!.attrs).toEqual(before.firstChild!.attrs); expect(editor.state.doc.firstChild!.firstChild!.attrs).toEqual(before.firstChild!.firstChild!.attrs);
    editor.commands.undo(); editor.commands.setTextSelection(3);
    expect(editor.commands.restoreParagraph()).toBe(true);
    expect(editor.state.doc.firstChild!.attrs).toEqual(before.firstChild!.attrs); expect(editor.state.doc.firstChild!.firstChild!.type.name).toBe('paragraph');
    expect(editor.state.doc.firstChild!.firstChild!.attrs).toMatchObject(color); editor.state.doc.check();
  });
  it('does not overwrite an inner Note foreground while carrying a removed list foreground', () => {
    const editor = create([{ type: 'bulletList', attrs: { blockTextColor: '#aa0000' }, content: [{ type: 'listItem', content: [p('main'), { type: 'githubAlert', attrs: { kind: 'note', textColor: '#0000aa' }, content: [p('nested')] }] }] }, p('tail')]);
    editor.commands.setTextSelection(3); expect(editor.commands.restoreParagraph()).toBe(true);
    expect(editor.state.doc.firstChild!.attrs.blockTextColor).toBe('#aa0000');
    const note = editor.state.doc.child(1);
    expect(note.attrs.textColor).toBe('#0000aa'); expect(note.firstChild!.attrs.blockTextColor).toBeNull();
  });
  it('carries a removed quote annotation without overwriting a body annotation, and assigns a split shell anchor once', () => {
    const editor = create([{ type: 'blockquote', attrs: { annotationId: 'shell', blockTextColor: '#aa0000' }, content: [p('one', { annotationId: 'body' }), p('two'), p('three')] }, p('tail')]);
    const before = editor.state.doc;
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(before, 0))); expect(editor.commands.restoreParagraph()).toBe(true);
    const ids: string[] = []; editor.state.doc.descendants(node => { if (node.attrs.annotationId) ids.push(node.attrs.annotationId); });
    expect(ids.sort()).toEqual(['body', 'shell']); editor.commands.undo(); expect(editor.state.doc.eq(before)).toBe(true);
    let pos = 0; before.descendants((node, at) => { if (node.isTextblock && node.textContent === 'two') pos = at; });
    editor.commands.setTextSelection(pos + 1); editor.commands.restoreParagraph();
    const shells: string[] = []; editor.state.doc.descendants(node => { if (node.type.name === 'blockquote' && node.attrs.annotationId) shells.push(node.attrs.annotationId); });
    expect(shells).toEqual(['shell']);
  });
  it('restores a thousand-row cell rectangle without changing unselected columns or losing selection and undo', () => {
    const rows: JSONContent[] = Array.from({ length: 1000 }, (_, row) => ({ type: 'tableRow', content: [
      { type: 'tableCell', attrs: { background: '#ffeecc' }, content: [{ ...p(`R${row}`, color), type: 'heading', attrs: { ...color, level: 2 } }] },
      { type: 'tableCell', content: [p(`keep${row}`)] },
    ] }));
    const editor = create([{ type: 'table', attrs: { tableAlign: 'right' }, content: rows }, p('tail')]);
    const before = editor.state.doc, table = before.firstChild!, map = TableMap.get(table);
    editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(before, 1 + map.map[0], 1 + map.map[1998])));
    expect(editor.commands.restoreParagraph()).toBe(true);
    const next = editor.state.doc.firstChild!;
    expect(next.childCount).toBe(1000); expect(next.attrs).toEqual(table.attrs); expect(editor.state.selection).toBeInstanceOf(CellSelection);
    next.forEach((row, _pos, index) => {
      expect(row.firstChild!.firstChild!.type.name).toBe('paragraph'); expect(row.firstChild!.firstChild!.attrs).toMatchObject(color);
      expect(row.child(1)).toBe(table.child(index).child(1)); expect(row.firstChild!.attrs.background).toBe('#ffeecc');
    });
    editor.commands.undo(); expect(editor.state.doc.eq(before)).toBe(true);
    clearSelectionTextFormatting(editor);
    expect(editor.state.doc.firstChild!.lastChild!.firstChild!.firstChild!.attrs).toMatchObject({ blockTextColor: null, blockBackground: null, textAlign: null });
    expect(editor.state.doc.firstChild!.lastChild!.child(1)).toBe(table.lastChild!.child(1));
    editor.commands.undo(); expect(editor.state.doc.eq(before)).toBe(true);
  });
  it.each(['clear', 'restore'])('keeps hidden annotation bodies outside a visible whole-document %s', action => {
    const editor = create([{ ...p('visible', { ...color, annotationId: 'note-1' }), type: 'heading', attrs: { ...color, level: 2, annotationId: 'note-1' } },
      { type: 'annotationStore', content: [{ type: 'annotationBody', attrs: { id: 'note-1' }, content: [{ ...p('explanation', color), type: 'heading', attrs: { ...color, level: 3 } }] }] }, p('tail')]);
    const before = editor.state.doc, store = before.child(1);
    editor.view.dispatch(editor.state.tr.setSelection(new AllSelection(before)));
    if (action === 'clear') clearSelectionTextFormatting(editor); else editor.commands.restoreParagraph();
    expect(editor.state.doc.child(1)).toBe(store); expect(editor.state.doc.firstChild!.attrs.annotationId).toBe('note-1');
    editor.commands.undo(); expect(editor.state.doc.eq(before)).toBe(true);
  });
});
