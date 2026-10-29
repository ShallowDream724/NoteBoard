import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Schema } from '@tiptap/pm/model';
import { countDocumentText, countNativeDocument, createRichDocumentCounter } from '../../src/features/document-statistics/documentStatistics';
import { countDocumentSource } from '../../src/features/document-statistics/documentSourceStatistics';
import { encodeNativeDocument, type NativeNode } from '../../src/core/nativeDocument';

describe('body statistics', () => {
  // Production loads the grammar in a worker once. Cold Vite transforms are
  // outside the counting behavior tested below.
  beforeAll(async () => { await countDocumentSource('', 'markdown'); }, 20000);
  it('counts CJK individually and mixed-language words without counting whitespace or UTF-16 surrogates twice', () => {
    expect(countDocumentText("中文 Hello world 123 don't\n\t🙂！")).toEqual({ characters: 22, words: 6 });
    expect(countDocumentText('  \r\n\t')).toEqual({ characters: 0, words: 0 });
    expect(countDocumentText('かな한글')).toEqual({ characters: 4, words: 4 });
  });

  const document: NativeNode = { type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Hel' }, { type: 'text', text: 'lo 中文', marks: [{ type: 'bold' }] }, { type: 'mathInline', attrs: { latex: 'secretFormula' } }] },
    { type: 'codeBlock', content: [{ type: 'text', text: 'const x = 2;' }] },
    { type: 'image', attrs: { src: 'https://example.com/very-long-image-address.png', alt: 'invisible alt', caption: 'duplicate caption', captionContent: [{ type: 'text', text: '图注 one' }] } },
    { type: 'githubAlert', attrs: { title: '提示' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body' }] }] },
    { type: 'annotationStore', content: [{ type: 'annotationBody', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hidden annotation' }] }] }] },
    { type: 'documentPresentation', attrs: { title: 'metadata' } },
    { type: 'nativeError', attrs: { raw: 'do not count JSON or error source' } },
    { type: 'mermaidBlock', attrs: { code: 'graph TD; A-->B;' } },
    { type: 'mathBlock', attrs: { latex: 'x + y' } },
  ] };
  it('counts visible semantic body, captions and code once while excluding hidden and non-text content', () => {
    const expected = countDocumentText('Hello 中文 const x = 2; 图注 one 提示 Body');
    expect(countNativeDocument(document)).toEqual(expected);
  });
  it('decodes native frames before counting, in either visual or source mode', async () => {
    expect(await countDocumentSource(encodeNativeDocument(document), 'noteboard')).toEqual(countNativeDocument(document));
    expect(await countDocumentSource('#!noteboard 1\n@block broken JSON', 'noteboard')).toEqual({ characters: 0, words: 0 });
  });
  it('projects Markdown body and preserves literal code while omitting markup, link destinations and math', async () => {
    const source = '# 中文 **Hello** [world](https://example.com) ![ignored](image.png)\n\n$x+y$ and `price = $5`\n\n```js\nconst x = 2;\n```\n\n```mermaid\ngraph TD; A-->B\n```\n\n$$\nx+y\n$$';
    expect(await countDocumentSource(source, 'markdown')).toEqual(countDocumentText('中文 Hello world and price = $5 const x = 2;'));
  });
  it('joins styled inline text and reuses unchanged immutable rich subtrees', () => {
    const schema = new Schema({ nodes: { doc: { content: 'block+' }, paragraph: { group: 'block', content: 'text*' }, text: {} }, marks: { bold: {} } });
    const first = schema.node('paragraph', null, [schema.text('Hel'), schema.text('lo', [schema.mark('bold')])]);
    const second = schema.node('paragraph', null, schema.text('中文'));
    const scanFirst = vi.spyOn(first, 'forEach');
    const count = createRichDocumentCounter();
    expect(count(schema.node('doc', null, [first, second]))).toEqual({ characters: 7, words: 3 });
    const initialScans = scanFirst.mock.calls.length;
    expect(count(schema.node('doc', null, [first, schema.node('paragraph', null, schema.text('new word'))]))).toEqual({ characters: 12, words: 3 });
    expect(scanFirst).toHaveBeenCalledTimes(initialScans);
  });
  it('counts declarative body, table captions and fold titles without commands or hidden definitions', async () => {
    const source = String.raw`\color[#224466]{Hello 中文} \note{anchor}{hidden body}

::: fold "Details"
Visible text
:::

::: table 1*1
| Cell |
| --- |

Caption
:::

::: annotation saved
Hidden definition
:::`;
    expect(await countDocumentSource(source, 'markdown')).toEqual(countDocumentText('Hello 中文 anchor Details Visible text Caption Cell'));
  });
});
