import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { buildDocumentExtensions } from '@/features/editor-md/documentExtensions';
import { resolveBlockSelection } from '@/features/editor-md/blockSelection';
import { prepareBlockSelectionMove, isBlockSelectionMoveAllowed, moveBlockSelection } from '@/features/editor-md/blockSelectionMove';
import { HeadingFolding, foldedSectionEnd, headingFoldingKey, toggleHeadingFold } from '@/features/editor-md/headingFolding';
import { moveTopLevelBlock } from '@/features/editor-md/blockReorder';

const editors: Editor[] = [];
const p = (text: string, attrs: Record<string, unknown> = {}): JSONContent => ({ type: 'paragraph', attrs, content: [{ type: 'text', text }] });
const item = (text: string, extra: JSONContent[] = [], attrs: Record<string, unknown> = {}): JSONContent => ({ type: 'listItem', attrs, content: [p(text), ...extra] });
const list = (texts: string[], start = 1): JSONContent => ({ type: 'orderedList', attrs: { start }, content: texts.map(text => item(text)) });
function create(content: JSONContent[]) {
  const editor = new Editor({ extensions: [...buildDocumentExtensions(), HeadingFolding], content: { type: 'doc', content }, editorProps: { handleScrollToSelection: () => true } });
  editors.push(editor); return editor;
}
function pos(editor: Editor, text: string, type = 'paragraph') {
  let found = -1;
  editor.state.doc.descendants((node, at) => { if (node.type.name === type && node.textContent === text) { found = at; return false; } });
  if (found < 0) throw new Error(`Missing ${type}: ${text}`); return found;
}
function plan(editor: Editor, first: string, last: string, backwards = false) {
  const from = pos(editor, first) + 1, to = pos(editor, last) + 2;
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, backwards ? to : from, backwards ? from : to)));
  const snapshot = resolveBlockSelection(editor.state)!;
  expect(snapshot).not.toBeNull();
  const prepared = prepareBlockSelectionMove(editor.state, snapshot)!;
  expect(prepared).not.toBeNull(); return prepared;
}
function blocks(editor: Editor) { return editor.state.doc.content.content.filter(node => !['annotationStore', 'documentPresentation'].includes(node.type.name) && (node.content.size || node.type.name !== 'paragraph')); }
afterEach(() => { editors.splice(0).forEach(editor => editor.destroy()); vi.restoreAllMocks(); });

describe('atomic complete-block selection movement', () => {
  it('keeps single and batch task moves consistent across numbered-list boundaries, preserving wrapper note ownership', () => {
    for (const batch of [false, true]) {
      const tasks: JSONContent = { type: 'taskList', attrs: { annotationId: 'tasks' }, content: ['todo', 'next'].map((text, index) => ({ type: 'taskItem', attrs: { checked: index === 0 }, content: [p(text)] })) };
      const editor = create([tasks, p('gap'), list(['a', 'b', 'c'], 7), p('tail')]), original = editor.state.doc;
      const target = pos(editor, 'b', 'listItem');
      if (batch) expect(moveBlockSelection(editor.view, plan(editor, 'todo', 'next'), target)).not.toBeNull();
      else expect(moveTopLevelBlock(editor.view, pos(editor, 'todo', 'taskItem'), target)).not.toBeNull();
      const sections = blocks(editor);
      expect(sections.filter(node => node.type.name === 'orderedList').map(node => node.attrs.start)).toEqual([7, 1]);
      const moved = sections.find(node => node.type.name === 'taskList' && node.firstChild!.textContent === 'todo')!;
      expect(moved.firstChild!.attrs.checked).toBe(true);
      expect(moved.attrs.annotationId).toBe(batch ? 'tasks' : null);
      if (!batch) expect(sections.find(node => node.type.name === 'taskList' && node.textContent === 'next')!.attrs.annotationId).toBe('tasks');
      editor.state.doc.check(); editor.commands.undo(); expect(editor.state.doc.eq(original)).toBe(true);
    }
  });

  it('retains the explanation of a sole moved list wrapper instead of discarding it on a compatible merge', () => {
    const single = list(['move']); single.attrs = { ...single.attrs, annotationId: 'wrapper' };
    const editor = create([single, p('gap'), list(['a', 'b'])]);
    expect(moveTopLevelBlock(editor.view, pos(editor, 'move', 'listItem'), pos(editor, 'b', 'listItem'))).not.toBeNull();
    expect(blocks(editor).filter(node => node.attrs.annotationId === 'wrapper').map(node => node.textContent)).toEqual(['move']);
    editor.state.doc.check();
  });
  it('reorders several sibling items with one undo and restores their complete selection and direction', () => {
    const editor = create([list(['one', 'two', 'three', 'four'], 7), p('tail')]);
    const initial = editor.state.doc, prepared = plan(editor, 'one', 'two', true);
    const moved = moveBlockSelection(editor.view, prepared, initial.firstChild!.nodeSize - 1);
    expect(moved).not.toBeNull();
    expect(editor.state.doc.firstChild!.textContent).toBe('threefouronetwo');
    expect(editor.state.doc.firstChild!.attrs.start).toBe(7);
    expect(resolveBlockSelection(editor.state)!.items.map(entry => entry.node.textContent)).toEqual(['one', 'two']);
    expect(editor.state.selection.anchor).toBeGreaterThan(editor.state.selection.head);
    const after = editor.state.doc;
    editor.commands.undo(); expect(editor.state.doc.eq(initial)).toBe(true);
    editor.commands.redo(); expect(editor.state.doc.eq(after)).toBe(true);
  });

  it('moves items out as a numbered list and retains every original item object', () => {
    const editor = create([list(['one', 'two', 'three', 'four'], 7), p('tail')]);
    const prepared = plan(editor, 'two', 'three'), nodes = prepared.snapshot.items.map(entry => entry.node);
    expect(moveBlockSelection(editor.view, prepared, editor.state.doc.content.size)).not.toBeNull();
    const moved = blocks(editor).at(-1)!;
    expect(moved.type.name).toBe('orderedList'); expect(moved.attrs.start).toBe(8);
    expect(moved.child(0)).toBe(nodes[0]); expect(moved.child(1)).toBe(nodes[1]);
    expect(editor.state.doc.firstChild!.textContent).toBe('onefour'); editor.state.doc.check();
  });

  it('moves paragraphs and portions of two lists into a third list boundary as separate sections', () => {
    const editor = create([list(['a', 'b'], 4), p('middle'), list(['c', 'd'], 9), p('gap'), list(['x', 'y', 'z'], 12)]);
    // Include a partial endpoint in each source list; normalization moves b and c whole.
    const prepared = plan(editor, 'b', 'c'), initial = editor.state.doc;
    expect(moveBlockSelection(editor.view, prepared, pos(editor, 'y', 'listItem'))).not.toBeNull();
    expect(blocks(editor).map(node => node.textContent)).toEqual(['a', 'd', 'gap', 'x', 'b', 'middle', 'c', 'yz']);
    expect(blocks(editor).filter(node => node.type.name === 'orderedList').map(node => node.attrs.start)).toEqual([4, 9, 12, 5, 9, 1]);
    expect(resolveBlockSelection(editor.state)!.items.map(entry => entry.node.textContent)).toEqual(['b', 'middle', 'c']);
    editor.state.doc.check(); editor.commands.undo(); expect(editor.state.doc.eq(initial)).toBe(true);
  });

  it('reorders nested siblings in their parent list and keeps unselected ancestors and siblings', () => {
    const nested = list(['one', 'two', 'three', 'four'], 3);
    const editor = create([{ type: 'bulletList', content: [item('parent', [nested]), item('sibling')] }, p('tail')]);
    const initial = editor.state.doc, sibling = initial.firstChild!.lastChild!, prepared = plan(editor, 'one', 'two');
    const end = pos(editor, 'four', 'listItem') + editor.state.doc.nodeAt(pos(editor, 'four', 'listItem'))!.nodeSize;
    expect(moveBlockSelection(editor.view, prepared, end)).not.toBeNull();
    const outer = editor.state.doc.firstChild!;
    expect(outer.firstChild!.firstChild!.textContent).toBe('parent');
    expect(outer.firstChild!.lastChild!.textContent).toBe('threefouronetwo');
    expect(outer.lastChild).toBe(sibling); editor.state.doc.check();
  });

  it('removes an emptied nested wrapper while retaining its unselected ancestor', () => {
    const editor = create([{ type: 'bulletList', content: [item('parent', [list(['one', 'two'])]), item('sibling')] }, p('tail')]);
    const prepared = plan(editor, 'one', 'two');
    expect(moveBlockSelection(editor.view, prepared, editor.state.doc.content.size)).not.toBeNull();
    expect(editor.state.doc.firstChild!.firstChild!.childCount).toBe(1);
    expect(blocks(editor).at(-1)!.textContent).toBe('onetwo'); editor.state.doc.check();
  });

  it('preserves styles, links, item annotations and the sole owning wrapper annotation', () => {
    const marked = p('one', { blockBackground: '#ff0000', annotationId: 'row-note' });
    marked.content![0].marks = [{ type: 'bold' }, { type: 'link', attrs: { href: 'https://example.com' } }];
    const editor = create([{ type: 'orderedList', attrs: { start: 7, annotationId: 'wrapper-note', blockBackground: '#fff0cc' }, content: [
      { ...item('one', [], { annotationId: 'row-note' }), content: [marked] }, item('two'), item('three'),
    ] }, p('tail')]);
    const initial = editor.state.doc, prepared = plan(editor, 'one', 'two');
    expect(moveBlockSelection(editor.view, prepared, initial.content.size)).not.toBeNull();
    const source = editor.state.doc.firstChild!, moved = blocks(editor).at(-1)!;
    expect(source.attrs.annotationId).toBe('wrapper-note'); expect(moved.attrs.annotationId).toBeNull();
    expect(moved.attrs.blockBackground).toBe('#fff0cc');
    expect(moved.child(0)).toBe(initial.firstChild!.child(0)); expect(moved.child(1)).toBe(initial.firstChild!.child(1));
    expect(moved.firstChild!.firstChild!.attrs.annotationId).toBe('row-note'); editor.state.doc.check();
  });

  it('moves a full annotated list without losing its wrapper or leaving an empty list', () => {
    const editor = create([{ ...list(['one', 'two'], 8), attrs: { start: 8, annotationId: 'wrapper-note' } }, p('tail'), list(['x', 'y'])]);
    const original = editor.state.doc.firstChild!, prepared = plan(editor, 'one', 'two');
    expect(moveBlockSelection(editor.view, prepared, pos(editor, 'y', 'listItem'))).not.toBeNull();
    expect(blocks(editor).map(node => node.textContent)).toEqual(['tail', 'x', 'onetwo', 'y']);
    expect(blocks(editor)[2]).toBe(original); editor.state.doc.check();
  });

  it('keeps numbered wrapper attributes when moving a partial run across lists', () => {
    const editor = create([{ ...list(['one', 'two', 'three'], 8), attrs: { start: 8, blockBackground: '#ffeedd' } }, p('tail'), list(['x', 'y'], 20)]);
    const prepared = plan(editor, 'one', 'two');
    expect(moveBlockSelection(editor.view, prepared, pos(editor, 'y', 'listItem'))).not.toBeNull();
    const visible = blocks(editor);
    expect(visible.map(node => node.textContent)).toEqual(['three', 'tail', 'x', 'onetwo', 'y']);
    expect(visible[3].attrs).toMatchObject({ start: 8, blockBackground: '#ffeedd' });
    expect(visible[4].attrs.start).toBe(1); editor.state.doc.check();
  });

  it('retains an image at the first boundary and an empty paragraph at the last boundary in the moved selection', () => {
    const editor = create([{ type: 'image', attrs: { src: 'https://example.com/image.png' } }, p('one'), { type: 'paragraph' }, p('tail')]);
    const image = editor.state.doc.firstChild!, empty = image.nodeSize + editor.state.doc.child(1).nodeSize;
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 0, empty + 2)));
    const snapshot = resolveBlockSelection(editor.state)!;
    expect(snapshot.items).toHaveLength(3);
    const prepared = prepareBlockSelectionMove(editor.state, snapshot)!;
    expect(moveBlockSelection(editor.view, prepared, editor.state.doc.content.size)).not.toBeNull();
    expect(resolveBlockSelection(editor.state)!.items.map(entry => entry.node.type.name)).toEqual(['image', 'paragraph', 'paragraph']);
    editor.state.doc.check();
  });

  it('rejects source interiors, cells, code content, different disclosure scopes and stale documents', () => {
    const editor = create([p('one'), p('two'), { type: 'codeBlock', content: [{ type: 'text', text: 'code' }] },
      { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [p('cell')] }] }] },
      { type: 'disclosure', content: [p('inside'), p('next')] }, p('tail')]);
    const prepared = plan(editor, 'one', 'two'), initial = editor.state.doc;
    for (const target of [prepared.snapshot.from, prepared.snapshot.to, pos(editor, 'code', 'codeBlock') + 1, pos(editor, 'cell') + 1, pos(editor, 'inside')]) {
      expect(isBlockSelectionMoveAllowed(prepared, target)).toBe(false);
      expect(moveBlockSelection(editor.view, prepared, target)).toBeNull();
    }
    expect(editor.state.doc.eq(initial)).toBe(true);
    editor.view.dispatch(editor.state.tr.insertText('!', pos(editor, 'tail') + 1));
    expect(moveBlockSelection(editor.view, prepared, 0)).toBeNull();
  });

  it('prepares a thousand-item run once and previews without cutting list fragments', () => {
    const editor = create([list(Array.from({ length: 1000 }, (_, index) => `row-${index}`)), p('tail')]);
    const prepared = plan(editor, 'row-200', 'row-700'), target = pos(editor, 'row-900', 'listItem');
    const cut = vi.spyOn(editor.state.doc.firstChild!.content, 'cut');
    const descendants = vi.spyOn(editor.state.doc, 'descendants');
    for (let index = 0; index < 100; index++) expect(isBlockSelectionMoveAllowed(prepared, target)).toBe(true);
    expect(cut).not.toHaveBeenCalled(); expect(descendants).not.toHaveBeenCalled();
    expect(moveBlockSelection(editor.view, prepared, target)).not.toBeNull();
    expect(editor.state.doc.firstChild!.childCount).toBe(1000); editor.state.doc.check();
  });

  it('moves the hidden section of a final folded heading once, including nested folding across added list wrappers', () => {
    const h = (text: string, level = 2): JSONContent => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text }] });
    const editor = create([list(['a', 'b'], 5), h('chapter'), p('hidden'), h('subchapter', 3), p('child'), h('next'), p('tail')]);
    toggleHeadingFold(editor.state, editor.view.dispatch, pos(editor, 'chapter', 'heading'));
    toggleHeadingFold(editor.state, editor.view.dispatch, pos(editor, 'subchapter', 'heading'));
    const initial = editor.state.doc;
    const from = pos(editor, 'b') + 1, to = pos(editor, 'chapter', 'heading') + 2;
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)));
    const snapshot = resolveBlockSelection(editor.state)!;
    expect(snapshot.items.map(entry => entry.node.textContent)).toEqual(['b', 'chapter']);
    const prepared = prepareBlockSelectionMove(editor.state, snapshot)!;
    expect(prepared.effectiveTo).toBe(pos(editor, 'next', 'heading'));
    expect(prepared.snapshot.to).toBe(snapshot.to);
    expect(isBlockSelectionMoveAllowed(prepared, pos(editor, 'child'))).toBe(false);
    expect(moveBlockSelection(editor.view, prepared, initial.content.size)).not.toBeNull();
    expect(blocks(editor).map(node => node.textContent)).toEqual(['a', 'next', 'tail', 'b', 'chapter', 'hidden', 'subchapter', 'child']);
    const chapter = pos(editor, 'chapter', 'heading'), subchapter = pos(editor, 'subchapter', 'heading');
    expect(headingFoldingKey.getState(editor.state)!.folds.has(chapter)).toBe(true);
    expect(headingFoldingKey.getState(editor.state)!.folds.has(subchapter)).toBe(true);
    expect(foldedSectionEnd(editor.state, chapter)).toBe(editor.state.doc.content.size);
    editor.state.doc.check(); editor.commands.undo(); expect(editor.state.doc.eq(initial)).toBe(true);
  });
});
