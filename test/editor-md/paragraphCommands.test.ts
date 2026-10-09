import { afterEach, describe, expect, it } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import { AllSelection, NodeSelection, TextSelection } from '@tiptap/pm/state';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import { buildDocumentExtensions } from '../../src/features/editor-md/documentExtensions';
import { MarkdownTypingKeys } from '../../src/features/editor-md/typingAssist';

const editors: Editor[] = [];
afterEach(() => editors.splice(0).forEach(editor => editor.destroy()));
function create(content: string | JSONContent) { const editor = new Editor({ extensions: buildDocumentExtensions(), content }); editors.push(editor); return editor; }
function block(editor: Editor, text: string) {
  let found = -1;
  editor.state.doc.descendants((node, pos) => { if (node.isTextblock && node.textContent === text) { found = pos; return false; } });
  if (found < 0) throw new Error(`Missing block: ${text}`);
  return found;
}
function caret(editor: Editor, text: string, offset = 0) { editor.commands.setTextSelection(block(editor, text) + 1 + offset); }
function range(editor: Editor, first: string, last: string, backward = false) {
  const from = block(editor, first) + 1, to = block(editor, last) + 1 + last.length;
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, backward ? to : from, backward ? from : to)));
}
function restore(editor: Editor) { expect(editor.commands.restoreParagraph()).toBe(true); editor.state.doc.check(); }
function types(editor: Editor) { return editor.getJSON().content?.filter(node => node.type !== 'paragraph' || node.content?.length).map(node => node.type); }
function nodePos(editor: Editor, type: string) { let found = -1; editor.state.doc.descendants((node, pos) => { if (found < 0 && node.type.name === type) { found = pos; return false; } }); return found; }

describe('restore paragraph structure', () => {
  it('rejects rectangular cell selections consistently through can(), the command and Ctrl+0', () => {
    const editor = new Editor({ extensions: [...buildDocumentExtensions(), MarkdownTypingKeys], content: '<table><tr><td><h2>heading</h2></td><td><ul><li>item</li></ul></td></tr></table>' }); editors.push(editor);
    const table = editor.state.doc.firstChild!, map = TableMap.get(table);
    editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc, 1 + map.map[0], 1 + map.map[1])));
    const doc = editor.state.doc, selection = editor.state.selection;
    expect(editor.can().restoreParagraph()).toBe(false); expect(editor.commands.restoreParagraph()).toBe(false);
    expect(editor.state.doc).toBe(doc); expect(editor.state.selection.eq(selection)).toBe(true);
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: '0', code: 'Digit0', ctrlKey: true, bubbles: true, cancelable: true }));
    expect(editor.state.doc).toBe(doc); expect(editor.state.selection.eq(selection)).toBe(true);
  });
  it('restores only the caret item, retaining marks, sibling numbering and one undo/redo', () => {
    const editor = create('<ol start="5"><li>before</li><li><b>target</b><a href="https://example.com">link</a></li><li>after</li></ol>');
    caret(editor, 'targetlink', 2); const before = editor.getJSON(); restore(editor);
    expect(types(editor)).toEqual(['orderedList', 'paragraph', 'orderedList']);
    expect(editor.state.doc.child(0).attrs.start).toBe(5); expect(editor.state.doc.child(2).attrs.start).toBe(7);
    expect(editor.state.doc.child(1).firstChild?.marks[0].type.name).toBe('bold');
    expect(editor.state.doc.child(1).lastChild?.marks[0].attrs.href).toBe('https://example.com');
    expect(editor.state.selection.$from.parent.textContent).toBe('targetlink'); expect(editor.state.selection.$from.parentOffset).toBe(2);
    const restored = editor.getJSON(); editor.commands.undo(); expect(editor.getJSON()).toEqual(before);
    editor.commands.redo(); expect(editor.getJSON()).toEqual(restored);
  });
  it('restores continuous backward selection across lists, ordinary prose and headings', () => {
    const editor = create('<ul><li>before</li><li>first</li></ul><h2>heading</h2><p>prose</p><ol start="3"><li>last</li><li>after</li></ol>');
    range(editor, 'first', 'last', true); restore(editor);
    expect(types(editor)).toEqual(['bulletList', 'paragraph', 'paragraph', 'paragraph', 'paragraph', 'orderedList']);
    expect(editor.state.doc.firstChild?.textContent).toBe('before'); expect(editor.state.doc.child(5).textContent).toBe('after');
    expect(editor.state.doc.child(5).attrs.start).toBe(4);
    expect(editor.state.selection.anchor).toBeGreaterThan(editor.state.selection.head);
    expect(editor.state.selection.$anchor.parent.textContent).toBe('last'); expect(editor.state.selection.$head.parent.textContent).toBe('first');
  });
  it('restores a nested item locally without flattening ancestor text or preceding nested items', () => {
    const editor = create('<ul><li><p>parent</p><ul><li>nested before</li><li>nested target</li></ul><p>parent tail</p></li><li>sibling</li></ul>');
    caret(editor, 'nested target', 3); restore(editor);
    const list = editor.state.doc.firstChild!, item = list.firstChild!;
    expect(list.type.name).toBe('bulletList'); expect(list.childCount).toBe(2);
    expect(Array.from({ length: item.childCount }, (_, index) => item.child(index).type.name)).toEqual(['paragraph', 'bulletList', 'paragraph', 'paragraph']);
    expect(item.child(1).textContent).toBe('nested before'); expect(item.child(2).textContent).toBe('nested target');
    expect(editor.state.selection.$from.parent.textContent).toBe('nested target'); expect(editor.state.selection.$from.parentOffset).toBe(3);
  });
  it('keeps unselected nested lists and media when restoring an ancestor item body', () => {
    const editor = create('<ul><li><p>parent</p><ul><li>nested</li></ul><p>tail</p><img src="image.png"></li><li>sibling</li></ul>');
    caret(editor, 'parent'); const image = editor.state.doc.nodeAt(nodePos(editor, 'image')); restore(editor);
    expect(types(editor)).toEqual(['paragraph', 'bulletList', 'paragraph', 'image', 'bulletList']);
    expect(editor.state.doc.child(1).textContent).toBe('nested'); expect(editor.state.doc.child(4).textContent).toBe('sibling');
    expect(editor.state.doc.nodeAt(nodePos(editor, 'image'))).toBe(image);
  });
  it('restores whole-list and item NodeSelections, including selected nested descendants', () => {
    for (const itemOnly of [false, true]) {
      const editor = create('<ul><li><p>first</p><ul><li><p>nested</p></li></ul></li><li>second</li></ul>');
      const pos = itemOnly ? 1 : 0;
      editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos))); restore(editor);
      expect(types(editor)).toEqual(itemOnly ? ['paragraph', 'paragraph', 'bulletList'] : ['paragraph', 'paragraph', 'paragraph']);
      expect(editor.state.selection.$from.parent.textContent).toBe('first'); expect(editor.state.selection.$to.parent.textContent).toBe(itemOnly ? 'nested' : 'second');
    }
  });
  it('splits ordinary quotes around only the selected heading and retains its text marks', () => {
    const editor = create('<blockquote><p>before</p><h2><em>target</em></h2><p>after</p></blockquote>');
    caret(editor, 'target', 2); restore(editor);
    expect(types(editor)).toEqual(['blockquote', 'paragraph', 'blockquote']);
    expect(editor.state.doc.child(1).firstChild?.marks[0].type.name).toBe('italic');
    expect(editor.state.doc.firstChild?.textContent).toBe('before'); expect(editor.state.doc.child(2).textContent).toBe('after');
  });
  it('restores a whole quote NodeSelection, preserving images and code blocks', () => {
    const editor = create('<blockquote><h2>heading</h2><p>text</p><img src="image.png"><pre><code>code</code></pre></blockquote><p>outside</p>');
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 0))); restore(editor);
    expect(types(editor)).toEqual(['paragraph', 'paragraph', 'image', 'codeBlock', 'paragraph']);
    expect(editor.state.doc.textContent).toBe('headingtextcodeoutside');
    expect(editor.state.selection.$to.parent.textContent).toBe('code');
  });
  it('restores selected list items inside a quote without releasing its unselected text or items', () => {
    const editor = create('<blockquote><p>quote before</p><ul><li>before</li><li>target</li><li>after</li></ul><p>quote after</p></blockquote>');
    caret(editor, 'target'); restore(editor);
    expect(types(editor)).toEqual(['blockquote', 'paragraph', 'blockquote']);
    expect(editor.state.doc.child(0).textContent).toBe('quote beforebefore'); expect(editor.state.doc.child(2).textContent).toBe('afterquote after');
    expect(editor.state.doc.child(0).lastChild?.type.name).toBe('bulletList'); expect(editor.state.doc.child(2).firstChild?.type.name).toBe('bulletList');
  });
  it('does not include the next item when the selection ends at the start of its text', () => {
    const editor = create('<ul><li>selected</li><li>next</li></ul>');
    editor.commands.setTextSelection({ from: block(editor, 'selected') + 1, to: block(editor, 'next') + 1 }); restore(editor);
    expect(types(editor)).toEqual(['paragraph', 'bulletList']); expect(editor.state.doc.child(1).textContent).toBe('next');
  });
  it('restores an empty task item while retaining its unselected checked sibling', () => {
    const editor = create({ type: 'doc', content: [{ type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph' }] }, { type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'checked' }] }] }] }] });
    editor.commands.setTextSelection(3); restore(editor);
    expect(editor.state.doc.firstChild?.type.name).toBe('paragraph'); expect(editor.state.doc.firstChild?.content.size).toBe(0);
    expect(editor.state.doc.child(1).type.name).toBe('taskList'); expect(editor.state.doc.child(1).firstChild?.attrs.checked).toBe(true);
  });
  it('restores AllSelection while retaining tables, semantic Callouts and disclosures', () => {
    const p = (text: string): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text }] });
    const quote = (text: string): JSONContent => ({ type: 'blockquote', content: [p(text)] });
    const editor = create({ type: 'doc', content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'heading' }] }, { type: 'bulletList', content: [{ type: 'listItem', content: [p('item')] }] }, { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [quote('cell')] }] }] }, { type: 'githubAlert', attrs: { kind: 'note' }, content: [quote('callout')] }, { type: 'disclosure', attrs: { title: 'title' }, content: [quote('disclosure')] }, { type: 'image', attrs: { src: 'image.png' } }] });
    editor.view.dispatch(editor.state.tr.setSelection(new AllSelection(editor.state.doc))); restore(editor);
    expect(types(editor)).toEqual(['paragraph', 'paragraph', 'table', 'githubAlert', 'disclosure', 'image']);
    expect(editor.state.selection).toBeInstanceOf(AllSelection);
    for (const type of ['tableCell', 'githubAlert', 'disclosure']) expect(editor.state.doc.nodeAt(nodePos(editor, type))?.firstChild?.type.name).toBe('paragraph');
  });
  it('keeps outer quotes when selection belongs to a semantic container inside them', () => {
    const editor = create({ type: 'doc', content: [{ type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'outer' }] }, { type: 'githubAlert', attrs: { kind: 'note' }, content: [{ type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'inside' }] }] }] }] }] });
    caret(editor, 'inside'); restore(editor);
    expect(types(editor)).toEqual(['blockquote']);
    const alert = editor.state.doc.nodeAt(nodePos(editor, 'githubAlert'))!; expect(alert.firstChild?.type.name).toBe('paragraph');
    expect(editor.state.doc.firstChild?.firstChild?.textContent).toBe('outer');
  });
  it('uses only restoration-step mappings after earlier insertion or deletion in a chain', () => {
    for (const deleting of [false, true]) {
      const editor = create('<ul><li>before</li><li>target</li><li>after</li></ul>');
      caret(editor, 'target', 3);
      const targetPos = block(editor, 'target') + 1;
      const chain = deleting ? editor.chain().deleteRange({ from: targetPos, to: targetPos + 1 }) : editor.chain().insertContent('X');
      expect(chain.restoreParagraph().run()).toBe(true); editor.state.doc.check();
      expect(editor.state.selection.$from.parent.textContent).toBe(deleting ? 'arget' : 'tarXget');
      expect(editor.state.selection.$from.parentOffset).toBe(deleting ? 2 : 4);
      expect(types(editor)).toEqual(['bulletList', 'paragraph', 'bulletList']);
    }
  });
  it('does not mutate an existing chain transaction during can()', () => {
    const editor = create('<ul><li>target</li><li>after</li></ul>'); caret(editor, 'target', 2);
    expect(editor.chain().insertContent('X').command(({ tr, can }) => {
      const doc = tr.doc, selection = tr.selection, steps = tr.steps.length, marks = tr.storedMarks;
      expect(can().restoreParagraph()).toBe(true);
      expect(tr.doc).toBe(doc); expect(tr.selection).toBe(selection); expect(tr.steps.length).toBe(steps); expect(tr.storedMarks).toBe(marks);
      return true;
    }).run()).toBe(true);
    expect(types(editor)).toEqual(['bulletList']); expect(editor.state.doc.textContent).toBe('taXrgetafter');
  });
});
