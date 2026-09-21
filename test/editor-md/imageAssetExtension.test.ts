import { describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { Markdown } from '@tiptap/markdown';
import { ImageAssetLifecycle } from '../../src/features/editor-md/imageAssetExtension';
import { reconcileImageAssets } from '../../src/features/editor-md/imageAssetLifecycle';
import { parseMarkdown } from '../../src/features/editor-md/serialize';
vi.mock('../../src/features/editor-md/imageAssetLifecycle', () => ({ reconcileImageAssets: vi.fn() }));

describe('图片变更来源', () => {
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
