import { describe, expect, it } from 'vitest';
import type { JSONContent } from '@tiptap/core';
import { documentParser } from '../../src/features/editor-md/documentExtensions';
import { parseAuthoring } from '../../src/features/declarative/authoring';
import { writeAuthoring } from '../../src/features/declarative/write';
import { rememberAuthoringSource, inheritAuthoringSource, serializeAuthoring } from '../../src/features/declarative/authoring';
import type { AuthoringSpan } from '../../src/features/declarative/types';

function atPath(node: JSONContent, path: number[]) { return path.reduce((current, index) => current.content![index], node); }
function jsonDecodedSpan(source: string, span: AuthoringSpan) {
  const raw = source.slice(span.contentFrom! - 1, span.contentTo! + 1); return JSON.parse(raw);
}
describe('native preservation source spans', () => {
  it('maps repeated text and formula JSON strings by child paths in both emitted and parsed native blocks', () => {
    const { schema } = documentParser();
    const content: JSONContent = { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableHeader', attrs: { colspan: 2, colwidth: [80, 90] }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '重复"引号"\n换行😀' }, { type: 'mathInline', attrs: { latex: '\\frac{"重复"}{x}\n+y', delimiter: '$$' } }] }] }] }, { type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '重复"引号"\n换行😀' }] }] }, { type: 'tableCell', content: [{ type: 'paragraph' }] }] }] };
    const doc = schema.nodeFromJSON({ type: 'doc', content: [content] }); doc.check();
    const written = writeAuthoring(doc.toJSON(), schema), parsed = parseAuthoring(written.text);
    expect(schema.nodeFromJSON(parsed.document).toJSON()).toEqual(doc.toJSON());
    for (const spans of [written.spans, parsed.spans]) {
      const payloads = spans.filter(span => span.kind === 'text' || span.kind === 'attribute'); expect(payloads).toHaveLength(3);
      for (const span of payloads) {
        const node = atPath(parsed.document, span.path), value = span.kind === 'text' ? node.text! : String(node.attrs?.latex);
        expect(jsonDecodedSpan(written.text, span)).toBe(value); expect(span.offsets).toHaveLength(value.length + 1);
        for (let index = 0; index < value.length; index++) {
          const from = span.offsets![index], to = span.offsets![index + 1], raw = written.text.slice(from, to);
          if (raw.startsWith('\\')) expect(JSON.parse('"' + raw + '"')).toBe(value[index]); else expect(raw).toBe(value[index]);
        }
      }
      expect(payloads[0].from).not.toBe(payloads[2].from);
    }
  });
  it('maps explicit unicode/quote/newline escapes without a repeated-text search', () => {
    const source = '::: native version=1\n{"content":[{"text":"\\u91cd\\u590d\\"\\n","type":"text"},{"text":"\\u91cd\\u590d\\"\\n","type":"text"}],"attrs":{"indent":2},"type":"paragraph"}\n:::';
    const parsed = parseAuthoring(source), span = parsed.spans.find(item => item.kind === 'text')!;
    expect(atPath(parsed.document, span.path).text).toBe('重复"\n重复"\n');
    expect(span.offsets).toHaveLength(9); expect(span.offsets![0]).toBe(source.indexOf('\\u91cd')); expect(span.offsets![4]).toBe(source.lastIndexOf('\\u91cd'));
  });
  it('provides monotonic encoded positions for native inline text and formulas', () => {
    const { schema } = documentParser(), doc = schema.nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '中文"\n😀', marks: [{ type: 'highlight', attrs: { color: null } }] }, { type: 'mathInline', attrs: { delimiter: '$$', latex: '\\frac{中文}{x}' } }] }] });
    const written = writeAuthoring(doc.toJSON(), schema), parsed = parseAuthoring(written.text);
    for (const spans of [written.spans, parsed.spans]) for (const span of spans.filter(item => item.kind === 'text' || item.kind === 'attribute')) {
      const node = atPath(parsed.document, span.path), value = span.kind === 'text' ? node.text! : String(node.attrs?.latex);
      expect(span.offsets).toHaveLength(value.length + 1); expect(span.offsets![0]).toBeGreaterThan(20);
      expect(span.offsets!.every((offset, index, all) => index === 0 || offset >= all[index - 1])).toBe(true);
    }
    expect(parsed.spans.filter(item => item.kind === 'text' || item.kind === 'attribute')).toHaveLength(2);
  });
  it('maps final paths after adjacent equal-mark native inline text runs join', () => {
    const { schema } = documentParser(), text = { type: 'text', text: '重复', marks: [{ type: 'highlight', attrs: { color: null } }] };
    const single = writeAuthoring({ type: 'paragraph', content: [text] }, schema).text, parsed = parseAuthoring(single + single), span = parsed.spans.find(item => item.kind === 'text')!;
    expect(parsed.document.content![0].content).toHaveLength(1); expect(span.path).toEqual([0, 0]); expect(span.offsets).toHaveLength(5); expect(span.offsets![2]).toBeGreaterThan(single.length);
  });
  it('patches JSON text escapes locally while preserving surrounding authored blocks', () => {
    const { schema } = documentParser(), source = '前段  原格式\n\n::: native version=1\n{"type":"paragraph","attrs":{"indent":2},"content":[{"type":"text","text":"旧\\"内容\\n"}]}\n:::\n\n后段  原格式';
    const parsed = parseAuthoring(source), original = schema.nodeFromJSON(parsed.document); rememberAuthoringSource(original, parsed);
    const json = original.toJSON(); json.content![1].content![0].text = '新"内容\n'; const changed = schema.nodeFromJSON(json); inheritAuthoringSource(original, changed);
    expect(serializeAuthoring(changed).text).toBe(source.replace('旧\\"内容\\n', '新\\"内容\\n'));
  });
});
