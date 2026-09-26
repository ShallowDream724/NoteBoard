import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { InteractiveImageCollection, InteractiveImageSlot } from '../../src/features/editor-md/rich-content/views';
import { ClipboardImport } from '../../src/features/editor-md/clipboard/clipboardImport';
import { clearNativeFileDropTargets, isNativeFileDropDuplicate, nativeDropToCssPoint, routeNativeFileDrop } from '../../src/core/editor/fileDropTargets';
import { imageSlotAtPoint } from '../../src/features/editor-md/imageDropTarget';
const mock = vi.hoisted(() => ({ editor: null as Editor | null, active: 'test.nb', paste: vi.fn(), paths: vi.fn(), lease: vi.fn(() => ({ dispose() {} })) }));
vi.mock('../../src/features/editor-md/imagePaste', () => ({ handlePastedImageFiles: mock.paste, handleImagePathsUsingLease: mock.paths, insertLocalImageWithDialog: vi.fn() }));
vi.mock('../../src/features/editor-md/editorInstances', () => ({ getMdTipTapEditor: () => mock.editor }));
vi.mock('../../src/features/editor-md/imageInsertionLease', async original => ({ ...await original<object>(), captureVisualImageInsertion: mock.lease }));
vi.mock('../../src/stores/windowStore', () => ({ useWindowStore: { getState: () => ({ activeKey: mock.active, isWindowClosing: false, isTransferring: () => false, pendingCloseKeys: [] }) } }));
let hit: Element | null = null;
function create(layout = 'grid') {
  mock.editor = new Editor({ extensions: [StarterKit, Image, InteractiveImageCollection, InteractiveImageSlot, ClipboardImport.configure({ docKey: 'test.nb' })], content: {
    type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'caret here' }] }, { type: 'imageCollection', attrs: { layout, columns: 3 }, content: Array.from({ length: 9 }, () => ({ type: 'imageSlot' })) }],
  } });
  document.body.append(mock.editor.view.dom); mock.editor.commands.setTextSelection(2); return mock.editor;
}
function pointAt(element: Element | null) { hit = element; document.dispatchEvent(new MouseEvent('pointermove', { clientX: 45, clientY: 60, bubbles: true })); }
function paste(editor: Editor, files = [new File(['png'], 'paste.png', { type: 'image/png' })], text = '') {
  const event = { clipboardData: { types: files.length ? ['Files'] : ['text/plain'], files, items: [], getData: () => text }, preventDefault: vi.fn() } as unknown as ClipboardEvent;
  return editor.view.someProp('handleDOMEvents', handlers => handlers.paste?.(editor.view, event));
}
function pasteOn(target: Element, images = true) {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: {
    types: images ? ['Files'] : ['text/plain'], files: images ? [new File(['png'], 'paste.png', { type: 'image/png' })] : [], items: [],
    getData: (type: string) => !images && type === 'text/plain' ? 'ordinary text' : '',
  } });
  target.dispatchEvent(event); return event.defaultPrevented;
}
beforeEach(() => { vi.clearAllMocks(); mock.active = 'test.nb'; hit = null; Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => hit) }); });
afterEach(() => { mock.editor?.destroy(); mock.editor = null; clearNativeFileDropTargets(); document.body.replaceChildren(); vi.restoreAllMocks(); });
describe('native image drop and current-pointer paste routing', () => {
  it.each(['grid', 'carousel'])('routes a body/button image paste to the hovered %s slot without a text caret', layout => {
    const editor = create(layout), slot = editor.view.dom.querySelectorAll('[data-image-slot]')[7];
    (document.activeElement as HTMLElement)?.blur();
    pointAt(slot.querySelector('button'));
    expect(pasteOn(document.body)).toBe(true);
    expect(mock.paste).toHaveBeenLastCalledWith(editor, expect.any(Array), 'test.nb', 28);
    expect(document.activeElement).toBe(editor.view.dom);
    mock.paste.mockClear();
    const liveButton = editor.view.dom.querySelectorAll('[data-image-slot]')[7].querySelector('button')!;
    pointAt(liveButton);
    expect(pasteOn(liveButton)).toBe(true);
    expect(mock.paste).toHaveBeenCalledTimes(1);
  });
  it('restores editor focus after adding a slot and does not steal other inputs or body text', () => {
    const editor = create();
    const outside = document.createElement('input'); document.body.append(outside); outside.focus();
    (editor.view.dom.querySelector('.nb-image-add-slot') as HTMLButtonElement).click();
    expect(document.activeElement).toBe(editor.view.dom);
    pointAt(editor.view.dom.querySelector('[data-image-slot]'));
    outside.focus(); expect(pasteOn(outside)).toBe(false);
    outside.blur(); expect(pasteOn(document.body, false)).toBe(false);
    expect(mock.paste).not.toHaveBeenCalled();
    pointAt(editor.view.dom.querySelector('p')); expect(pasteOn(document.body)).toBe(false);
    pointAt(editor.view.dom.querySelector('[data-image-slot]')); window.dispatchEvent(new Event('blur'));
    expect(pasteOn(document.body)).toBe(false);
    pointAt(editor.view.dom.querySelector('[data-image-slot]')); mock.active = 'another.nb';
    expect(pasteOn(document.body)).toBe(false);
    expect(mock.paste).not.toHaveBeenCalled();
  });
  it.each(['grid', 'carousel'])('pastes into exactly the currently hovered %s slot while the caret stays in another paragraph', layout => {
    const editor = create(layout), slots = editor.view.dom.querySelectorAll('[data-image-slot]');
    pointAt(slots[7].querySelector('button')!);
    const target = imageSlotAtPoint(editor.view, { x: 45, y: 60 });
    expect(target?.position).toBe(28);
    expect(paste(editor)).toBe(true); expect(mock.paste).toHaveBeenLastCalledWith(editor, expect.any(Array), 'test.nb', 28);
    pointAt(editor.view.dom.querySelector('p'));
    paste(editor); expect(mock.paste).toHaveBeenLastCalledWith(editor, expect.any(Array), 'test.nb', undefined);
    pointAt(slots[2]); document.dispatchEvent(new Event('pointerleave'));
    paste(editor); expect(mock.paste).toHaveBeenLastCalledWith(editor, expect.any(Array), 'test.nb', undefined);
  });
  it('leaves text paste at the caret and does not use a slot hidden by an overlay or embedded editor', () => {
    const editor = create(), slot = editor.view.dom.querySelector('[data-image-slot]')!;
    pointAt(slot); expect(paste(editor, [], 'hello')).toBeFalsy(); expect(mock.paste).not.toHaveBeenCalled();
    const overlay = document.createElement('div'); document.body.append(overlay); hit = overlay;
    paste(editor); expect(mock.paste).toHaveBeenLastCalledWith(editor, expect.any(Array), 'test.nb', undefined);
    const embedded = document.createElement('div'); embedded.className = 'ProseMirror'; slot.append(embedded); pointAt(embedded);
    expect(imageSlotAtPoint(editor.view, { x: 45, y: 60 })).toBeUndefined();
  });
  it('uses a hovered slot for images when the caret is in code, while keeping text and plain requests literal', () => {
    const editor = create(); editor.commands.setCodeBlock();
    pointAt(editor.view.dom.querySelector('[data-image-slot]'));
    expect(paste(editor)).toBe(true);
    expect(mock.paste).toHaveBeenLastCalledWith(editor, expect.any(Array), 'test.nb', 14);
    mock.paste.mockClear();
    paste(editor, [], '# heading');
    expect(editor.state.doc.firstChild?.type.name).toBe('codeBlock');
    expect(editor.state.doc.firstChild?.textContent).toContain('# heading');
    expect(mock.paste).not.toHaveBeenCalled();
    editor.view.someProp('handleKeyDown', handler => handler(editor.view, new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, shiftKey: true })));
    paste(editor);
    expect(mock.paste).not.toHaveBeenCalled();
  });
  it('claims native image hover/drop by physical-to-CSS hit coordinates, clears indicators, and preserves file-open fallback', () => {
    const editor = create(); hit = editor.view.dom.querySelectorAll('[data-image-slot]')[4];
    vi.spyOn(window, 'devicePixelRatio', 'get').mockReturnValue(2);
    expect(nativeDropToCssPoint({ x: 90, y: 120 }, 2)).toEqual({ x: 45, y: 60 });
    expect(routeNativeFileDrop({ type: 'enter', paths: ['C:\\photo.png'], position: { x: 90, y: 120 } })).toBe(true);
    expect(document.elementFromPoint).toHaveBeenLastCalledWith(45, 60);
    expect(document.body.textContent).toContain('释放图片以填入此处');
    expect(routeNativeFileDrop({ type: 'over', position: { x: 90, y: 120 } })).toBe(true);
    expect(routeNativeFileDrop({ type: 'drop', paths: ['C:\\photo.png'], position: { x: 90, y: 120 } })).toBe(true);
    expect(mock.lease).toHaveBeenCalledWith(editor, 'test.nb', 22); expect(mock.paths).toHaveBeenCalledOnce();
    expect(isNativeFileDropDuplicate([new File([], 'photo.png')])).toBe(true);
    expect(document.body.textContent).not.toContain('释放图片以填入此处');
    expect(routeNativeFileDrop({ type: 'enter', paths: ['C:\\photo.png', 'C:\\note.md'], position: { x: 90, y: 120 } })).toBe(false);
    hit = document.body;
    expect(routeNativeFileDrop({ type: 'drop', paths: ['C:\\photo.png'], position: { x: 90, y: 120 } })).toBe(false);
    hit = editor.view.dom.querySelector('[data-image-slot]'); editor.setEditable(false);
    expect(routeNativeFileDrop({ type: 'enter', paths: ['C:\\photo.png'], position: { x: 90, y: 120 } })).toBe(false);
    routeNativeFileDrop({ type: 'leave' }); expect(document.body.textContent).not.toContain('释放图片以填入此处');
  });
});
