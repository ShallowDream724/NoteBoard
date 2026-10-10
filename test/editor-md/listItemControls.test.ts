import { afterEach, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import { NodeSelection } from '@tiptap/pm/state';
import { undoDepth } from '@tiptap/pm/history';
import { findTopLevelBlockElement, getTopLevelBlockInfo, moveTopLevelBlock, resolveTopLevelDropTarget } from '@/features/editor-md/blockReorder';
import { deleteBlock, insertAfterBlock, selectBlock } from '@/features/editor-md/blockActions';

const editors: Editor[] = [];
function create(content: string) {
  const editor = new Editor({ extensions: [StarterKit, TaskList, TaskItem.configure({ nested: true })], content,
    editorProps: { handleScrollToSelection: () => true } });
  editors.push(editor); document.body.append(editor.view.dom); return editor;
}
function bounds(element: Element, top: number, height = 30) {
  return vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({ x: 100, y: top, top, bottom: top + height,
    left: 100, right: 500, width: 400, height, toJSON() {} } as DOMRect);
}
function rows(editor: Editor, selector = 'ol') {
  const list = editor.view.dom.querySelector(selector)!;
  const items = [...list.children] as HTMLElement[];
  items.forEach((item, index) => { bounds(item, 100 + index * 30); bounds(item.querySelector('p')!, 100 + index * 30); });
  return { list, items };
}
afterEach(() => { for (const editor of editors.splice(0)) { const dom = editor.view.dom; editor.destroy(); dom.remove(); } vi.restoreAllMocks(); });

it('keeps each marker/gutter row as the same item used by selection, deletion and insertion', () => {
  const editor = create('<ol start="7"><li><p>one</p></li><li><p>two</p></li><li><p>three</p></li></ol><p>after</p>');
  const { list, items } = rows(editor);
  items.forEach((item, index) => {
    expect(findTopLevelBlockElement(editor.view.dom, list, 115 + index * 30)).toBe(item);
    expect(findTopLevelBlockElement(editor.view.dom, item.querySelector('p'), 115 + index * 30)).toBe(item);
  });
  expect(findTopLevelBlockElement(editor.view.dom, list, 90)).toBeNull();
  const second = getTopLevelBlockInfo(editor.view, items[1])!;
  expect(selectBlock(editor, second.pos)).toBe(true);
  expect(editor.state.selection).toBeInstanceOf(NodeSelection);
  expect((editor.state.selection as NodeSelection).node.textContent).toBe('two');
  expect(deleteBlock(editor, second.pos)).toBe(true);
  expect(editor.state.doc.firstChild!.content.content.map(item => item.textContent)).toEqual(['one', 'three']);
  expect(editor.state.doc.firstChild!.attrs.start).toBe(7);
  insertAfterBlock(editor, 1);
  expect(editor.state.doc.firstChild!.content.content.map(item => item.textContent)).toEqual(['one', '', 'three']);
  editor.state.doc.check();
});

it('resolves nested rows from the outer gutter and moves the item with its subtree in one undoable edit', () => {
  const editor = create('<ul><li><p>parent</p><ul><li><p>one</p><ul><li><p>child</p></li></ul></li><li><p>two</p></li></ul></li><li><p>sibling</p></li></ul><p>after</p>');
  const outer = editor.view.dom.querySelector('ul')!, parent = outer.firstElementChild!;
  const inner = parent.querySelector('ul')!, one = inner.children[0], two = inner.children[1];
  bounds(parent, 100, 120); bounds(parent.firstElementChild!, 100);
  bounds(inner, 130, 90); bounds(one, 130, 60); bounds(one.firstElementChild!, 130);
  bounds(one.children[1], 160, 30); bounds(one.querySelector('li')!, 160); bounds(one.querySelector('li p')!, 160);
  bounds(two, 190); bounds(two.firstElementChild!, 190); bounds(outer.children[1], 220);
  expect(findTopLevelBlockElement(editor.view.dom, outer, 145)).toBe(one);
  expect(findTopLevelBlockElement(editor.view.dom, outer, 175)).toBe(one.querySelector('li'));
  expect(findTopLevelBlockElement(editor.view.dom, inner, 205)).toBe(two);
  const original = editor.state.doc;
  const source = getTopLevelBlockInfo(editor.view, one as HTMLElement)!;
  const target = getTopLevelBlockInfo(editor.view, two as HTMLElement)!;
  const moved = moveTopLevelBlock(editor.view, source.pos, target.pos + target.node.nodeSize)!;
  expect(moved).not.toBeNull();
  const nested = editor.state.doc.firstChild!.firstChild!.lastChild!;
  expect(nested.content.content.map(item => item.textContent)).toEqual(['two', 'onechild']);
  expect((editor.state.selection as NodeSelection).node.textContent).toBe('onechild');
  editor.state.doc.check(); const reordered = editor.state.doc;
  editor.commands.undo(); expect(editor.state.doc.eq(original)).toBe(true);
  editor.commands.redo(); expect(editor.state.doc.eq(reordered)).toBe(true);
});

it('handles task labels/content without widening the target and retains checked state on move', () => {
  const editor = create('<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>one</p></li><li data-type="taskItem" data-checked="false"><p>two</p></li></ul><p>after</p>');
  const { list, items } = rows(editor, 'ul');
  items.forEach((item, index) => { bounds(item.querySelector(':scope > div')!, 100 + index * 30); });
  expect(findTopLevelBlockElement(editor.view.dom, list, 145)).toBe(items[1]);
  expect(findTopLevelBlockElement(editor.view.dom, items[1].querySelector('input'), 145)).toBe(items[1]);
  const original = editor.state.doc;
  moveTopLevelBlock(editor.view, 1, original.firstChild!.nodeSize - 1);
  expect(editor.state.doc.firstChild!.content.content.map(item => [item.textContent, item.attrs.checked])).toEqual([['two', false], ['one', true]]);
  expect(editor.state.doc.firstChild!.childCount).toBe(2); editor.state.doc.check();
  editor.commands.undo(); expect(editor.state.doc.eq(original)).toBe(true);
});

it('drops in the last row before the list closing boundary, preserving its ordinal sequence', () => {
  const editor = create('<ol start="7"><li><p>one</p></li><li><p>two</p></li><li><p>three</p></li></ol><p>after</p>');
  const { list, items } = rows(editor);
  bounds(list, 100, 90); bounds(editor.view.dom.lastElementChild!, 210);
  const last = getTopLevelBlockInfo(editor.view, items[2])!;
  const target = resolveTopLevelDropTarget(editor.view, 189, 1)!;
  expect(target.element).toBe(items[2]); expect(target.edge).toBe('after');
  expect(target.insertPos).toBe(last.pos + last.node.nodeSize);
  expect(moveTopLevelBlock(editor.view, 1, target.insertPos)).not.toBeNull();
  expect(editor.state.doc.childCount).toBe(2);
  expect(editor.state.doc.firstChild!.attrs.start).toBe(7);
  expect(editor.state.doc.firstChild!.content.content.map(item => item.textContent)).toEqual(['two', 'three', 'one']);
});

it('removes an emptied single-item wrapper and rejects dropping an item inside its own subtree', () => {
  const editor = create('<ul><li><p>one</p><ul><li><p>child</p></li></ul></li></ul><p>after</p>');
  const original = editor.state.doc;
  expect(moveTopLevelBlock(editor.view, 1, 7)).toBeNull();
  expect(editor.state.doc.eq(original)).toBe(true);
  expect(deleteBlock(editor, 1)).toBe(true);
  expect(editor.state.doc.childCount).toBe(1); expect(editor.state.doc.firstChild!.textContent).toBe('after');
  editor.commands.undo(); expect(editor.state.doc.eq(original)).toBe(true);
});

it.each(['ol', 'ul'])('moves a checked task before, between and after %s rows without changing its kind or losing content', tag => {
  for (const edge of [0, 1, 3]) {
    const editor = create(`<${tag}><li><p>one</p></li><li><p>two</p></li><li><p>three</p></li></${tag}><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p><strong>todo</strong></p></li></ul><p>tail</p>`);
    const original = editor.state.doc, list = original.firstChild!;
    const source = list.nodeSize + 1;
    const target = 1 + list.content.content.slice(0, edge).reduce((size, node) => size + node.nodeSize, 0);
    const item = original.nodeAt(source)!;
    expect(moveTopLevelBlock(editor.view, source, target)).not.toBeNull();
    const sections = editor.state.doc.content.content.filter(node => node.type.name !== 'paragraph');
    const task = sections.find(node => node.type.name === 'taskList')!;
    expect(task.firstChild).toBe(item); expect(task.firstChild!.attrs.checked).toBe(true);
    expect(task.firstChild!.firstChild!.firstChild!.marks[0].type.name).toBe('bold');
    expect(sections.map(node => node.textContent)).toEqual(edge === 0 ? ['todo', 'onetwothree'] : edge === 1 ? ['one', 'todo', 'twothree'] : ['onetwothree', 'todo']);
    if (tag === 'ol') expect(sections.filter(node => node.type.name === 'orderedList').map(node => node.attrs.start)).toEqual(edge === 1 ? [1, 1] : [1]);
    editor.state.doc.check(); const moved = editor.state.doc;
    editor.commands.undo(); expect(editor.state.doc.eq(original)).toBe(true);
    editor.commands.redo(); expect(editor.state.doc.eq(moved)).toBe(true);
  }
});

it('moves an ordinary list row between tasks as its original numbered section', () => {
  const editor = create('<ol start="7"><li><p>move</p></li></ol><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>done</p></li><li data-type="taskItem" data-checked="false"><p>pending</p></li></ul><p>tail</p>');
  const original = editor.state.doc, target = original.firstChild!.nodeSize + 1 + original.child(1).firstChild!.nodeSize;
  expect(moveTopLevelBlock(editor.view, 1, target)).not.toBeNull();
  expect(editor.state.doc.content.content.map(node => node.type.name)).toEqual(['taskList', 'orderedList', 'taskList', 'paragraph']);
  expect(editor.state.doc.child(1).attrs.start).toBe(7);
  expect([editor.state.doc.firstChild!.firstChild!.attrs.checked, editor.state.doc.child(2).firstChild!.attrs.checked]).toEqual([true, false]);
  editor.state.doc.check(); editor.commands.undo(); expect(editor.state.doc.eq(original)).toBe(true);
});

it('uses logarithmic geometry reads for a 1000-item gutter hit without changing document or history', () => {
  const editor = create(`<ol>${Array.from({ length: 1000 }, (_, i) => `<li><p>row ${i}</p></li>`).join('')}</ol>`);
  const { list, items } = rows(editor), doc = editor.state.doc, selection = editor.state.selection;
  for (const item of items) vi.mocked(item.getBoundingClientRect).mockClear();
  expect(findTopLevelBlockElement(editor.view.dom, list, 100 + 987 * 30 + 15)).toBe(items[987]);
  expect(items.reduce((sum, item) => sum + vi.mocked(item.getBoundingClientRect).mock.calls.length, 0)).toBeLessThanOrEqual(11);
  expect(editor.state.doc).toBe(doc); expect(editor.state.selection).toBe(selection); expect(undoDepth(editor.state)).toBe(0);
});
