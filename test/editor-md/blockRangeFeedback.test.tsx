import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { undoDepth } from '@tiptap/pm/history';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BlockRangeFeedback } from '@/features/editor-md/BlockRangeFeedback';

let editor: Editor, root: Root, host: HTMLElement, slot: HTMLElement;
const disconnect = vi.fn();
const bounds = (x: number, y: number, width: number, height: number) => ({ x, y, left: x, top: y, right: x + width, bottom: y + height, width, height, toJSON() {} });
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  disconnect.mockClear();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect = disconnect; });
  host = document.body.appendChild(document.createElement('div'));
  host.dataset.editorScroll = 'markdown';
  host.getBoundingClientRect = () => bounds(0, 100, 600, 400);
  Object.defineProperties(host, { offsetWidth: { value: 600 }, clientWidth: { value: 600 } });
  editor = new Editor({ extensions: [StarterKit], content: '<p>before</p><hr/><p>after</p>', editorProps: { handleScrollToSelection: () => true } });
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
