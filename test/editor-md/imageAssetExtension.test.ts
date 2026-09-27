import { describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { Markdown } from '@tiptap/markdown';
import { ImageAssetLifecycle } from '../../src/features/editor-md/imageAssetExtension';
import { reconcileImageAssets } from '../../src/features/editor-md/imageAssetLifecycle';
import { parseMarkdown } from '../../src/features/editor-md/serialize';
import { buildDocumentExtensions } from '../../src/features/editor-md/documentExtensions';
import { AnnotationBehavior } from '../../src/features/editor-md/annotations/extension';
vi.mock('../../src/features/editor-md/imageAssetLifecycle', () => ({ reconcileImageAssets: vi.fn() }));

describe('图片变更来源', () => {
  it('keeps cut assets available on the clipboard until they can be pasted', async () => {
    const editor = new Editor({ extensions: [StarterKit, Image, ImageAssetLifecycle], content: '<img src="img/cut.png"><p></p>' });
    const calls = vi.mocked(reconcileImageAssets); calls.mockClear();
    try {
      editor.view.dispatch(editor.state.tr.delete(0, 1).setMeta('noteboard-image-cut', true));
      await Promise.resolve();
      expect(calls.mock.calls.every(call => !call[1].size)).toBe(true);
    } finally { editor.destroy(); }
  });
  it('also preserves assets in the attachment removed by an appended cut cleanup', async () => {
    const editor = new Editor({ extensions: [...buildDocumentExtensions(), ImageAssetLifecycle, AnnotationBehavior], content: { type: 'doc', content: [
      { type: 'image', attrs: { src: 'img/cut.png', annotationId: 'attachment' } },
      { type: 'annotationStore', content: [{ type: 'annotationBody', attrs: { id: 'attachment' }, content: [{ type: 'image', attrs: { src: 'img/body.png' } }] }] },
    ] } });
    const calls = vi.mocked(reconcileImageAssets); calls.mockClear();
    try {
      editor.view.dispatch(editor.state.tr.delete(0, 1).setMeta('noteboard-image-cut', true));
      await Promise.resolve();
      expect(JSON.stringify(editor.getJSON())).not.toContain('annotationStore');
      expect(calls.mock.calls.every(call => !call[1].size)).toBe(true);
    } finally { editor.destroy(); }
  });
  it('加载和模式同步不请求删除，用户删除和历史导航能识别图片变化', async () => {
    const editor = new Editor({ extensions: [StarterKit, Image, ImageAssetLifecycle.configure({ docKey: 'C:\\notes\\a.md' }), Markdown] });
    const calls = vi.mocked(reconcileImageAssets);
    try {
      parseMarkdown(editor, '![a](img/a.png)');
      await Promise.resolve();
      calls.mockClear();
      parseMarkdown(editor, '新正文');
      await Promise.resolve();
      expect(calls.mock.calls.every((call) => call[1].size === 0)).toBe(true);
      parseMarkdown(editor, '![a](img/a.png)');
      await Promise.resolve();
      calls.mockClear();
      editor.commands.deleteRange({ from: 0, to: editor.state.doc.firstChild!.nodeSize });
      await Promise.resolve();
      expect(calls.mock.calls[0][1]).toEqual(new Set(['img/a.png']));
      calls.mockClear();
      parseMarkdown(editor, '![a](img/a.png)', 'history');
      await Promise.resolve();
      expect(calls.mock.calls[0][2]).toEqual(new Set(['img/a.png']));
      calls.mockClear();
      parseMarkdown(editor, '正文', 'history');
      await Promise.resolve();
      expect(calls.mock.calls[0][1]).toEqual(new Set(['img/a.png']));
    } finally { editor.destroy(); }
  });
});
