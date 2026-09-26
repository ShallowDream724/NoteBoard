import { afterEach, describe, expect, it } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import { Fragment, Slice } from '@tiptap/pm/model';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { buildDocumentExtensions } from '../../src/features/editor-md/documentExtensions';
import { InteractiveDisclosure } from '../../src/features/editor-md/rich-content/views';
import { insertViewImages } from '../../src/features/editor-md/imageInsertionLease';
import { insertImportedSlice } from '../../src/features/editor-md/clipboard/clipboardImport';
import { selectionAllowsAuxiliaryControls } from '../../src/features/editor-md/blockInteractionScope';
import { findTopLevelBlockElement, getTopLevelBlockInfo, isTopLevelBlockMoveAllowed, moveTopLevelBlock } from '../../src/features/editor-md/blockReorder';
import { blockRange } from '../../src/features/editor-md/blockActions';

const editors: Editor[] = [];
const p = (text = ''): JSONContent => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] });
const fold = (...content: JSONContent[]): JSONContent => ({ type: 'disclosure', content });
const image: JSONContent = { type: 'image', attrs: { src: 'data:image/png;base64,aA==' } };
function create(content: JSONContent[]) {
  const editor = new Editor({ extensions: buildDocumentExtensions({ disclosure: InteractiveDisclosure }), content: { type: 'doc', content } });
  editors.push(editor); return editor;
}
function position(editor: Editor, text: string) {
  let result = -1;
  editor.state.doc.descendants((node, pos) => { if (node.type.name === 'paragraph' && node.textContent === text) result = pos; });
  return result;
}
afterEach(() => { editors.splice(0).forEach(editor => editor.destroy()); });

describe('disclosure editing boundaries', () => {
  it.each([1, 2])('continues after pasted images at depth %i and undoes in one step', depth => {
    const editor = create([depth === 1 ? fold(p()) : fold(fold(p())), p('outside')]);
    const before = editor.state.doc, at = position(editor, '') + 1;
    insertViewImages(editor.view, [{ src: 'one.png', alt: '' }, { src: 'two.png', alt: '' }], TextSelection.create(before, at));
    const selection = editor.state.selection;
    expect(selection.$from.parent.type.name).toBe('paragraph');
    expect(selection.$from.node(selection.$from.depth - 1).type.name).toBe('disclosure');
    const parent = selection.$from.node(selection.$from.depth - 1);
    expect(Array.from({ length: parent.childCount }, (_, i) => parent.child(i).type.name)).toEqual(['image', 'image', 'paragraph']);
    editor.commands.undo(); expect(editor.state.doc.eq(before)).toBe(true);
    editor.commands.redo(); editor.commands.insertContent('after image');
    expect(editor.state.doc.textContent).toContain('after image');
  });
  it('keeps imported HTML images and the continuation in the same disclosure', () => {
    const editor = create([fold(p()), p('outside')]), before = editor.state.doc;
    insertImportedSlice(editor.view, { slice: new Slice(Fragment.from(editor.schema.nodeFromJSON(image)), 0, 0), bodies: [], diagnostics: [] }, TextSelection.create(before, 2));
    expect(editor.state.doc.firstChild?.lastChild?.type.name).toBe('paragraph');
    expect(editor.state.selection.$from.node(1).type.name).toBe('disclosure');
    editor.commands.undo(); expect(editor.state.doc.eq(before)).toBe(true);
  });
  it('offers click and keyboard continuation for existing terminal images', () => {
    const editor = create([fold(image), p('outside')]);
    const tail = editor.view.dom.querySelector('.nb-disclosure-tail') as HTMLButtonElement;
    expect(tail.hidden).toBe(false); tail.click();
    expect(editor.state.selection.$from.node(1).type.name).toBe('disclosure');
    expect(tail.hidden).toBe(true);
    editor.commands.undo();
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 1)));
    const event = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
    editor.view.dom.querySelector('.nb-disclosure-body')!.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(editor.state.selection.$from.parent.type.name).toBe('paragraph');
    expect(editor.state.selection.$from.node(1).type.name).toBe('disclosure');
  });
  it('exposes first-level blocks and text controls but hides deeper controls', () => {
    const editor = create([fold(p('first'), fold(p('second'))), p('outside')]);
    const first = position(editor, 'first'), second = position(editor, 'second');
    const firstDom = editor.view.nodeDOM(first) as HTMLElement, secondDom = editor.view.nodeDOM(second) as HTMLElement;
    expect(findTopLevelBlockElement(editor.view.dom, firstDom)).toBe(firstDom);
    expect(getTopLevelBlockInfo(editor.view, firstDom)?.pos).toBe(first);
    expect(blockRange(editor, first)?.node.textContent).toBe('first');
    expect(findTopLevelBlockElement(editor.view.dom, secondDom)).toBeNull();
    expect(blockRange(editor, second)).toBeNull();
    expect(selectionAllowsAuxiliaryControls(TextSelection.create(editor.state.doc, first + 1, first + 3))).toBe(true);
    expect(selectionAllowsAuxiliaryControls(TextSelection.create(editor.state.doc, second + 1, second + 3))).toBe(false);
    editor.commands.setTextSelection(second + 1); editor.commands.insertContent('editable ');
    expect(editor.state.doc.textContent).toContain('editable second');
  });
  it('reorders siblings with undo and rejects cross-container or deeper moves', () => {
    const editor = create([fold(p('one'), p('two'), fold(p('deep'))), fold(p('other')), p('outside')]);
    const before = editor.state.doc, one = position(editor, 'one'), two = position(editor, 'two');
    expect(isTopLevelBlockMoveAllowed(before, one, position(editor, 'outside'))).toBe(false);
    expect(isTopLevelBlockMoveAllowed(before, one, position(editor, 'other'))).toBe(false);
    expect(isTopLevelBlockMoveAllowed(before, position(editor, 'deep'), two)).toBe(false);
    expect(moveTopLevelBlock(editor.view, one, two + before.nodeAt(two)!.nodeSize)).not.toBeNull();
    expect(editor.state.doc.firstChild?.firstChild?.textContent).toBe('two');
    editor.commands.undo(); expect(editor.state.doc.eq(before)).toBe(true);
  });
});
