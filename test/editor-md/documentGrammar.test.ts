// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { getSchema } from '@tiptap/core';
import { MarkdownManager } from '@tiptap/markdown';
import { buildExtensions } from '../../src/features/editor-md/extensions';
import { parseMarkdownDocument } from '../../src/features/editor-md/documentExtensions';

describe('shared document grammar', () => {
  const extensions = buildExtensions();
  const manager = new MarkdownManager({ extensions });
  const schema = getSchema(extensions);
  it.each([
    '# 标题\n\n**粗体 `code`**、<em>HTML</em>、~~删除~~。',
    String.raw`正文 $x+1$，\( y^2 \)。\n\n$$\n\frac{a}{b}\n$$`.replaceAll('\\n', '\n'),
    '> [!IMPORTANT]\n> 正文 **强调**\n>\n> - 子项\n> - 第二项',
    '| A | B |\n|---|---|\n| 1 | $x$ |\n\n![图片](img/test.png "标题")',
    '- [x] 已完成\n- [ ] 未完成\n\n```python\nx = 42\n```',
    '<table><tr><th colspan="2">合并表头</th></tr><tr><td>A</td><td>B</td></tr></table>',
  ])('keeps editor and conversion nodes identical: %s', source => {
    expect(parseMarkdownDocument(source).toJSON()).toEqual(schema.nodeFromJSON(manager.parse(source)).toJSON());
  });
});
