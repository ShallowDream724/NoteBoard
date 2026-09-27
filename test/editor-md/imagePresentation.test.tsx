// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Editor, type JSONContent } from '@tiptap/core';
import { EditorContent } from '@tiptap/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDocumentExtensions } from '../../src/features/editor-md/documentExtensions';
import { EnhancedImageBlock } from '../../src/features/editor-md/imageNodeView';
import { renderDocument } from '../../src/features/export/renderDocument';
import { portableMarkdown } from '../../src/features/export/portableMarkdown';
import { nativeTestEditor } from './nativeTestEditor';
import { TooltipProvider } from '../../src/components/Tooltip';
import collectionStyles from '../../src/features/export/richDocument.css?raw';
import editorCollectionStyles from '../../src/features/editor-md/rich-content/richContent.css?raw';
import { InteractiveImageSlot } from '../../src/features/editor-md/rich-content/views';

vi.mock('@tiptap/react/menus', () => ({ BubbleMenu: ({ children }: { children: ReactNode }) => children }));

const editors: Editor[] = [], roots: Root[] = [];
const image = (attrs: Record<string, unknown> = {}): JSONContent => ({ type: 'image', attrs: {
  src: './assets/photo.png', alt: 'A photo', title: 'Original', width: '50%', align: 'center', ...attrs,
} });
function create(content: JSONContent[], interactive = false, collectionView = false) {
  const editor = nativeTestEditor(new Editor({ extensions: buildDocumentExtensions(interactive ? { image: EnhancedImageBlock, ...(collectionView ? { imageSlot: InteractiveImageSlot } : {}) } : {}), content: { type: 'doc', content } }));
  editors.push(editor); return editor;
}
async function mount(content: JSONContent[], collectionView = false) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const editor = create(content, true, collectionView), host = document.body.appendChild(document.createElement('div')), root = createRoot(host);
  roots.push(root);
  await act(async () => { root.render(<TooltipProvider><EditorContent editor={editor}/></TooltipProvider>); await new Promise(resolve => setTimeout(resolve, 0)); });
  return { editor, host };
}
const pointer = (element: Element, type: string, x = 10, y = 10) => element.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }));
const preview = () => document.querySelector('[data-image-lightbox]');
afterEach(async () => {
  await act(async () => { roots.splice(0).forEach(root => root.unmount()); editors.splice(0).forEach(editor => editor.destroy()); });
  document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe('image presentation contract', () => {
  it('routes the public image command through block and collection insertion rules', () => {
    const editor = create([{ type: 'paragraph' }], true);
    const insert = () => (editor.commands as unknown as { setImage(options: { src: string }): boolean }).setImage({ src: './inserted.png' });
    expect(insert()).toBe(true);
    expect(editor.state.doc.child(0).type.name).toBe('image');
    expect(editor.state.doc.child(1).type.name).toBe('paragraph');
    expect(editor.state.selection.$from.parent.type.name).toBe('paragraph');
    editor.commands.setContent({ type: 'doc', content: [{ type: 'imageCollection', content: [{ type: 'imageSlot', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Retained caption' }] }] }] }] });
    editor.commands.setTextSelection(3);
    expect(insert()).toBe(true);
    const slot = editor.state.doc.firstChild!.firstChild!;
    expect(slot.firstChild!.attrs.src).toBe('./inserted.png');
    expect(slot.lastChild!.textContent).toBe('Retained caption');
  });

  it.each(['left', 'center', 'right'])('preserves %s alignment and width without a caption in HTML and print', async align => {
    const editor = create([image({ align })]), html = editor.getHTML(), host = document.createElement('div');
    for (const output of [html, (await renderDocument('', 'Images', '', undefined, editor.state.doc, undefined, undefined, 'html')).html,
      (await renderDocument('', 'Images', '', undefined, editor.state.doc, undefined, undefined, 'print')).html]) {
      host.innerHTML = output;
      const figure = host.querySelector<HTMLElement>('figure[data-nb-image]')!, img = figure.querySelector('img')!;
      expect(figure.style.width).toBe('50%'); expect(figure.style.marginLeft).toBe(align === 'left' ? '0px' : 'auto');
      expect(figure.style.marginRight).toBe(align === 'right' ? '0px' : 'auto');
      expect(img.style.width).toBe('100%'); expect(img.hasAttribute('width')).toBe(false); expect(img.hasAttribute('align')).toBe(false);
      expect(figure.querySelector('figcaption')).toBeNull();
    }
    editor.commands.setContent(html);
    expect(editor.state.doc.firstChild?.attrs).toMatchObject({ src: './assets/photo.png', alt: 'A photo', title: 'Original', align, width: '50%', caption: null });
    expect(portableMarkdown(editor.getJSON()).trim()).toBe('![A photo](./assets/photo.png "Original")');
  });

  it.each(['320px', '320'])('normalizes %s width for rendering and retains the original attribute on import', width => {
    const editor = create([image({ width })]), host = document.createElement('div'); host.innerHTML = editor.getHTML();
    expect(host.querySelector<HTMLElement>('figure')?.style.width).toBe('320px');
    editor.commands.setContent(host.innerHTML); expect(editor.state.doc.firstChild?.attrs.width).toBe(width);
  });

  it('continues to import legacy bare images with width, alignment, description and asset paths', () => {
    const editor = create([]);
    editor.commands.setContent('<img src="./assets/photo.png" width="320" align="right" alt="A photo" title="Original">');
    expect(editor.state.doc.firstChild?.attrs).toMatchObject({ src: './assets/photo.png', width: 320, align: 'right', alt: 'A photo', title: 'Original', caption: null });
    expect(editor.getHTML()).toContain('data-nb-image');
  });

  it('round trips collection images and their captions without turning nested figures into duplicate nodes', async () => {
    const content: JSONContent[] = [{ type: 'imageCollection', attrs: { layout: 'grid', columns: 2 }, content: [
      { type: 'imageSlot', content: [image(), { type: 'paragraph', content: [{ type: 'text', text: 'Slot caption' }] }] },
      { type: 'imageSlot', content: [image({ caption: 'Image caption' })] },
    ] }, { type: 'paragraph' }];
    const editor = create(content), before = editor.getJSON(), html = editor.getHTML();
    editor.commands.setContent(html); expect(editor.getJSON()).toEqual(before);
    const output = await renderDocument('', 'Images', '', undefined, editor.state.doc), host = document.createElement('div'); host.innerHTML = output.html;
    const style = document.body.appendChild(document.createElement('style')); style.textContent = collectionStyles;
    document.body.append(host);
    expect(host.querySelectorAll('.export-image-slot')).toHaveLength(2);
    expect(host.querySelectorAll('.export-image-slot > figure[data-nb-image] > img')).toHaveLength(2);
    expect(host.querySelectorAll('figcaption')).toHaveLength(1); expect(host.querySelector('.export-image-slot > p')?.textContent).toBe('Slot caption');
    for (const figure of host.querySelectorAll('.export-image-slot > figure[data-nb-image]')) {
      expect(getComputedStyle(figure).width).toBe('100%'); expect(getComputedStyle(figure).margin).toBe('0px');
    }
  });
});

describe('image preview gestures', () => {
  it.each(['grid', 'carousel'])('keeps preview, edit and delete visibly available in %s while hiding image layout controls', async layout => {
    const { host } = await mount([{ type: 'imageCollection', attrs: { layout }, content: [{ type: 'imageSlot', content: [image()] }] }], true);
    const style = document.body.appendChild(document.createElement('style')); style.textContent = editorCollectionStyles;
    await act(async () => { host.querySelector('img')!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); });
    const toolbar = host.querySelector<HTMLElement>('.nb-image-slot [data-image-toolbar]')!;
    expect(getComputedStyle(host.querySelector<HTMLElement>('.nb-image-slot [data-image-frame]')!).maxHeight).toBe('440px');
    for (const label of ['查看大图 / 放大预览', '编辑图片', '删除图片']) {
      const action = toolbar.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
      expect(action).not.toBeNull(); expect(getComputedStyle(action).display).not.toBe('none');
    }
    for (const label of ['居左对齐', '居中对齐', '居右对齐', '缩放为 50%', '缩放为 75%', '缩放为 100%']) {
      expect(getComputedStyle(toolbar.querySelector<HTMLElement>(`[aria-label="${label}"]`)!).display).toBe('none');
    }
  });

  it.each(['single', 'grid', 'carousel'])('opens the shared preview on one %s image click without editing the document', async layout => {
    const content: JSONContent[] = layout === 'single' ? [image()] : [{ type: 'imageCollection', attrs: { layout }, content: [{ type: 'imageSlot', content: [image()] }] }];
    const { editor, host } = await mount(content), before = editor.state.doc, img = host.querySelector('img')!;
    await act(async () => { pointer(img, 'pointerdown'); pointer(img, 'pointerup'); img.click(); });
    expect(preview()).not.toBeNull(); expect(editor.state.doc).toBe(before);
    expect(preview()?.querySelector('img')?.getAttribute('src')).toBe('./assets/photo.png');
    await act(async () => { document.querySelector<HTMLButtonElement>('[aria-label="关闭预览"]')!.click(); });
    expect(preview()).toBeNull();
  });

  it('keeps toolbar surfaces, caption editing and resize gestures out of preview', async () => {
    const { editor, host } = await mount([image({ caption: 'Editable caption' })]), img = host.querySelector('img')!;
    await act(async () => { img.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); });
    const toolbar = host.querySelector<HTMLElement>('[data-image-toolbar]')!;
    await act(async () => { pointer(toolbar, 'pointerdown'); toolbar.click(); }); expect(preview()).toBeNull();
    await act(async () => { toolbar.querySelector<HTMLButtonElement>('[aria-label="居右对齐"]')!.click(); });
    expect(editor.state.doc.firstChild?.attrs.align).toBe('right'); expect(preview()).toBeNull();
    await act(async () => {
      host.querySelector('[data-image-resize]')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 0 }));
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 50 })); window.dispatchEvent(new MouseEvent('mouseup')); img.click();
    });
    expect(editor.state.doc.firstChild?.attrs.width).toBe('60%'); expect(preview()).toBeNull();
    await act(async () => { host.querySelector<HTMLElement>('[data-image-caption]')!.click(); await vi.dynamicImportSettled(); });
    expect(preview()).toBeNull();
  });

  it.each(['move', 'drag', 'cancel'])('does not open preview after a %s gesture and allows the next click', async gesture => {
    const { host } = await mount([image()]), img = host.querySelector('img')!;
    await act(async () => {
      pointer(img, 'pointerdown');
      if (gesture === 'move') { pointer(img, 'pointermove', 30); pointer(img, 'pointerup', 10); }
      else img.dispatchEvent(new Event(gesture === 'drag' ? 'dragstart' : 'pointercancel', { bubbles: true }));
      img.click();
    });
    expect(preview()).toBeNull();
    await act(async () => { pointer(img, 'pointerdown'); pointer(img, 'pointerup'); img.click(); });
    expect(preview()).not.toBeNull();
  });
});
