// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Editor, type JSONContent } from '@tiptap/core';
import { EditorContent } from '@tiptap/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDocumentExtensions, documentParser } from '../../src/features/editor-md/documentExtensions';
import { parseNativeNode, serializeNativeNode } from '../../src/features/editor-md/editorDocumentCodec';
import { encodeNativeDocument } from '../../src/core/nativeDocument';
import { EnhancedImageBlock } from '../../src/features/editor-md/imageNodeView';
import { editFigureCaption, setFigureCaption } from '../../src/features/editor-md/figureCaptionCommands';
import { portableMarkdown } from '../../src/features/export/portableMarkdown';
import { renderDocument } from '../../src/features/export/renderDocument';
import { nativeTestEditor } from './nativeTestEditor';

vi.mock('@tiptap/react/menus', () => ({ BubbleMenu: ({ children }: { children: ReactNode }) => children }));

const editors: Editor[] = [], roots: Root[] = [];
const image = (caption: unknown = null): JSONContent => ({ type: 'image', attrs: { src: './assets/a.png', alt: 'Accessible description', title: 'Original filename', width: '50%', align: 'right', caption } });
function create(content: JSONContent[] = [image()], interactive = false) {
  const editor = nativeTestEditor(new Editor({ extensions: buildDocumentExtensions(interactive ? { image: EnhancedImageBlock } : {}), content: { type: 'doc', content } }));
  editors.push(editor); return editor;
}
async function mount(content: JSONContent[] = [image()]) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const editor = create(content, true), host = document.createElement('div'), root = createRoot(host);
  document.body.append(host); roots.push(root);
  await act(async () => { root.render(<EditorContent editor={editor}/>); await new Promise(resolve => setTimeout(resolve, 0)); });
  return { editor, host };
}
const captionEditor = (host: HTMLElement) => host.querySelector<HTMLElement & { editor: Editor }>('.nb-caption-editor')!;
afterEach(async () => {
  await act(async () => { roots.splice(0).forEach(root => root.unmount()); editors.splice(0).forEach(editor => editor.destroy()); });
  document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe('single image captions', () => {
  it('round trips native caption text independently of alt, title and the asset path and rejects invalid types', () => {
    const editor = create([image('图 1：照片\n第二行')]), source = serializeNativeNode(editor.state.doc);
    expect(source).toContain('caption'); expect(source).toContain('图 1：照片');
    const parsed = parseNativeNode(source, documentParser().schema);
    expect(parsed.toJSON()).toEqual(editor.state.doc.toJSON());
    expect(parsed.firstChild?.attrs).toMatchObject({ src: './assets/a.png', alt: 'Accessible description', title: 'Original filename', caption: '图 1：照片\n第二行' });
    const invalid = parseNativeNode(encodeNativeDocument({ type: 'doc', content: [image({ text: 'wrong type' })] }), documentParser().schema);
    expect(invalid.firstChild?.type.name).toBe('nativeError');
  });

  it('exports safe semantic HTML with one width scale and keeps caption text in plain Markdown', async () => {
    const caption = '说明 <script>alert(1)</script>\n*原样文字*';
    const editor = create([image(caption)]), html = editor.getHTML(), dom = document.createElement('div'); dom.innerHTML = html;
    const figure = dom.querySelector('figure')!, img = figure.querySelector('img')!;
    expect(figure.style.width).toBe('50%'); expect(img.style.width).toBe('100%'); expect(img.hasAttribute('width')).toBe(false);
    expect(figure.querySelector('figcaption')?.textContent).toBe(caption); expect(dom.querySelector('script')).toBeNull();
    editor.commands.setContent(html);
    expect(editor.state.doc.firstChild?.attrs).toMatchObject({ src: './assets/a.png', width: '50%', align: 'right', caption });
    const exported = await renderDocument('', 'Caption', '', undefined, editor.state.doc);
    expect(exported.html).toContain('<figcaption'); expect(exported.html).not.toContain('<script>');
    const markdown = portableMarkdown(editor.state.doc.toJSON());
    expect(markdown).toContain('![Accessible description](./assets/a.png "Original filename")');
    expect(markdown).toContain('说明'); expect(markdown).toContain('原样文字'); expect(markdown).not.toContain('caption=');
  });

  it('offers an empty caption without document content, edits normal text and shares native undo without scrolling', async () => {
    const { editor, host } = await mount();
    expect(host.querySelector('[data-image-caption]')).toBeNull();
    expect(host.querySelector('.nb-caption-empty [aria-label="添加图注"]')).not.toBeNull();
    const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    await act(async () => { expect(editFigureCaption(editor, 0)).toBe(true); });
    await act(async () => { await vi.dynamicImportSettled(); });
    let input = captionEditor(host);
    expect(input).not.toBeNull(); expect(document.activeElement).toBe(input); expect(host.querySelector('textarea')).toBeNull();
    await act(async () => { input.editor.commands.insertContent('新图注'); });
    expect(editor.state.doc.firstChild?.attrs.caption).toBe('新图注');
    await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); input.editor.commands.insertContent('第二行'); });
    expect(editor.state.doc.firstChild?.attrs.caption).toBe('新图注\n第二行');
    await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true })); });
    expect(editor.state.doc.firstChild?.attrs.caption).toBeNull();
    await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true })); });
    expect(editor.state.doc.firstChild?.attrs.caption).toBe('新图注\n第二行');
    await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
    expect(captionEditor(host)).toBeNull();
    await act(async () => { editFigureCaption(editor, 0); await vi.dynamicImportSettled(); });
    input = captionEditor(host);
    await act(async () => { input.editor.commands.clearContent(); input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(editor.state.doc.firstChild?.attrs.caption).toBeNull(); expect(host.querySelector('[data-image-caption]')).toBeNull();
    expect(scroll).not.toHaveBeenCalled();
  });

  it('selects caption text with the shared color toolbar and keeps formatting on reopening', async () => {
    const { editor, host } = await mount([image('Editable caption')]);
    await act(async () => { editFigureCaption(editor, 0); await vi.dynamicImportSettled(); });
    const input = captionEditor(host);
    await act(async () => { input.editor.commands.setTextSelection({ from: 1, to: 9 }); await new Promise(resolve => setTimeout(resolve, 30)); });
    expect(document.querySelector('[data-caption-toolbar] [aria-label="选择文字颜色与高亮"]')).not.toBeNull();
    await act(async () => { input.editor.chain().toggleBold().setMark('textColor', { color: '#2563eb' }).setHighlight({ color: '#fef08a' }).run(); });
    expect(editor.state.doc.firstChild?.attrs.captionContent[0].marks.map((mark: { type: string }) => mark.type)).toEqual(expect.arrayContaining(['bold', 'highlight', 'textColor']));
    await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(host.querySelector('.nb-image-caption-text strong')?.textContent).toBe('Editable');
    const reopened = parseNativeNode(serializeNativeNode(editor.state.doc), editor.schema);
    expect(reopened.firstChild?.attrs.captionContent).toEqual(editor.state.doc.firstChild?.attrs.captionContent);
    await act(async () => { editFigureCaption(editor, 0); await vi.dynamicImportSettled(); });
    await act(async () => { captionEditor(host).editor.chain().setTextSelection({ from: 1, to: 9 }).setLink({ href: './notes/source.nbdoc' }).run(); });
    const moved = parseNativeNode(serializeNativeNode(editor.state.doc, 'C:/notes'), editor.schema);
    expect(moved.firstChild?.attrs.captionContent[0].marks.find((mark: { type: string }) => mark.type === 'link').attrs.href).toBe('C:/notes/notes/source.nbdoc');
  });

  it('keeps gallery paragraph captions singular and retains image asset attributes through edits', async () => {
    const { editor, host } = await mount([{ type: 'imageCollection', attrs: { layout: 'carousel' }, content: [{ type: 'imageSlot', content: [image('已有图注'), { type: 'paragraph', content: [{ type: 'text', text: '已有图注' }] }] }] }]);
    expect(host.querySelectorAll('[data-image-caption]')).toHaveLength(0);
    expect(host.querySelector('[data-image-caption-edit]')).toBeNull();
    const attrs = editor.state.doc.nodeAt(2)!.attrs;
    await act(async () => { setFigureCaption(editor.view, 2, '单图补充说明'); });
    expect(editor.state.doc.nodeAt(2)?.attrs).toMatchObject({ ...attrs, caption: '单图补充说明' });
    expect(host.querySelector('[data-image-caption]')?.textContent).toBe('单图补充说明');
  });
});
