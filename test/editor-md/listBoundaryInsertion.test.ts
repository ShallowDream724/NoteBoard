import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import { buildDocumentExtensions } from '@/features/editor-md/documentExtensions';
import { isTopLevelBlockMoveAllowed, moveTopLevelBlock, resolveTopLevelDropTarget, releaseBlockDropIndex } from '@/features/editor-md/blockReorder';

const editors: Editor[] = [];
const p = (text: string): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const item = (text: string, task = false): JSONContent => ({ type: task ? 'taskItem' : 'listItem', attrs: task ? { checked: text === 'two' } : {}, content: [p(text)] });
function create(content: JSONContent[]) {
  const editor = new Editor({ extensions: buildDocumentExtensions(), content: { type: 'doc', content } });
  editor.commands.setTextSelection(1); // Materialize the same editable tail as a loaded document.
  editors.push(editor); return editor;
}
function position(editor: Editor, text: string, type: string) {
  let found = -1;
  editor.state.doc.descendants((node, pos) => { if (node.type.name === type && node.textContent === text) { found = pos; return false; } });
  expect(found).toBeGreaterThanOrEqual(0); return found;
}
afterEach(() => { editors.splice(0).forEach(editor => editor.destroy()); vi.restoreAllMocks(); });

describe('ordinary blocks between list items', () => {
  for (const sourceBefore of [false, true]) it(`splits ordered lists into independent numbering, sourceBefore=${sourceBefore}`, () => {
    const list = { type: 'orderedList', attrs: { start: 1 }, content: ['one', 'two', 'three', 'four'].map(text => item(text)) };
    const paragraph = { ...p('insert'), content: [{ type: 'text', text: 'insert', marks: [{ type: 'bold' }, { type: 'link', attrs: { href: 'https://example.com' } }] }] };
    const editor = create(sourceBefore ? [paragraph, list] : [list, paragraph]);
    const initial = editor.state.doc, source = position(editor, 'insert', 'paragraph'), target = position(editor, 'three', 'listItem');
    expect(isTopLevelBlockMoveAllowed(initial, source, target)).toBe(true);
    const result = moveTopLevelBlock(editor.view, source, target)!;
    expect(result).not.toBeNull();
    const moved = editor.state.doc;
    const blocks = moved.content.content.filter(node => node.type.name !== 'paragraph' || node.content.size);
    expect(blocks.map(node => node.type.name)).toEqual(['orderedList', 'paragraph', 'orderedList']);
    expect(blocks.map(node => node.textContent)).toEqual(['onetwo', 'insert', 'threefour']);
    expect([blocks[0].attrs.start, blocks[2].attrs.start]).toEqual([1, 1]);
    expect(moved.nodeAt(result.insertedPos)?.firstChild?.marks.map(mark => mark.type.name).sort()).toEqual(['bold', 'link']);
    moved.check(); editor.commands.undo(); expect(editor.state.doc.eq(initial)).toBe(true);
    editor.commands.redo(); expect(editor.state.doc.eq(moved)).toBe(true);
  });

  it.each(['bulletList', 'taskList'])('splits %s while retaining item identities and task state', type => {
    const editor = create([{ type, content: ['one', 'two', 'three'].map(text => item(text, type === 'taskList')) }, p('insert')]);
    const initial = editor.state.doc, original = initial.firstChild!;
    moveTopLevelBlock(editor.view, original.nodeSize, position(editor, 'three', type === 'taskList' ? 'taskItem' : 'listItem'));
    const split = editor.state.doc;
    expect(split.child(0).child(0)).toBe(original.child(0)); expect(split.child(0).child(1)).toBe(original.child(1));
    expect(split.child(2).child(0)).toBe(original.child(2));
    if (type === 'taskList') expect(split.child(0).child(1).attrs.checked).toBe(true);
    split.check(); editor.commands.undo(); expect(editor.state.doc.eq(initial)).toBe(true);
  });

  it('splits a nested list within its original parent and keeps untouched ancestor/sibling content', () => {
    const editor = create([{ type: 'bulletList', content: [
      { type: 'listItem', content: [p('parent'), { type: 'orderedList', attrs: { start: 7 }, content: ['one', 'two'].map(text => item(text)) }] }, item('sibling'),
    ] }, p('insert')]);
    const initial = editor.state.doc, sibling = initial.firstChild!.lastChild!;
    moveTopLevelBlock(editor.view, position(editor, 'insert', 'paragraph'), position(editor, 'two', 'listItem'));
    const parent = editor.state.doc.firstChild!.firstChild!;
    expect(parent.content.content.map(node => node.type.name)).toEqual(['paragraph', 'orderedList', 'paragraph', 'orderedList']);
    expect(parent.child(1).attrs.start).toBe(7); expect(parent.child(3).attrs.start).toBe(1);
    expect(editor.state.doc.firstChild!.lastChild).toBe(sibling);
    editor.state.doc.check(); editor.commands.undo(); expect(editor.state.doc.eq(initial)).toBe(true);
  });

  it('keeps a wrapper explanation on one section and retains other wrapper attributes', () => {
    const editor = create([{ type: 'orderedList', attrs: { start: 7, annotationId: 'list-note', blockBackground: '#fff0cc' }, content: ['one', 'two'].map(text => item(text)) }, p('insert')]);
    moveTopLevelBlock(editor.view, position(editor, 'insert', 'paragraph'), position(editor, 'two', 'listItem'));
    expect(editor.state.doc.child(0).attrs.annotationId).toBe('list-note');
    expect(editor.state.doc.child(2).attrs.annotationId).toBeNull();
    expect(editor.state.doc.child(0).attrs.blockBackground).toBe('#fff0cc'); expect(editor.state.doc.child(2).attrs.blockBackground).toBe('#fff0cc');
  });

  it.each(['before', 'after'])('allows %s an entire list without creating empty lists or renumbering it', edge => {
    const editor = create([{ type: 'orderedList', attrs: { start: 7 }, content: ['one', 'two'].map(text => item(text)) }, p('insert')]);
    const size = editor.state.doc.firstChild!.nodeSize;
    expect(moveTopLevelBlock(editor.view, size, edge === 'before' ? 1 : size - 1)).not.toBeNull();
    expect(editor.state.doc.content.content.filter(node => node.type.name !== 'paragraph' || node.content.size)).toHaveLength(2);
    const list = editor.state.doc.content.content.find(node => node.type.name === 'orderedList')!;
    expect(list.attrs.start).toBe(7); expect(list.childCount).toBe(2); editor.state.doc.check();
  });

  it('validates a thousand-item list without partitioning it during pointer movement', () => {
    const editor = create([{ type: 'orderedList', content: Array.from({ length: 1000 }, (_, index) => item(`row-${index}`)) }, p('insert')]);
    const list = editor.state.doc.firstChild!, cut = vi.spyOn(list.content, 'cut');
    const source = list.nodeSize, target = position(editor, 'row-500', 'listItem');
    for (let index = 0; index < 1000; index++) expect(isTopLevelBlockMoveAllowed(editor.state.doc, source, target)).toBe(true);
    expect(cut).not.toHaveBeenCalled();
    const items = editor.view.dom.querySelectorAll('li');
    const reads = vi.fn();
    items.forEach((element, index) => vi.spyOn(element.firstElementChild!, 'getBoundingClientRect').mockImplementation(() => {
      reads(); return { top: index * 40, bottom: index * 40 + 30, height: 30 } as DOMRect;
    }));
    vi.spyOn(editor.view.nodeDOM(source) as HTMLElement, 'getBoundingClientRect').mockReturnValue({ top: 40040, bottom: 40070, height: 30 } as DOMRect);
    const drop = resolveTopLevelDropTarget(editor.view, 500 * 40, source);
    expect(drop?.insertPos).toBe(target); expect(reads.mock.calls.length).toBeLessThanOrEqual(13);
    releaseBlockDropIndex(editor.view);
  });
});
