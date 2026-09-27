import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { ImageNode as Image } from '../../src/features/editor-md/documentNodes';
import { InteractiveImageCollection, InteractiveImageSlot } from '../../src/features/editor-md/rich-content/views';
import { ClipboardImport, DOCUMENT_SLICE_MIME, documentSliceClipboardData, insertImportedSlice } from '../../src/features/editor-md/clipboard/clipboardImport';
import { Fragment, Slice } from '@tiptap/pm/model';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { selectContextMenuTarget } from '../../src/features/editor-md/contextMenuSelection';
import { clearNativeFileDropTargets, isNativeFileDropDuplicate, nativeDropToCssPoint, routeNativeFileDrop } from '../../src/core/editor/fileDropTargets';
import { createImageDropIndicator, imageSlotAtPoint, imageDropTargetAtPoint } from '../../src/features/editor-md/imageDropTarget';
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
  document.body.append(mock.editor.view.dom); mock.editor.setOptions({ editorProps: { handleScrollToSelection: () => true } }); mock.editor.commands.setTextSelection(2); return mock.editor;
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
function richPasteOn(target: Element, formats: Record<string, string>) {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { types: Object.keys(formats), files: [], items: [], getData: (type: string) => formats[type] ?? '' } });
  target.dispatchEvent(event); return event.defaultPrevented;
}
beforeEach(() => { vi.clearAllMocks(); mock.active = 'test.nb'; hit = null; Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => hit) }); });
afterEach(() => { mock.editor?.destroy(); mock.editor = null; clearNativeFileDropTargets(); document.body.replaceChildren(); vi.restoreAllMocks(); });
describe('native image drop and current-pointer paste routing', () => {
  it.each(['grid', 'carousel'])('shows one rich caption and no second add-caption control after image copy into an empty %s slot', layout => {
    const editor = create(layout), slotElement = editor.view.dom.querySelectorAll('[data-image-slot]')[2]; pointAt(slotElement.querySelector('button'));
    const image = editor.schema.nodes.image.create({ src: 'caption.png', caption: 'Caption', captionContent: [{ type: 'text', text: 'Caption', marks: [{ type: 'bold' }] }] });
    const payload = documentSliceClipboardData(editor.state.doc, new Slice(Fragment.from(image), 0, 0));
    expect(richPasteOn(document.body, { [DOCUMENT_SLICE_MIME]: payload })).toBe(true);
    const slot = editor.state.doc.child(1).child(2);
    expect(slot.childCount).toBe(2); expect(slot.firstChild?.attrs.caption).toBeNull();
    expect(slot.lastChild?.firstChild?.marks[0].type.name).toBe('bold');
    expect(slotElement.querySelectorAll('p')).toHaveLength(1);
    expect((slotElement.querySelector('.nb-image-caption-add') as HTMLButtonElement).hidden).toBe(true);
    expect(slotElement.querySelectorAll('figcaption')).toHaveLength(0);
  });
  it.each(['grid', 'carousel'])('pastes an internally copied picture into the hovered %s slot from editor or body focus', layout => {
    const editor = create(layout), image = editor.schema.nodes.image.create({ src: 'morning.png', alt: '01 晨光' });
    editor.view.dispatch(editor.state.tr.replaceWith(13, 15, editor.schema.nodes.imageSlot.create(null, image)));
    const source = editor.state.doc.child(1).firstChild!, payload = documentSliceClipboardData(editor.state.doc, new Slice(Fragment.from(image), 0, 0));
    for (const bodyFocus of [false, true]) {
      const index = bodyFocus ? 4 : 2, before = editor.state.doc;
      const slot = editor.view.dom.querySelectorAll('[data-image-slot]')[index]; pointAt(slot.querySelector('button'));
      expect(richPasteOn(bodyFocus ? document.body : editor.view.dom, { [DOCUMENT_SLICE_MIME]: payload })).toBe(true);
      expect(editor.state.doc.child(1).child(index).firstChild?.attrs.src).toBe('morning.png');
      expect(editor.state.doc.child(1).firstChild!.eq(source)).toBe(true);
      expect(editor.state.doc.childCount).toBe(before.childCount);
      editor.commands.undo(); expect(editor.state.doc.eq(before)).toBe(true);
    }
  });
  it('routes HTML-only image copy through the same empty-slot rules without requiring bitmap files', () => {
    const editor = create(), slot = editor.view.dom.querySelectorAll('[data-image-slot]')[3]; pointAt(slot.querySelector('button'));
    expect(richPasteOn(document.body, { 'text/html': '<img src="https://example.com/one.png" alt="one">' })).toBe(true);
    expect(editor.state.doc.child(1).child(3).firstChild?.attrs.src).toBe('https://example.com/one.png');
    expect(mock.paste).not.toHaveBeenCalled();
  });
  it('preserves the original image and caption when a picture is pasted at a caption caret', () => {
    const editor = create(), image = editor.schema.nodes.image.create({ src: 'morning.png' }), p = editor.schema.nodes.paragraph.create(null, editor.schema.text('caption'));
    editor.view.dispatch(editor.state.tr.replaceWith(13, 15, editor.schema.nodes.imageSlot.create(null, [image, p])));
    const before = editor.state.doc, source = before.child(1).firstChild!;
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(before, 17)));
    pointAt(editor.view.dom.querySelector('[data-image-slot] p'));
    insertImportedSlice(editor.view, { slice: new Slice(Fragment.from(image), 0, 0), bodies: [], diagnostics: [] }, editor.state.selection);
    expect(editor.state.doc.child(1).firstChild!.eq(source)).toBe(true);
    expect(editor.state.doc.child(1).child(1).firstChild?.attrs.src).toBe('morning.png');
    expect(editor.state.selection.$from.parent.textContent).toBe('caption');
    expect(editor.state.doc.childCount).toBe(before.childCount);
    editor.commands.undo(); expect(editor.state.doc.eq(before)).toBe(true);
  });
  it('does not redirect a different caret to an occupied slot just because the mouse is on its caption', () => {
    const editor = create(), image = editor.schema.nodes.image.create({ src: 'morning.png' }), p = editor.schema.nodes.paragraph.create(null, editor.schema.text('caption'));
    editor.view.dispatch(editor.state.tr.replaceWith(13, 15, editor.schema.nodes.imageSlot.create(null, [image, p])));
    editor.commands.setTextSelection(2); pointAt(editor.view.dom.querySelector('[data-image-slot] p'));
    paste(editor); expect(mock.paste).toHaveBeenLastCalledWith(editor, expect.any(Array), 'test.nb', undefined);
  });
  it('right-click copy targets the clicked picture instead of an unrelated text selection', () => {
    const editor = create(), image = editor.schema.nodes.image.create({ src: 'morning.png' });
    editor.view.dispatch(editor.state.tr.replaceWith(13, 15, editor.schema.nodes.imageSlot.create(null, image)));
    editor.commands.setTextSelection({ from: 1, to: 5 });
    selectContextMenuTarget(editor.view, editor.view.dom.querySelector('img'), { x: 0, y: 0 });
    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
    expect((editor.state.selection as NodeSelection).node.attrs.src).toBe('morning.png');
  });
  it('shows only an insertion line at a block boundary and confines slot text to the slot', () => {
    const editor = create(), indicator = createImageDropIndicator(editor.view), block = editor.view.dom.querySelector('p')!;
    vi.spyOn(block, 'getBoundingClientRect').mockReturnValue({ top: 20, bottom: 140, left: 10, right: 310, width: 300, height: 120, x: 10, y: 20, toJSON() {} });
    indicator.show({ position: 0, line: 20, block });
    const line = document.querySelector<HTMLElement>('[data-image-drop-indicator="block"]')!;
    expect(line.textContent).toBe(''); expect(line.style.height).toBe('0px'); expect(line.style.top).toBe('20px');
    expect(line.style.padding).toBe(''); expect(line.getAttribute('aria-label')).toBe('释放图片以插入文档');
    const slot = editor.view.dom.querySelector<HTMLElement>('[data-image-slot]')!;
    indicator.show({ position: 14, slot });
    expect(line.isConnected).toBe(false);
    const hint = document.querySelector<HTMLElement>('[data-image-drop-indicator="slot"]')!;
    expect(hint.textContent).toBe('释放图片以填入此处'); expect(hint.style.overflow).toBe('hidden');
    indicator.clear(); expect(hint.isConnected).toBe(false);
  });
  it('snaps a drop in the middle of wrapped prose to the whole paragraph boundary', () => {
    const editor = create(), paragraph = editor.view.dom.querySelector('p')!;
    hit = paragraph;
    vi.spyOn(editor.view, 'posAtCoords').mockReturnValue({ pos: 5, inside: 0 });
    vi.spyOn(paragraph, 'getBoundingClientRect').mockReturnValue({ top: 20, bottom: 140, left: 0, right: 300, width: 300, height: 120, x: 0, y: 20, toJSON() {} });
    expect(imageDropTargetAtPoint(editor.view, { x: 30, y: 50 })).toMatchObject({ position: 0, line: 20 });
    expect(imageDropTargetAtPoint(editor.view, { x: 30, y: 110 })).toMatchObject({ position: editor.state.doc.firstChild!.nodeSize, line: 140 });
  });
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
