// @vitest-environment jsdom
import { act } from 'react';
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
function type(textarea: HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, value);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}
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

  it('does not show alt or title as a caption, commits one undo step, cancels and clears without scrolling', async () => {
    const { editor, host } = await mount();
    expect(host.querySelector('[data-image-caption]')).toBeNull();
    const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    await act(async () => { expect(editFigureCaption(editor, 0)).toBe(true); });
    let textarea = host.querySelector('textarea')!;
    expect(textarea).not.toBeNull(); expect(textarea.value).toBe(''); expect(document.activeElement).toBe(textarea);
    await act(async () => { type(textarea, '新图注\n第二行'); });
    expect(editor.state.doc.firstChild?.attrs.caption).toBeNull();
    const newline = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true });
    await act(async () => { textarea.dispatchEvent(newline); });
    expect(newline.defaultPrevented).toBe(false); expect(host.querySelector('textarea')).toBe(textarea);
    await act(async () => { textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); });
    expect(editor.state.doc.firstChild?.attrs.caption).toBe('新图注\n第二行'); expect(host.querySelector('[data-image-caption]')?.textContent).toBe('新图注\n第二行');
    await act(async () => { expect(editor.commands.undo()).toBe(true); });
    expect(editor.state.doc.firstChild?.attrs.caption).toBeNull();
    await act(async () => { editor.commands.redo(); editFigureCaption(editor, 0); });
    textarea = host.querySelector('textarea')!;
    await act(async () => { type(textarea, '取消此修改'); });
    await act(async () => { textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
    expect(editor.state.doc.firstChild?.attrs.caption).toBe('新图注\n第二行');
    await act(async () => { editFigureCaption(editor, 0); });
    textarea = host.querySelector('textarea')!;
    await act(async () => { type(textarea, ''); });
    await act(async () => { textarea.blur(); });
    expect(editor.state.doc.firstChild?.attrs.caption).toBeNull(); expect(host.querySelector('[data-image-caption]')).toBeNull();
    expect(scroll).not.toHaveBeenCalled();
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
