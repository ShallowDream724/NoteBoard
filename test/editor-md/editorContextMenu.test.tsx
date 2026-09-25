import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EditorContextMenu } from '../../src/features/editor-md/EditorContextMenu';
import { writeDocumentClipboard } from '../../src/features/editor-md/clipboard/clipboardImport';
import { DOCUMENT_SLICE_MIME } from '../../src/features/editor-md/clipboard/constants';
import { pasteFromSystemClipboard } from '../../src/features/editor-md/clipboard/systemClipboard';

vi.mock('../../src/features/editor-md/clipboard/systemClipboard', () => ({ pasteFromSystemClipboard: vi.fn() }));
let editor: Editor, root: Root, host: HTMLDivElement;
const close = vi.fn();
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  editor = new Editor({ extensions: [StarterKit], editorProps: { handleScrollToSelection: () => true }, content: '<p>keep <strong>selected</strong> after</p>' });
  document.body.append(editor.view.dom);
  editor.commands.setTextSelection({ from: 6, to: 14 });
  close.mockClear(); vi.mocked(pasteFromSystemClipboard).mockClear();
});
afterEach(async () => {
  await act(async () => root.unmount()); editor.destroy(); host.remove();
  vi.unstubAllGlobals(); vi.restoreAllMocks();
  delete (document as unknown as Record<string, unknown>).execCommand;
});
async function open(hasSelection = true) {
  await act(async () => root.render(<EditorContextMenu editor={editor} hasSelection={hasSelection} position={{ x: 20, y: 20 }} onClose={close}/>));
  return document.querySelector<HTMLElement>('[role="menu"]')!;
}
async function click(label: string) {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(item => item.querySelector('span')?.textContent === label)!;
  await act(async () => button.click());
}

it('restores the selected rich fragment before native cut, preserving its undo transaction', async () => {
  const formats = new Map<string, string>();
  Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn(command => {
    expect(editor.view.hasFocus()).toBe(true);
    expect(editor.state.selection.from).toBe(6); expect(editor.state.selection.to).toBe(14);
    return writeDocumentClipboard(editor.view, { clipboardData: { setData: (type: string, value: string) => formats.set(type, value) }, preventDefault() {} } as unknown as ClipboardEvent, command === 'cut');
  }) });
  await open(); await click('剪切');
  expect(formats.get('text/html')).toContain('<strong>selected</strong>');
  expect(formats.has(DOCUMENT_SLICE_MIME)).toBe(true);
  expect(editor.getText()).toBe('keep  after');
  editor.commands.undo(); expect(editor.getHTML()).toBe('<p>keep <strong>selected</strong> after</p>');
  expect(close).toHaveBeenCalled();
});

it('allows rich and plain paste over a selection through the shared importer', async () => {
  const menu = await open();
  await act(async () => menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'V', ctrlKey: true, shiftKey: true, bubbles: true })));
  expect(pasteFromSystemClipboard).toHaveBeenLastCalledWith(editor, true);
  expect(editor.state.selection.from).toBe(6); expect(editor.state.selection.to).toBe(14);
  await open(); await click('粘贴');
  expect(pasteFromSystemClipboard).toHaveBeenLastCalledWith(editor);
});

it('supports keyboard navigation and Escape without changing the selection', async () => {
  const menu = await open();
  await act(async () => menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
  expect(document.activeElement?.textContent).toContain('剪切');
  await act(async () => menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })));
  expect(document.activeElement?.textContent).toContain('全选');
  await act(async () => menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(close).toHaveBeenCalledOnce(); expect(editor.state.selection.from).toBe(6);
  expect(editor.view.hasFocus()).toBe(true);
});

it('dismisses on outside scrolling and window blur, and releases listeners on unmount', async () => {
  await open(false);
  await act(async () => window.dispatchEvent(new Event('blur')));
  expect(close).toHaveBeenCalledOnce();
  await act(async () => host.dispatchEvent(new Event('scroll')));
  expect(close).toHaveBeenCalledTimes(2);
  await act(async () => root.render(null));
  window.dispatchEvent(new Event('blur')); host.dispatchEvent(new Event('scroll'));
  expect(close).toHaveBeenCalledTimes(2);
});
