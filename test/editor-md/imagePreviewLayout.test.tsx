import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Editor } from '@tiptap/core';
import { EditorContent } from '@tiptap/react';
import { expect, it, vi } from 'vitest';
import { buildDocumentExtensions } from '../../src/features/editor-md/documentExtensions';
import { EnhancedImageBlock } from '../../src/features/editor-md/imageNodeView';
import { TooltipProvider } from '../../src/components/Tooltip';

const preview = vi.hoisted(() => ({ visible: true, source: undefined as string | undefined }));
vi.mock('../../src/features/editor-md/imagePreviewCache', () => ({ useImageDisplayPreview: () => preview.source }));
vi.mock('../../src/features/editor-md/rich-content/imageVisibility', () => ({ useImageVisibility: () => ({ ref: { current: null }, visible: preview.visible, placeholderHeight: 280 }) }));

it('reserves image geometry across offscreen release, width changes and pending preview reloads', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const editor = new Editor({ extensions: buildDocumentExtensions({ image: EnhancedImageBlock }), content: { type: 'doc', content: [{ type: 'image', attrs: { src: './photo.png', width: '100%' } }] } });
  const host = document.body.appendChild(document.createElement('div')), root = createRoot(host);
  try {
    await act(async () => { root.render(<TooltipProvider><EditorContent editor={editor}/></TooltipProvider>); });
    const frame = host.querySelector<HTMLElement>('[data-image-frame]')!, image = host.querySelector('img')!;
    expect(frame.style.minHeight).toBe('280px');
    await act(async () => { image.dispatchEvent(new Event('error')); });
    expect(host.textContent).not.toContain('图片加载失败');
    preview.source = 'blob:first';
    await act(async () => { editor.view.dispatch(editor.state.tr.setNodeAttribute(0, 'title', 'first preview')); });
    expect(frame.style.minHeight).toBe('280px');
    Object.defineProperties(image, { naturalWidth: { configurable: true, value: 1200 }, naturalHeight: { configurable: true, value: 600 } });
    await act(async () => { image.dispatchEvent(new Event('load')); });
    expect(frame.style.aspectRatio).toBe('2 / 1'); expect(frame.style.minHeight).toBe('');
    preview.visible = false; preview.source = undefined;
    await act(async () => { editor.view.dispatch(editor.state.tr.setNodeAttribute(0, 'width', '50%')); });
    expect(frame.style.width).toBe('50%'); expect(frame.style.aspectRatio).toBe('2 / 1');
    expect(image.getAttribute('src')).toBeNull();
    preview.visible = true;
    await act(async () => { editor.view.dispatch(editor.state.tr.setNodeAttribute(0, 'title', 'pending re-entry')); });
    expect(frame.style.aspectRatio).toBe('2 / 1'); expect(image.getAttribute('src')).toBeNull();
    preview.source = 'blob:second';
    await act(async () => { editor.view.dispatch(editor.state.tr.setNodeAttribute(0, 'title', 'reloading')); });
    expect(frame.style.aspectRatio).toBe('2 / 1'); expect(frame.style.width).toBe('50%');
  } finally {
    await act(async () => { root.unmount(); editor.destroy(); }); host.remove(); vi.unstubAllGlobals();
  }
});
