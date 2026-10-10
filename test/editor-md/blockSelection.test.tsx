import { afterEach, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import { buildDocumentExtensions } from '@/features/editor-md/documentExtensions';
import { resolveBlockSelection, type BlockSelection } from '@/features/editor-md/blockSelection';
import { BlockSelectionMenu, copyBlockSelection, restoreBlockSelection } from '@/features/editor-md/BlockSelectionMenu';
import { DOCUMENT_SLICE_MIME } from '@/features/editor-md/clipboard/constants';

const editors: Editor[] = [], roots: Root[] = [];
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
function visual(content: string | Record<string, unknown>) {
  const editor = new Editor({ extensions: buildDocumentExtensions(), content, editorProps: { handleScrollToSelection: () => true } });
  editors.push(editor); return editor;
}
function body(editor: Editor, text: string) {
  let pos = -1;
  editor.state.doc.descendants((node, at) => { if (node.isTextblock && node.textContent === text) pos = at + 1; });
  if (pos < 0) throw new Error(`Missing text ${text}`);
  return pos;
}
function select(editor: Editor, start: string, end: string, tail = end.length): BlockSelection {
  editor.commands.setTextSelection({ from: body(editor, start), to: body(editor, end) + tail });
  const selected = resolveBlockSelection(editor.state);
  expect(selected).not.toBeNull(); return selected!;
}
async function click(editor: Editor, selection: BlockSelection, label: string) {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host); roots.push(root);
  await act(async () => root.render(<BlockSelectionMenu editor={editor} selection={selection} close={() => undefined}/>));
  const button = [...host.querySelectorAll('button')].find(button => button.textContent?.startsWith(label));
  expect(button).toBeDefined(); await act(async () => button!.click());
}
afterEach(async () => {
  await act(async () => roots.splice(0).forEach(root => root.unmount()));
  editors.splice(0).forEach(editor => editor.destroy());
  vi.restoreAllMocks(); document.body.innerHTML = '';
});

it('uses complete list items for movement while preserving the partial user range and direction', () => {
  const editor = visual('<ul><li><p>one</p></li><li><p>two</p></li><li><p>three</p></li></ul>');
  const selected = select(editor, 'one', 'two', 1);
  expect(selected.items.map(item => item.node.type.name)).toEqual(['listItem', 'listItem']);
  expect(selected.items.map(item => item.node.textContent)).toEqual(['one', 'two']);
  expect(selected.from).toBe(1); expect(selected.to).toBe(selected.items[1].pos + selected.items[1].node.nodeSize);
  expect(selected.selection.to).toBe(body(editor, 'two') + 1);
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, selected.selection.head, selected.selection.anchor)));
  const reversed = resolveBlockSelection(editor.state)!;
  expect(reversed.from).toBe(selected.from); expect(reversed.to).toBe(selected.to);
  expect(reversed.selection.anchor).toBe(selected.selection.head);
});

it('excludes the following row when the selection ends before its first character', () => {
  const editor = visual('<ul><li><p>one</p></li><li><p>two</p></li><li><p>three</p></li></ul>');
  const selected = select(editor, 'one', 'three', 0);
  expect(selected.items.map(item => item.node.textContent)).toEqual(['one', 'two']);
  editor.commands.setTextSelection({ from: body(editor, 'one'), to: body(editor, 'two') });
  expect(resolveBlockSelection(editor.state)).toBeNull();
});

it('counts nested sibling items without counting their ancestor twice', () => {
  const editor = visual('<ul><li><p>outer</p><ul><li><p>one</p></li><li><p>two</p></li></ul></li><li><p>after</p></li></ul>');
  expect(select(editor, 'one', 'two').items.map(item => item.node.textContent)).toEqual(['one', 'two']);
  editor.commands.setTextSelection({ from: body(editor, 'outer'), to: body(editor, 'two') + 3 });
  expect(resolveBlockSelection(editor.state)).toBeNull();
  expect(select(editor, 'outer', 'after').items.map(item => item.node.textContent)).toEqual(['outeronetwo', 'after']);
});

it('supports ordinary blocks and first-level disclosure contents, excluding deeper disclosure and table cell selections', () => {
  const editor = visual({ type: 'doc', content: [
    { type: 'disclosure', attrs: { title: 'details' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'two' }] },
      { type: 'disclosure', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'deep' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'deeper' }] }] }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'after' }] },
  ] });
  expect(select(editor, 'one', 'two').scope).toBe(0);
  editor.commands.setTextSelection({ from: body(editor, 'deep'), to: body(editor, 'deeper') + 6 });
  expect(resolveBlockSelection(editor.state)).toBeNull();
  const tableEditor = visual('<table><tr><td><p>one</p></td><td><p>two</p></td></tr></table><p>after</p>');
  const map = TableMap.get(tableEditor.state.doc.firstChild!);
  tableEditor.view.dispatch(tableEditor.state.tr.setSelection(CellSelection.create(tableEditor.state.doc, 1 + map.map[0], 1 + map.map[1])));
  expect(resolveBlockSelection(tableEditor.state)).toBeNull();
});

it('does not create multi mode for wrapped visual lines or multiple paragraphs in one quote', () => {
  const editor = visual('<p>one two three</p><blockquote><p>four</p><p>five</p></blockquote>');
  editor.commands.setTextSelection({ from: 1, to: 8 }); expect(resolveBlockSelection(editor.state)).toBeNull();
  editor.commands.setTextSelection({ from: body(editor, 'four'), to: body(editor, 'five') + 4 }); expect(resolveBlockSelection(editor.state)).toBeNull();
});

it('allows a pure-media batch to clear caption styles and concealment without changing image layout', async () => {
  const image = (text: string) => ({ type: 'image', attrs: { src: `${text}.svg`, align: 'right', concealed: true, caption: text, captionContent: [{ type: 'text', text, marks: [{ type: 'bold' }] }] } });
  const editor = visual({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'before' }] }, image('one'), image('two'), { type: 'paragraph', content: [{ type: 'text', text: 'after' }] }] });
  editor.commands.setTextSelection({ from: body(editor, 'before') + 6, to: body(editor, 'after') });
  const selected = resolveBlockSelection(editor.state)!;
  expect(selected.count).toBe(2); expect(selected.items.every(item => item.node.type.name === 'image')).toBe(true);
  await click(editor, selected, '清除文字样式');
  for (const index of [1, 2]) {
    expect(editor.state.doc.child(index).attrs.captionContent[0].marks).toHaveLength(0);
    expect(editor.state.doc.child(index).attrs.concealed).toBe(false);
    expect(editor.state.doc.child(index).attrs.align).toBe('right');
  }
});

it('clear styles acts on the original partial text selection even after the current selection moved', async () => {
  const editor = visual('<p><b>one</b></p><p><b>two</b></p><p><b>after</b></p>');
  const selected = select(editor, 'one', 'two', 1), before = editor.state.doc;
  editor.commands.setTextSelection(body(editor, 'after'));
  await click(editor, selected, '清除文字样式');
  expect(editor.state.doc.child(0).firstChild!.marks).toHaveLength(0);
  expect(editor.state.doc.child(1).child(0).text).toBe('t'); expect(editor.state.doc.child(1).child(0).marks).toHaveLength(0);
  expect(editor.state.doc.child(1).child(1).marks[0].type.name).toBe('bold');
  expect(editor.state.doc.child(2)).toBe(before.child(2));
  editor.commands.undo(); expect(editor.state.doc.eq(before)).toBe(true);
});

it('clears complete selected paragraph appearance while preserving partial paragraph appearance and media layout', async () => {
  const attrs = { blockTextColor: '#ff0000', blockBackground: '#ffff00', textAlign: 'right', indent: 2, concealed: true };
  const editor = visual({ type: 'doc', content: [
    { type: 'paragraph', attrs, content: [{ type: 'text', text: 'one', marks: [{ type: 'bold' }] }] },
    { type: 'image', attrs: { src: 'https://example.com/picture.png', align: 'right' } },
    { type: 'paragraph', attrs, content: [{ type: 'text', text: 'two', marks: [{ type: 'bold' }] }] },
  ] });
  const selected = select(editor, 'one', 'two', 1), image = editor.state.doc.child(1);
  await click(editor, selected, '清除文字样式');
  expect(editor.state.doc.child(0).attrs).toMatchObject({ blockTextColor: null, blockBackground: null, textAlign: null, indent: 0, concealed: false });
  expect(editor.state.doc.child(2).attrs).toMatchObject(attrs);
  expect(editor.state.doc.child(1)).toBe(image);
});

it('deletes only selected characters and leaves the remaining text with its formatting', async () => {
  const editor = visual('<p><b>one</b></p><p><i>two</i></p><p>after</p>');
  const selected = select(editor, 'one', 'two', 1), before = editor.state.doc;
  editor.commands.setTextSelection(body(editor, 'after'));
  await click(editor, selected, '删除所选内容');
  expect(editor.state.doc.textContent).toBe('woafter');
  expect(editor.state.doc.firstChild!.firstChild!.marks[0].type.name).toBe('italic');
  editor.commands.undo(); expect(editor.state.doc.eq(before)).toBe(true);
});

it('restores selected list rows while retaining marks and mixed media', async () => {
  const editor = visual('<ul><li><p><b>one</b></p></li><li><p><i>two</i></p></li><li><p>after</p></li></ul><img src="https://example.com/picture.png"><h2><b>end</b></h2>');
  const selected = select(editor, 'one', 'end'), before = editor.state.doc;
  const image = before.child(1);
  await click(editor, selected, '还原为正文');
  expect(editor.state.doc.content.content.filter(node => node.content.size || node.type.name === 'image').map(node => node.type.name)).toEqual(['paragraph', 'paragraph', 'paragraph', 'image', 'paragraph']);
  expect(editor.state.doc.child(0).firstChild!.marks[0].type.name).toBe('bold');
  expect(editor.state.doc.child(1).firstChild!.marks[0].type.name).toBe('italic');
  expect(editor.state.doc.child(3)).toBe(image); editor.state.doc.check();
  editor.commands.undo(); expect(editor.state.doc.eq(before)).toBe(true);
});

it('copies the user range using the rich clipboard helper and only cuts after successful writing', () => {
  const editor = visual('<p><b>one</b></p><p><i>two</i></p><p>after</p>');
  const selected = select(editor, 'one', 'two', 1), before = editor.state.doc;
  const formats = new Map<string, string>();
  Object.defineProperty(document, 'execCommand', { configurable: true, value: () => false });
  vi.spyOn(document, 'execCommand').mockImplementation(() => {
    const event = new Event('copy', { cancelable: true }) as ClipboardEvent;
    Object.defineProperty(event, 'clipboardData', { value: { setData: (mime: string, value: string) => formats.set(mime, value) } });
    document.dispatchEvent(event); return true;
  });
  editor.commands.setTextSelection(body(editor, 'after'));
  expect(copyBlockSelection(editor, selected)).toBe(true);
  expect(formats.get('text/plain')).toBe('one\n\nt'); expect(formats.get('text/html')).toContain('<strong>one</strong>');
  expect(formats.has(DOCUMENT_SLICE_MIME)).toBe(true); expect(editor.state.doc.eq(before)).toBe(true);
  expect(copyBlockSelection(editor, selected, true)).toBe(true);
  expect(editor.state.doc.textContent).toBe('woafter'); editor.commands.undo(); expect(editor.state.doc.eq(before)).toBe(true);
  vi.mocked(document.execCommand).mockReturnValue(false);
  expect(copyBlockSelection(editor, select(editor, 'one', 'two', 1), true)).toBe(false); expect(editor.state.doc.eq(before)).toBe(true);
});

it('rejects a stale menu snapshot after the document changes', () => {
  const editor = visual('<p>one</p><p>two</p>'); const selected = select(editor, 'one', 'two');
  editor.commands.insertContent('new');
  expect(restoreBlockSelection(editor, selected)).toBe(false);
});
