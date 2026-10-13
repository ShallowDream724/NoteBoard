import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import { NodeSelection, Selection, TextSelection } from '@tiptap/pm/state';
import { undo } from '@tiptap/pm/history';
import { CellSelection } from '@tiptap/pm/tables';
import { buildDocumentExtensions } from '@/features/editor-md/documentExtensions';
import { BlockBoundary, BlockBoundarySelection, blockBoundaryAtPoint, handleBlockBoundaryKey, insertBoundaryParagraph, isBlockBoundary, setBlockBoundaryActive } from '@/features/editor-md/blockBoundary';
import { beginEditorDrag } from '@/features/editor-md/editorDragActivity';

const editors: Editor[] = [];
const p = (text = ''): JSONContent => ({ type: 'paragraph', ...(text ? { content: [{ type: 'text', text }] } : {}) });
const table = (): JSONContent => ({ type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [p('cell')] }] }] });
const image: JSONContent = { type: 'image', attrs: { src: 'one.png' } };
function create(content: JSONContent[]) {
  const editor = new Editor({ extensions: [...buildDocumentExtensions(), BlockBoundary], content: { type: 'doc', content }, editorProps: { handleScrollToSelection: () => true } });
  editors.push(editor); document.body.append(editor.view.dom); return editor.view;
}
function key(view: ReturnType<typeof create>, key: string, init: KeyboardEventInit = {}) {
  return handleBlockBoundaryKey(view, new KeyboardEvent('keydown', { key, ...init }));
}
function box(top: number, bottom: number, left = 100, right = 500): DOMRect {
  return { top, bottom, left, right, width: right - left, height: bottom - top, x: left, y: top, toJSON() {} } as DOMRect;
}
function geometry(view: ReturnType<typeof create>, positions: number[], gap = 12) {
  vi.spyOn(view.dom, 'getBoundingClientRect').mockReturnValue(box(0, 400));
  positions.forEach((pos, index) => vi.spyOn(view.nodeDOM(pos) as HTMLElement, 'getBoundingClientRect').mockReturnValue(box(24 + index * (100 + gap), 124 + index * (100 + gap))));
  vi.spyOn(view, 'posAtCoords').mockImplementation(({ top }) => ({ pos: top < 130 ? 4 : positions[1] + 4, inside: top < 130 ? 0 : positions[1] }));
}
afterEach(() => { editors.splice(0).forEach(editor => editor.destroy()); document.body.replaceChildren(); vi.restoreAllMocks(); });

describe('rich block writing boundaries', () => {
  it('keeps two loaded tables unchanged and finds the beginning, narrow gap and document end', () => {
    const view = create([table(), table()]), second = view.state.doc.firstChild!.nodeSize;
    const original = view.state.doc; geometry(view, [0, second], 2);
    expect(blockBoundaryAtPoint(view, 200, 12, view.dom)?.pos).toBe(0);
    expect(blockBoundaryAtPoint(view, 200, 125, view.dom)?.pos).toBe(second);
    expect(blockBoundaryAtPoint(view, 200, 238, view.dom)?.pos).toBe(view.state.doc.content.size);
    expect(view.state.doc).toBe(original);
    expect(view.state.doc.childCount).toBe(2);
    expect(blockBoundaryAtPoint(view, 200, 60, view.dom.querySelector('td p'))).toBeNull();
  });
  it('clicks whitespace to a caret, leaving the tables intact until Enter creates one paragraph', () => {
    const view = create([table(), table()]), second = view.state.doc.firstChild!.nodeSize;
    geometry(view, [0, second]);
    view.dom.dispatchEvent(new MouseEvent('mousedown', { clientX: 200, clientY: 130, bubbles: true }));
    view.dom.dispatchEvent(new MouseEvent('mouseup', { clientX: 200, clientY: 130, bubbles: true }));
    expect(view.state.selection).toBeInstanceOf(BlockBoundarySelection);
    expect(view.state.selection.from).toBe(second);
    expect(view.state.doc.childCount).toBe(2);
    expect(key(view, 'Enter')).toBe(true);
    expect(view.state.doc.content.toJSON().map((node: JSONContent) => node.type)).toEqual(['table', 'paragraph', 'table']);
    expect(view.state.selection.$from.parent.type.name).toBe('paragraph');
    expect(undo(view.state, view.dispatch)).toBe(true);
    expect(view.state.doc.childCount).toBe(2);
  });
  it('never takes a drag selection or a modified click', () => {
    const view = create([table(), table()]), second = view.state.doc.firstChild!.nodeSize;
    geometry(view, [0, second]);
    const initial = view.state.selection;
    view.dom.dispatchEvent(new MouseEvent('mousedown', { clientX: 200, clientY: 130, bubbles: true }));
    view.dom.dispatchEvent(new MouseEvent('mouseup', { clientX: 240, clientY: 130, bubbles: true }));
    expect(view.state.selection).not.toBeInstanceOf(BlockBoundarySelection);
    const finish = beginEditorDrag(view);
    expect(blockBoundaryAtPoint(view, 200, 130, view.dom)).toBeNull(); finish();
    view.dispatch(view.state.tr.setSelection(initial));
    view.dom.dispatchEvent(new MouseEvent('mousedown', { clientX: 200, clientY: 130, shiftKey: true, bubbles: true }));
    view.dom.dispatchEvent(new MouseEvent('mouseup', { clientX: 200, clientY: 130, shiftKey: true, bubbles: true }));
    expect(view.state.selection).not.toBeInstanceOf(BlockBoundarySelection);
  });
  it.each(['ArrowLeft', 'ArrowUp'])('%s leaves only the first cell at its start, then Enter writes before the table', pressed => {
    const view = create([table(), table()]);
    vi.spyOn(view, 'endOfTextblock').mockReturnValue(true);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 4)));
    expect(key(view, pressed)).toBe(true);
    expect(view.state.selection).toBeInstanceOf(BlockBoundarySelection);
    expect(view.state.selection.from).toBe(0);
    key(view, 'Enter'); expect(view.state.doc.firstChild?.type.name).toBe('paragraph');
    expect(view.state.doc.child(1).firstChild?.firstChild?.childCount).toBe(1);
  });
  it.each(['ArrowRight', 'ArrowDown'])('%s reaches the gap after the first table without inserting a cell paragraph', pressed => {
    const view = create([table(), table()]), end = view.state.doc.firstChild!.nodeSize;
    vi.spyOn(view, 'endOfTextblock').mockReturnValue(true);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 8)));
    expect(key(view, pressed)).toBe(true); expect(view.state.selection.from).toBe(end);
    expect(view.state.doc.childCount).toBe(2);
    expect(key(view, 'Enter')).toBe(true); expect(view.state.doc.child(1).type.name).toBe('paragraph');
    expect(view.state.doc.child(0).firstChild?.firstChild?.childCount).toBe(1);
  });
  it('keeps inner cells and selected/IME text under their original editing semantics', () => {
    const twoCells = table(); twoCells.content![0].content!.push({ type: 'tableCell', content: [p('second')] });
    const view = create([twoCells]); vi.spyOn(view, 'endOfTextblock').mockReturnValue(true);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 12)));
    expect(key(view, 'ArrowLeft')).toBe(false);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 4, 6)));
    expect(key(view, 'ArrowUp')).toBe(false);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 4)));
    expect(key(view, 'ArrowUp', { isComposing: true })).toBe(false);
    expect(key(view, 'ArrowUp', { shiftKey: true })).toBe(false);
  });
  it.each([
    image, { type: 'mathBlock', attrs: { latex: 'x' } }, { type: 'codeBlock', content: [{ type: 'text', text: 'code' }] },
    { type: 'imageCollection', content: [{ type: 'imageSlot', content: [image] }] },
    { type: 'githubAlert', content: [p('inside')] }, { type: 'disclosure', content: [p('inside')] },
  ] as JSONContent[])('supports both sides of $type and keeps selection bookmarks through metadata transactions', block => {
    const view = create([block, table()]);
    for (const pos of [0, view.state.doc.firstChild!.nodeSize, view.state.doc.content.size]) expect(isBlockBoundary(view.state.doc.resolve(pos))).toBe(true);
    view.dispatch(view.state.tr.setSelection(new BlockBoundarySelection(view.state.doc.resolve(0))));
    view.dispatch(view.state.tr.setMeta('test', true)); expect(view.state.selection).toBeInstanceOf(BlockBoundarySelection);
    expect(Selection.fromJSON(view.state.doc, view.state.selection.toJSON())).toBeInstanceOf(BlockBoundarySelection);
    expect(view.state.selection.getBookmark().resolve(view.state.doc)).toBeInstanceOf(BlockBoundarySelection);
  });
  it('creates text once, then Backspace removes the explicit empty line and returns to its boundary', () => {
    const view = create([table(), table()]), pos = view.state.doc.firstChild!.nodeSize;
    expect(insertBoundaryParagraph(view, pos, 'hello')).toBe(true);
    expect(view.state.doc.child(1).textContent).toBe('hello'); expect(view.state.selection.$from.parentOffset).toBe(5);
    view.dispatch(view.state.tr.delete(pos + 1, pos + 6));
    expect(key(view, 'Backspace')).toBe(true); expect(view.state.doc.childCount).toBe(2);
    expect(view.state.selection).toBeInstanceOf(BlockBoundarySelection);
    expect(key(view, 'Backspace')).toBe(true); expect(view.state.selection instanceof NodeSelection || view.state.selection instanceof CellSelection).toBe(true);
    expect(view.state.doc.childCount).toBe(2);
  });
  it('uses local block slots in nested callouts without enabling slots in cells or captions', () => {
    const view = create([{ type: 'githubAlert', content: [table(), table()] }]);
    expect(isBlockBoundary(view.state.doc.resolve(1))).toBe(true);
    expect(insertBoundaryParagraph(view, 1)).toBe(true);
    expect(view.state.doc.firstChild?.firstChild?.type.name).toBe('paragraph');
    expect(isBlockBoundary(view.state.doc.resolve(7))).toBe(false);
  });
  it('shows one hover control only in whitespace and creates a paragraph through its explicit button', () => {
    const view = create([table(), table()]), second = view.state.doc.firstChild!.nodeSize;
    geometry(view, [0, second]);
    const button = document.querySelector<HTMLButtonElement>('.nb-block-boundary-insert')!;
    expect(button.hidden).toBe(true);
    view.dom.dispatchEvent(new MouseEvent('mousemove', { clientX: 200, clientY: 130, bubbles: true }));
    expect(button.hidden).toBe(false); expect(view.state.doc.childCount).toBe(2);
    const finish = beginEditorDrag(view); expect(button.hidden).toBe(true); finish();
    view.dom.dispatchEvent(new MouseEvent('mousemove', { clientX: 200, clientY: 130, bubbles: true }));
    button.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    expect(view.state.doc.child(1).type.name).toBe('paragraph'); expect(view.state.doc.childCount).toBe(3);
    expect(button.hidden).toBe(true);
    view.dom.dispatchEvent(new MouseEvent('mousemove', { clientX: 200, clientY: 60, bubbles: true }));
    expect(button.hidden).toBe(true);
  });
  it('provides one IME context at a boundary and preserves the typed character', () => {
    const view = create([table(), table()]), pos = view.state.doc.firstChild!.nodeSize;
    view.dispatch(view.state.tr.setSelection(new BlockBoundarySelection(view.state.doc.resolve(pos))));
    view.dom.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertCompositionText', data: '中', bubbles: true }));
    expect(view.state.selection).toBeInstanceOf(TextSelection); expect(view.state.doc.childCount).toBe(3);
    view.dispatch(view.state.tr.insertText('中'));
    view.dom.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertCompositionText', data: '中文', bubbles: true }));
    expect(view.state.doc.childCount).toBe(3); expect(view.state.doc.child(1).textContent).toBe('中');
  });
  it('moves out of a terminal selected block to a gap, then a native Enter writes exactly one paragraph', () => {
    const view = create([image]); view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, 0)));
    view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    expect(view.state.selection).toBeInstanceOf(BlockBoundarySelection); expect(view.state.doc.childCount).toBe(1);
    view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(view.state.selection).toBeInstanceOf(TextSelection); expect(view.state.doc.childCount).toBe(2);
  });
  it('clears its body control on source/tab changes and rejects a stale insertion in hidden or inert views', () => {
    const view = create([table(), table()]), second = view.state.doc.firstChild!.nodeSize;
    geometry(view, [0, second]);
    const button = document.querySelector<HTMLButtonElement>('.nb-block-boundary-insert')!;
    view.dom.dispatchEvent(new MouseEvent('mousemove', { clientX: 200, clientY: 130, bubbles: true }));
    expect(button.hidden).toBe(false); setBlockBoundaryActive(view, false); expect(button.hidden).toBe(true);
    button.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(insertBoundaryParagraph(view, second)).toBe(false); expect(view.state.doc.childCount).toBe(2);
    setBlockBoundaryActive(view, true);
    view.dom.setAttribute('inert', ''); expect(insertBoundaryParagraph(view, second)).toBe(false);
    view.dom.removeAttribute('inert'); view.dom.style.visibility = 'hidden';
    expect(insertBoundaryParagraph(view, second)).toBe(false);
  });
});
