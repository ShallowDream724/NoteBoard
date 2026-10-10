import { afterEach, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { buildDocumentExtensions } from '@/features/editor-md/documentExtensions';
import { formatBlock } from '@/features/editor-md/blockActions';

const editors: Editor[] = [];
function create(content: string) {
  const editor = new Editor({ extensions: buildDocumentExtensions(), content,
    editorProps: { handleScrollToSelection: () => true } });
  editors.push(editor); return editor;
}
function positions(editor: Editor, name = 'listItem') {
  const result: number[] = [];
  editor.state.doc.descendants((node, pos) => { if (node.type.name === name) result.push(pos); });
  return result;
}
function shape(editor: Editor) {
  return editor.state.doc.content.content.map(node => [node.type.name, node.textContent, node.attrs.start]);
}
afterEach(() => { for (const editor of editors.splice(0)) editor.destroy(); });

it('starts an ordered list on the empty current row without converting the three bullet items above', () => {
  const editor = create('<ul><li><p>one</p></li><li><p>two</p></li><li><p>three</p></li><li><p></p></li></ul><p>after</p>');
  editor.commands.setTextSelection(positions(editor)[3] + 2);
  const original = editor.state.doc;
  expect(editor.commands.toggleOrderedList()).toBe(true);
  expect(shape(editor).slice(0, 2)).toEqual([['bulletList', 'onetwothree', undefined], ['orderedList', '', 1]]);
  expect(editor.state.selection.$from.node(1).type.name).toBe('orderedList');
  editor.state.doc.check(); const converted = editor.state.doc;
  editor.commands.undo(); expect(editor.state.doc.eq(original)).toBe(true);
  editor.commands.redo(); expect(editor.state.doc.eq(converted)).toBe(true);
});

it('block-menu conversion only affects the selected item and preserves nested content and marks', () => {
  const editor = create('<ul><li><p>one</p></li><li><p><strong>two</strong></p><ul><li><p>child</p></li></ul></li><li><p>three</p></li></ul><p>after</p>');
  const original = editor.state.doc;
  expect(formatBlock(editor, positions(editor)[1], chain => chain.toggleOrderedList())).toBe(true);
  expect(shape(editor).slice(0, 3)).toEqual([['bulletList', 'one', undefined], ['orderedList', 'twochild', 1], ['bulletList', 'three', undefined]]);
  const item = editor.state.doc.child(1).firstChild!;
  expect(item.firstChild!.firstChild!.marks[0].type.name).toBe('bold');
  expect(item.lastChild!.type.name).toBe('bulletList');
  editor.state.doc.check(); editor.commands.undo(); expect(editor.state.doc.eq(original)).toBe(true);
});

it('converts selected adjacent items and reflows the linked ordered suffix', () => {
  const editor = create('<ol start="7"><li><p>one</p></li><li><p>two</p></li><li><p>three</p></li><li><p>four</p></li></ol><p>after</p>');
  const items = positions(editor);
  editor.commands.setTextSelection({ from: items[1] + 3, to: items[2] + 4 });
  expect(editor.commands.toggleBulletList()).toBe(true);
  expect(shape(editor).slice(0, 3)).toEqual([['orderedList', 'one', 7], ['bulletList', 'twothree', undefined], ['orderedList', 'four', 8]]);
  expect(editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, '|')).toBe('wo|th');
  editor.state.doc.check();
});

it('respects item NodeSelection and can() without mutating document, selection or stored marks', () => {
  const editor = create('<ul><li><p>one</p></li><li><p>two</p></li><li><p>three</p></li></ul><p>after</p>');
  const pos = positions(editor)[1];
  editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)));
  const state = editor.state;
  expect(editor.can().toggleOrderedList()).toBe(true); expect(editor.state).toBe(state);
  expect(editor.commands.toggleOrderedList()).toBe(true);
  expect((editor.state.selection as NodeSelection).node.textContent).toBe('two');
  expect(shape(editor).slice(0, 3).map(node => node[0])).toEqual(['bulletList', 'orderedList', 'bulletList']);
});

it('keeps a nested switch inside its parent and preserves task states outside the selected item', () => {
  const editor = create('<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>parent</p><ul><li><p>one</p></li><li><p>two</p></li></ul></li><li data-type="taskItem" data-checked="true"><p>sibling</p></li></ul><p>after</p>');
  editor.commands.setTextSelection(positions(editor)[1] + 2);
  expect(editor.commands.toggleOrderedList()).toBe(true);
  const parent = editor.state.doc.firstChild!.firstChild!;
  expect(parent.content.content.slice(1).map(node => [node.type.name, node.textContent])).toEqual([['bulletList', 'one'], ['orderedList', 'two']]);
  expect(parent.attrs.checked).toBe(true); expect(editor.state.doc.firstChild!.lastChild!.attrs.checked).toBe(true);
  editor.commands.setTextSelection(positions(editor, 'taskItem')[1] + 2);
  expect(editor.commands.toggleBulletList()).toBe(true);
  expect(editor.state.doc.firstChild!.type.name).toBe('taskList');
  expect(editor.state.doc.firstChild!.firstChild!.attrs.checked).toBe(true);
  expect(editor.state.doc.child(1).type.name).toBe('bulletList'); editor.state.doc.check();
});

it('converts one bullet item to a task without wrapping the surrounding list or resetting its neighbors', () => {
  const editor = create('<ul><li><p>one</p></li><li><p>two</p></li><li><p>three</p></li></ul><p>after</p>');
  editor.commands.setTextSelection(positions(editor)[1] + 2);
  expect(editor.commands.toggleTaskList()).toBe(true);
  expect(shape(editor).slice(0, 3).map(node => node[0])).toEqual(['bulletList', 'taskList', 'bulletList']);
  expect(editor.state.doc.child(1).firstChild!.attrs.checked).toBe(false); editor.state.doc.check();
});

it('retains ordinary wrapping and same-type removal on the current item', () => {
  const editor = create('<ul><li><p>one</p></li><li><p>two</p></li><li><p>three</p></li></ul><p>after</p>');
  editor.commands.setTextSelection(positions(editor)[1] + 2);
  expect(editor.commands.toggleBulletList()).toBe(true);
  expect(shape(editor).slice(0, 3).map(node => node[0])).toEqual(['bulletList', 'paragraph', 'bulletList']);
  expect(editor.commands.toggleOrderedList()).toBe(true);
  expect(shape(editor).slice(0, 3).map(node => node[0])).toEqual(['bulletList', 'orderedList', 'bulletList']); editor.state.doc.check();
});

it('does not convert the next item when selection ends at its first text position', () => {
  const editor = create('<ul><li><p>one</p></li><li><p>two</p></li><li><p>three</p></li></ul><p>after</p>');
  const items = positions(editor);
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, items[0] + 2, items[1] + 2)));
  expect(editor.commands.toggleOrderedList()).toBe(true);
  expect(shape(editor).slice(0, 2)).toEqual([['orderedList', 'one', 1], ['bulletList', 'twothree', undefined]]); editor.state.doc.check();
});

it.each([false, true])('joins consecutive item conversions and numbers them continuously (reverse=%s)', reverse => {
  const editor = create('<ul><li><p>A</p></li><li><p>B</p></li><li><p>C</p></li></ul><p>after</p>');
  const convert = (text: string) => {
    let at = 0; editor.state.doc.descendants((node, pos) => { if (node.isTextblock && node.textContent === text) at = pos + 1; });
    editor.commands.setTextSelection(at); expect(editor.commands.toggleOrderedList()).toBe(true);
  };
  convert(reverse ? 'C' : 'B'); const before = editor.state.doc;
  convert(reverse ? 'B' : 'C');
  expect(shape(editor).slice(0, 2)).toEqual([['bulletList', 'A', undefined], ['orderedList', 'BC', 1]]);
  expect(editor.state.selection.$from.parent.textContent).toBe(reverse ? 'B' : 'C');
  editor.state.doc.check(); const after = editor.state.doc;
  editor.commands.undo(); expect(editor.state.doc.eq(before)).toBe(true);
  editor.commands.redo(); expect(editor.state.doc.eq(after)).toBe(true);
});

it.each([false, true])('converts only selected bodies across nested and outer list items (reverse=%s)', reverse => {
  const editor = create('<ul><li><p>A</p><ul><li><p>a</p></li><li><p>b</p></li><li><p>c</p></li></ul></li><li><p>B</p></li></ul><p>after</p>');
  const at: Record<string, number> = {};
  editor.state.doc.descendants((node, pos) => { if (node.isTextblock) at[node.textContent] = pos + 1; });
  const untouched = editor.state.doc.firstChild!.firstChild!.child(1).firstChild!;
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, reverse ? at.B + 1 : at.b, reverse ? at.b : at.B + 1)));
  const text = editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, '|'), before = editor.state.doc;
  expect(editor.commands.toggleOrderedList()).toBe(true);
  const parent = editor.state.doc.firstChild!.firstChild!;
  expect(editor.state.doc.firstChild!.type.name).toBe('bulletList');
  expect(parent.firstChild!.textContent).toBe('A');
  expect(parent.child(1).type.name).toBe('bulletList'); expect(parent.child(1).firstChild).toBe(untouched);
  expect(parent.child(2).type.name).toBe('orderedList'); expect(parent.child(2).textContent).toBe('bc');
  expect(editor.state.doc.child(1).type.name).toBe('orderedList'); expect(editor.state.doc.child(1).textContent).toBe('B');
  expect(editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, '|')).toBe(text);
  expect(editor.state.selection.anchor > editor.state.selection.head).toBe(reverse);
  editor.state.doc.check(); editor.commands.undo(); expect(editor.state.doc.eq(before)).toBe(true);
});

it('converts a whole selected list and removes it on a second same-type toggle', () => {
  const editor = create('<ul><li><p>A</p></li><li><p>B</p></li></ul><p>after</p>');
  editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 0)));
  expect(editor.commands.toggleOrderedList()).toBe(true);
  expect(editor.state.selection).toBeInstanceOf(NodeSelection);
  expect(editor.state.doc.firstChild!.type.name).toBe('orderedList');
  expect(editor.commands.toggleOrderedList()).toBe(true);
  expect(shape(editor)).toEqual([['paragraph', 'A', undefined], ['paragraph', 'B', undefined], ['paragraph', 'after', undefined]]);
  editor.state.doc.check();
});

it('converts selected lists and the ordinary paragraph between them in one undoable operation', () => {
  const editor = create('<ul><li><p>A</p></li></ul><p>middle</p><ul><li><p>B</p></li></ul><p>after</p>');
  const at: Record<string, number> = {};
  editor.state.doc.descendants((node, pos) => { if (node.isTextblock) at[node.textContent] = pos + 1; });
  editor.commands.setTextSelection({ from: at.A, to: at.B + 1 }); const before = editor.state.doc;
  expect(editor.commands.toggleOrderedList()).toBe(true);
  expect(shape(editor)).toEqual([['orderedList', 'AmiddleB', 1], ['paragraph', 'after', undefined]]);
  expect(editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, '|')).toBe('A|middle|B');
  editor.state.doc.check(); editor.commands.undo(); expect(editor.state.doc.eq(before)).toBe(true);
});

it.each(['restoreParagraph', 'toggleOrderedList'] as const)('can().%s inside a chain leaves the original item selection and transaction untouched', action => {
  const editor = create('<ul><li><p>one</p></li><li><p>two</p></li><li><p>three</p></li></ul><p>after</p>');
  editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, positions(editor)[1])));
  expect(editor.chain().command(({ can, tr }) => {
    const selection = tr.selection, doc = tr.doc, steps = tr.steps.length;
    expect(can()[action]()).toBe(true);
    expect(tr.selection).toBe(selection); expect(tr.doc).toBe(doc); expect(tr.steps).toHaveLength(steps);
    expect(tr.getMeta('closeHistory')).toBeUndefined(); return true;
  }).deleteSelection().run()).toBe(true);
  expect(editor.state.doc.firstChild!.textContent).toBe('onethree'); editor.state.doc.check();
});

it.each(['insert', 'delete'] as const)('uses positions from the current chain document after %s, without mapping earlier steps again', action => {
  const editor = create('<ul><li><p>one</p></li><li><p>two</p></li><li><p>three</p></li></ul><p>after</p>');
  const at = positions(editor)[1] + 2;
  editor.commands.setTextSelection(action === 'insert' ? at : { from: at, to: at + 2 }); const before = editor.state.doc;
  const chain = editor.chain();
  if (action === 'insert') chain.insertContent('x'.repeat(100)); else chain.deleteSelection();
  expect(chain.toggleOrderedList().run()).toBe(true);
  expect(shape(editor).slice(0, 3)).toEqual([['bulletList', 'one', undefined], ['orderedList', action === 'insert' ? 'x'.repeat(100) + 'two' : 'o', 1], ['bulletList', 'three', undefined]]);
  expect(editor.state.selection.$from.parent.textContent).toBe(action === 'insert' ? 'x'.repeat(100) + 'two' : 'o');
  editor.state.doc.check(); editor.commands.undo(); expect(editor.state.doc.eq(before)).toBe(true);
});
