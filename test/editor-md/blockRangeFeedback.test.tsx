import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { undoDepth } from '@tiptap/pm/history';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BlockRangeFeedback } from '@/features/editor-md/BlockRangeFeedback';
import { orderedMarkerText } from '@/features/editor-md/listMarkerGeometry';

let editor: Editor, root: Root, host: HTMLElement, slot: HTMLElement;
const disconnect = vi.fn();
const bounds = (x: number, y: number, width: number, height: number) => ({ x, y, left: x, top: y, right: x + width, bottom: y + height, width, height, toJSON() {} });
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  disconnect.mockClear();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ measureText: () => ({ width: 12 }) } as unknown as CanvasRenderingContext2D);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect = disconnect; });
  host = document.body.appendChild(document.createElement('div'));
  host.dataset.editorScroll = 'markdown';
  host.getBoundingClientRect = () => bounds(0, 100, 600, 400);
  Object.defineProperties(host, { offsetWidth: { value: 600 }, clientWidth: { value: 600 } });
  editor = new Editor({ extensions: [StarterKit, TaskList, TaskItem.configure({ nested: true })], content: '<p>before</p><hr/><p>after</p>', editorProps: { handleScrollToSelection: () => true } });
  host.append(editor.view.dom);
  slot = host.appendChild(document.createElement('div'));
  root = createRoot(slot);
});
afterEach(async () => {
  await act(async () => root.unmount());
  editor.destroy(); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
async function show(pos: number, height = 26) {
  const target = editor.view.nodeDOM(pos) as HTMLElement;
  target.getBoundingClientRect = () => bounds(88, 200, 480, height);
  await act(async () => root.render(<BlockRangeFeedback editor={editor} pos={pos}/>));
  return { layer: slot.firstElementChild as HTMLElement, target };
}

it('provides a divider range without changing editable DOM, selection, or history', async () => {
  const doc = editor.state.doc, selection = editor.state.selection;
  const dispatch = vi.spyOn(editor.view, 'dispatch');
  const html = editor.view.dom.innerHTML;
  const { layer, target } = await show(doc.firstChild!.nodeSize);
  await new Promise(resolve => setTimeout(resolve, 30));
  expect(layer.hidden).toBe(false);
  expect(editor.view.dom.innerHTML).toBe(html);
  expect(editor.view.nodeDOM(doc.firstChild!.nodeSize)).toBe(target);
  expect(editor.state.doc).toBe(doc); expect(editor.state.selection).toBe(selection);
  expect(dispatch).not.toHaveBeenCalled(); expect(undoDepth(editor.state)).toBe(0);
  await act(async () => root.render(null));
  expect(disconnect).toHaveBeenCalledOnce(); expect(slot.childElementCount).toBe(0);
});

it('clips large block feedback to the viewport instead of allocating a full-document layer', async () => {
  const { layer } = await show(0, 300000);
  expect(parseFloat(layer.style.height)).toBeLessThanOrEqual(400);
  expect(parseFloat(layer.style.width)).toBeLessThanOrEqual(600);
});

it('tracks a block through preceding edits and hides feedback when it is deleted', async () => {
  const pos = editor.state.doc.firstChild!.nodeSize;
  const { layer } = await show(pos);
  const following = editor.view.nodeDOM(pos + 1) as HTMLElement;
  following.getBoundingClientRect = () => bounds(88, 240, 480, 40);
  editor.view.dispatch(editor.state.tr.insertText('new ', 1));
  await new Promise(resolve => setTimeout(resolve, 35));
  expect(layer.hidden).toBe(false);
  editor.view.dispatch(editor.state.tr.delete(pos + 4, pos + 5));
  await new Promise(resolve => setTimeout(resolve, 35));
  expect(layer.hidden).toBe(true);
});

it.each([
  '<ol><li><p>one</p></li><li><p>two</p></li></ol>',
  '<ul><li><p>one</p></li><li><p>two</p></li></ul>',
  '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>one</p></li><li data-type="taskItem"><p>two</p></li></ul>',
])('covers the marker gutter and only the current row without mutating editable DOM: %s', async html => {
  editor.commands.setContent(html);
  const item = editor.view.nodeDOM(1) as HTMLElement;
  item.parentElement!.getBoundingClientRect = () => bounds(64, 190, 504, 180);
  const doc = editor.state.doc, selection = editor.state.selection, markup = editor.view.dom.innerHTML;
  const dispatch = vi.spyOn(editor.view, 'dispatch');
  const { layer } = await show(1);
  expect(parseFloat(layer.style.left)).toBe(62); expect(parseFloat(layer.style.width)).toBe(508);
  expect(parseFloat(layer.style.top)).toBe(98); expect(parseFloat(layer.style.height)).toBe(30);
  expect(editor.state.doc).toBe(doc); expect(editor.state.selection).toBe(selection);
  expect(editor.view.dom.innerHTML).toBe(markup); expect(dispatch).not.toHaveBeenCalled();
});

it('uses the immediate nested list gutter rather than its ancestor list or sibling rows', async () => {
  editor.commands.setContent('<ol><li><p>parent</p><ul><li><p>one</p></li><li><p>two</p></li></ul></li><li><p>sibling</p></li></ol>');
  let pos = 0; editor.state.doc.descendants((node, at) => { if (node.type.name === 'listItem' && node.textContent === 'one') pos = at; });
  const item = editor.view.nodeDOM(pos) as HTMLElement;
  item.parentElement!.getBoundingClientRect = () => bounds(64, 190, 504, 180);
  editor.view.dom.firstElementChild!.getBoundingClientRect = () => bounds(32, 150, 536, 240);
  const { layer } = await show(pos);
  expect(parseFloat(layer.style.left)).toBe(62); expect(parseFloat(layer.style.height)).toBe(30);
});

it.each([
  [123456, 'decimal', '123456. '], [26, 'upper-alpha', 'Z. '], [27, 'upper-alpha', 'AA. '],
  [52, 'lower-alpha', 'az. '], [1888, 'lower-roman', 'mdccclxxxviii. '], [4000, 'upper-roman', '4000. '], [3, 'decimal-leading-zero', '03. '],
])('uses the visible CSS counter for ordinal %s in %s', (value, style, marker) => expect(orderedMarkerText(value as number, style as string)).toBe(marker));

it('extends beyond fixed list padding for a wide start while reusing and releasing one tiny measuring surface', async () => {
  editor.commands.setContent('<ol start="123456"><li><p>one</p></li><li><p>two</p></li></ol>');
  const item = editor.view.nodeDOM(1) as HTMLElement;
  Object.assign(item.style, { fontSize: '16px', fontFamily: 'sans-serif', listStyleType: 'decimal' });
  item.parentElement!.getBoundingClientRect = () => bounds(64, 190, 504, 180);
  const measureText = vi.fn(() => ({ width: 76 }));
  const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ measureText } as unknown as CanvasRenderingContext2D);
  const { layer } = await show(1);
  expect(measureText).toHaveBeenCalledWith('123456. '); expect(parseFloat(layer.style.left)).toBeLessThan(62);
  host.dispatchEvent(new Event('scroll')); await new Promise(resolve => setTimeout(resolve, 30));
  expect(getContext).toHaveBeenCalledOnce();
  const canvas = getContext.mock.contexts[0] as HTMLCanvasElement; expect(canvas.width).toBe(1); expect(canvas.height).toBe(1);
  await act(async () => root.render(null)); expect(canvas.width).toBe(0); expect(canvas.height).toBe(0);
});
