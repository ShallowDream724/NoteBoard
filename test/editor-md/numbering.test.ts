import { afterEach, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { Fragment } from '@tiptap/pm/model';
import { NodeSelection } from '@tiptap/pm/state';
import { buildDocumentExtensions } from '@/features/editor-md/documentExtensions';
import { continueNumbering, createNumberingDraft, getNumberingContext, restartNumbering, setNumberingStyle } from '@/features/editor-md/numbering/numbering';
import { insertAtListBoundary } from '@/features/editor-md/listBoundaryInsertion';
import * as numberingModel from '@/features/editor-md/numbering/model';

const editors: Editor[] = [];
const item = (text: string) => `<li><p>${text}</p></li>`;
const ol = (text: string[], attrs = '') => `<ol ${attrs}>${text.map(item).join('')}</ol>`;
function create(content: string) { const editor = new Editor({ extensions: buildDocumentExtensions(), content, editorProps: { handleScrollToSelection: () => true } }); editor.commands.setTextSelection(3); editors.push(editor); return editor; }
function items(editor: Editor) { const found: number[] = []; editor.state.doc.descendants((node, pos) => { if (node.type.name === 'listItem') found.push(pos); }); return found; }
function lists(editor: Editor) { const found: { pos: number; start: number; count: number; style: string | null; mode: string | null; text: string }[] = []; editor.state.doc.descendants((node, pos) => { if (node.type.name === 'orderedList') found.push({ pos, start: node.attrs.start, count: node.childCount, style: node.attrs.numberStyle, mode: node.attrs.numbering, text: node.textContent }); }); return found; }
function caret(editor: Editor, index: number) { editor.commands.setTextSelection(items(editor)[index] + 2); }
function markers(editor: Editor) { return lists(editor).flatMap(list => Array.from({ length: list.count }, (_, index) => list.start + index)); }
afterEach(() => { editors.splice(0).forEach(editor => editor.destroy()); vi.restoreAllMocks(); });

it('keeps one sequence across an inserted formula/media/paragraph, with reversible structure', () => {
  for (const type of ['paragraph', 'mathBlock', 'horizontalRule', 'image']) {
    const editor = create(ol(['a', 'b', 'c', 'd']));
    const before = editor.state.doc, pos = items(editor)[3], node = editor.schema.nodes[type].create(type === 'mathBlock' ? { latex: 'x' } : null);
    const tr = editor.state.tr; expect(insertAtListBoundary(tr, pos, Fragment.from(node))).not.toBeNull(); editor.view.dispatch(tr);
    expect(markers(editor)).toEqual([1, 2, 3, 4]); expect(lists(editor)[1].mode).toBe('continue');
    editor.commands.undo(); expect(editor.state.doc.toJSON(), type).toEqual(before.toJSON());
  }
});
it('converting an item to a task removes only its ordinal and reflows the linked suffix', () => {
  const editor = create(ol(['a', 'b', 'c', 'd', 'e'])); caret(editor, 2);
  editor.commands.toggleTaskList();
  expect(markers(editor)).toEqual([1, 2, 3, 4]); expect(editor.state.doc.child(1).type.name).toBe('taskList');
  const todo = lists(editor)[0].pos + editor.state.doc.firstChild!.nodeSize;
  editor.commands.setTextSelection(todo + 3); editor.commands.toggleOrderedList();
  expect(markers(editor)).toEqual([1, 2, 3, 4, 5]);
});
it('toggle-off preserves following list items and clicking again restores their sequence', () => {
  const editor = create(ol(['a', 'b', 'c', 'd'])); caret(editor, 1);
  editor.commands.toggleOrderedList(); expect(markers(editor)).toEqual([1, 2, 3]);
  expect(editor.state.doc.child(1).type.name).toBe('paragraph');
  editor.commands.toggleOrderedList(); expect(markers(editor)).toEqual([1, 2, 3, 4]);
});
it('Backspace at the first text position removes the marker without merging text', () => {
  const editor = create(ol(['first', 'second', 'third'])); caret(editor, 1);
  const event = new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true });
  editor.view.dom.dispatchEvent(event);
  expect(editor.state.doc.child(1).type.name).toBe('paragraph'); expect(editor.state.doc.child(1).textContent).toBe('second');
  expect(markers(editor)).toEqual([1, 2]); expect(editor.state.selection.empty).toBe(true);
});
it('style from a caret or item handle applies to the entire linked group only', () => {
  const editor = create(ol(['a', 'b']) + '<p>gap</p>' + ol(['c', 'd'], 'start="3" data-numbering="continue"') + '<p>new group</p>' + ol(['z']));
  editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, items(editor)[2])));
  expect(setNumberingStyle(editor, 'circle')).toBe(true);
  expect(lists(editor).map(list => list.style)).toEqual(['circle', 'circle', null]); expect(markers(editor)).toEqual([1, 2, 3, 4, 1]);
});
it('explicit selection changes only its rows while preserving numeric values and text selection', () => {
  const editor = create(ol(['aaa', 'bbb', 'ccc', 'ddd', 'eee'])); const positions = items(editor);
  editor.commands.setTextSelection({ from: positions[2] + 2, to: positions[4] + 5 });
  const text = editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, '|');
  setNumberingStyle(editor, 'upper-roman');
  expect(lists(editor).map(list => [list.start, list.count, list.style])).toEqual([[1, 2, null], [3, 3, 'upper-roman']]);
  expect(editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, '|')).toBe(text);
});
it('nested groups do not inherit a parent sequence style change', () => {
  const editor = create('<ol><li><p>outer</p>' + ol(['child', 'child2']) + '</li>' + item('outer2') + '</ol>'); caret(editor, 0);
  setNumberingStyle(editor, 'box'); expect(lists(editor).map(list => list.style)).toEqual(['box', null]);
});
it('continue joins the previous group across content without scrolling the view', () => {
  const editor = create(ol(['a', 'b']) + '<p>many paragraphs later</p>' + ol(['c', 'd'], 'start="7"'));
  caret(editor, 2); const context = getNumberingContext(editor), update = vi.fn(); editor.on('transaction', ({ transaction }) => { if (transaction.scrolledIntoView) update(); });
  expect(context).toMatchObject({ next: 3, start: 7, previousText: 'b', currentText: 'c' });
  continueNumbering(editor); expect(markers(editor)).toEqual([1, 2, 3, 4]); expect(update).not.toHaveBeenCalled();
});
it('an explicit restart stops linkage, while continuation can remove that boundary', () => {
  const editor = create(ol(['a', 'b', 'c', 'd'])); caret(editor, 2);
  restartNumbering(editor, 1); expect(markers(editor)).toEqual([1, 2, 1, 2]); expect(lists(editor)[1].mode).toBe('restart');
  setNumberingStyle(editor, 'chinese'); expect(lists(editor).map(list => list.style)).toEqual([null, 'chinese']);
  continueNumbering(editor); expect(markers(editor)).toEqual([1, 2, 3, 4]);
});
it('editing a start reflows all following linked fragments and leaves unrelated lists alone', () => {
  const editor = create(ol(['a', 'b']) + '<p>gap</p>' + ol(['c', 'd'], 'start="3" data-numbering="continue"') + '<p>other</p>' + ol(['z']));
  caret(editor, 1); restartNumbering(editor, 7);
  expect(markers(editor)).toEqual([1, 7, 8, 9, 1]);
});
it('live numeric editing commits as one undo and Escape-style cancellation never publishes', () => {
  const editor = create(ol(['a', 'b', 'c', 'd'])); caret(editor, 2); const before = editor.state.doc;
  const published = vi.fn(); editor.on('update', published);
  const canceled = createNumberingDraft(editor); canceled.update(7); canceled.update(12); expect(markers(editor)).toEqual([1, 2, 12, 13]);
  expect(published).not.toHaveBeenCalled(); canceled.cancel(); canceled.destroy(); expect(editor.state.doc.eq(before)).toBe(true);
  const draft = createNumberingDraft(editor); draft.update(7); draft.update(12); draft.commit(); draft.destroy();
  expect(published).toHaveBeenCalledTimes(1); expect(markers(editor)).toEqual([1, 2, 12, 13]);
  editor.commands.undo(); expect(editor.state.doc.eq(before)).toBe(true);
});
it('invalid starts and repeated opens do not change the document', () => {
  const editor = create(ol(['a', 'b'])); caret(editor, 1); const before = editor.state.doc;
  for (const number of [0, -1, 1.1, NaN, Infinity, 1e10]) expect(restartNumbering(editor, number)).toBe(false);
  createNumberingDraft(editor).destroy(); expect(editor.state.doc).toBe(before);
});
it('the context getter for a side target is pure', () => {
  const editor = create(ol(['a', 'b']) + '<p>end</p>'); editor.commands.setTextSelection(editor.state.doc.content.size - 1);
  const before = editor.state; expect(getNumberingContext(editor, items(editor)[1])).toMatchObject({ available: true, start: 2 }); expect(editor.state).toBe(before);
});
it.each(['delete', 'task', 'paragraph'])('transfers a removed group head without attaching to a preceding independent list: %s', action => {
  const editor = create(ol(['unrelated'], 'start="20"') + '<p>separator</p>' + ol(['a', 'b']) + '<p>gap</p>' + ol(['c', 'd'], 'start="3" data-numbering="continue"'));
  const head = lists(editor)[1], node = editor.state.doc.nodeAt(head.pos)!;
  if (action === 'delete') editor.view.dispatch(editor.state.tr.delete(head.pos, head.pos + node.nodeSize));
  else {
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, head.pos)));
    if (action === 'task') editor.commands.toggleTaskList(); else editor.commands.restoreParagraph();
  }
  expect(markers(editor)).toEqual([20, 1, 2]); expect(lists(editor).at(-1)?.mode).toBeNull();
});
it('Enter on an empty middle item preserves the remaining sequence', () => {
  const editor = create(ol(['a', '', 'c', 'd'])); caret(editor, 1);
  editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  expect(markers(editor)).toEqual([1, 2, 3]); expect(editor.state.doc.child(1).type.name).toBe('paragraph');
});
it.each([1, 2])('Enter in the first item preserves linked group identity with %i original head items', count => {
  const editor = create(ol(['aaa', 'bbb'].slice(0, count)) + '<p>gap</p>' + ol(['ccc', 'ddd'], `start="${count + 1}" data-numbering="continue"`));
  editor.commands.setTextSelection(items(editor)[0] + 3); editor.commands.splitListItem('listItem');
  expect(lists(editor).map(list => [list.start, list.count, list.mode])).toEqual([[1, count + 1, null], [count + 2, 2, 'continue']]);
});
it('ordered fragments dropped into a sequence take their new ordinal position', () => {
  const editor = create(ol(['a', 'b', 'c']));
  const inserted = editor.schema.nodes.orderedList.create({ start: 7 }, editor.schema.nodes.listItem.create(null, editor.schema.nodes.paragraph.create(null, editor.schema.text('insert'))));
  const tr = editor.state.tr; insertAtListBoundary(tr, items(editor)[1], Fragment.from(inserted)); editor.view.dispatch(tr);
  expect(markers(editor)).toEqual([1, 2, 3, 4]);
});
it('settles a live draft before an unrelated async edit, retaining two independent undo steps', () => {
  const editor = create(ol(['a', 'b', 'c']) + '<p>outside</p>'); caret(editor, 1);
  const initial = editor.state.doc, published = vi.fn(); editor.on('update', published);
  const draft = createNumberingDraft(editor); draft.update(7);
  editor.view.dispatch(editor.state.tr.insertText('x', editor.state.doc.content.size - 1));
  expect(published).toHaveBeenCalledTimes(2); draft.cancel(); expect(markers(editor)).toEqual([1, 7, 8]);
  expect(editor.state.doc.lastChild!.textContent).toBe('outsidex');
  editor.commands.undo(); expect(editor.state.doc.lastChild!.textContent).toBe('outside'); expect(markers(editor)).toEqual([1, 7, 8]);
  editor.commands.undo(); expect(editor.state.doc.eq(initial)).toBe(true);
});
it('batches a thousand linked fragments into one undo step with shared item content', () => {
  const editor = create(Array.from({ length: 1000 }, (_, index) => ol([`item${index}`], `start="${index + 1}"${index ? ' data-numbering="continue"' : ''}`) + '<p>gap</p>').join(''));
  const before = editor.state.doc, content = before.firstChild!.content, counts: number[] = [];
  editor.on('transaction', ({ transaction }) => { if (transaction.docChanged) counts.push(transaction.steps.length); });
  const started = performance.now(); setNumberingStyle(editor, 'circle');
  console.info('1000-fragment numbering style batch:', Math.round(performance.now() - started), 'ms');
  expect(counts).toEqual([1]); expect(editor.state.doc.firstChild!.content).toBe(content);
  expect(lists(editor).every(list => list.style === 'circle')).toBe(true);
  editor.commands.undo(); expect(editor.state.doc.eq(before)).toBe(true);
});
it('ordinary text input does not run numbering normalization', () => {
  const editor = create(ol(['a', 'b']) + '<p>gap</p>' + ol(['c'], 'start="3" data-numbering="continue"'));
  const normalize = vi.spyOn(numberingModel, 'normalizeNumbering');
  editor.commands.insertContent('letters'); expect(normalize).not.toHaveBeenCalled();
});
it('generated continuation starts do not reset at the nine-digit input limit', () => {
  const editor = create(ol(['a', 'b']) + '<p>gap</p>' + ol(['c', 'd'], 'start="3" data-numbering="continue"'));
  caret(editor, 0); restartNumbering(editor, 999999999);
  expect(markers(editor)).toEqual([999999999, 1000000000, 1000000001, 1000000002]);
  caret(editor, 2); expect(getNumberingContext(editor).start).toBe(1000000001);
});
