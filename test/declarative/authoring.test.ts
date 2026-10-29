import { describe, expect, it } from 'vitest';
import homeV4 from './fixtures/home-v4.txt?raw';
import type { JSONContent } from '@tiptap/core';
import { parseAuthoring, serializeAuthoring, rememberAuthoringSource, inheritAuthoringSource } from '../../src/features/declarative/authoring';
import { writeAuthoring } from '../../src/features/declarative/write';
import { parseColor, parseParameters } from '../../src/features/declarative/registry';
import { documentParser } from '../../src/features/editor-md/documentExtensions';

const schema = () => documentParser().schema;
function descendants(node: JSONContent, type: string): JSONContent[] { return [...(node.type === type ? [node] : []), ...(node.content ?? []).flatMap(child => descendants(child, type))]; }
function roundtrip(source: string) {
  const first = parseAuthoring(source); expect(first.diagnostics.filter(item => item.severity === 'error')).toEqual([]);
  const doc = schema().nodeFromJSON(first.document); rememberAuthoringSource(doc, first); doc.check();
  const generated = writeAuthoring(doc.toJSON(), schema());
  const second = parseAuthoring(generated.text); expect(second.diagnostics.filter(item => item.severity === 'error')).toEqual([]);
  expect(schema().nodeFromJSON(second.document).toJSON()).toEqual(doc.toJSON());
  return { first, doc, generated };
}
describe('declarative authoring language', () => {
  it('parses and canonically roundtrips the complete v4 home document, including styles', () => {
    const source = homeV4;
    const { first, doc } = roundtrip(source);
    expect(descendants(first.document, 'imageCollection')).toHaveLength(2);
    expect(descendants(first.document, 'table')).toHaveLength(2);
    expect(descendants(first.document, 'annotationBody')).toHaveLength(3);
    expect(serializeAuthoring(doc).text).toBe(source);
    expect(descendants(first.document, 'text').some(node => node.text?.includes('添加与整理：') && node.marks?.some(mark => mark.type === 'bold'))).toBe(true);
  });
  it('accepts RGB/HEX alpha, spaced assignments, aliases, and rejects conflicting fields', () => {
    expect(parseColor('#abc8')).toBe('#aabbcc88');
    expect(parseColor('rgba(37, 99, 235, 0.5)')).toBe('#2563eb80');
    expect(parseColor('rgb(256, 0, 0)')).toBeNull();
    expect(parseParameters('pic', 'center align = M width = 50%', true).values).toEqual({ align: 'center', width: '50%' });
    expect(parseParameters('pic', 'center align=right', true).error).toBeTruthy();
    const { first } = roundtrip('\\color[red]{红\\color[blue]{蓝}红} \\bg[rgba(1, 2, 3, 0.5)]{底色}');
    expect(descendants(first.document, 'text').find(node => node.text === '蓝')?.marks).toContainEqual({ type: 'textColor', attrs: { color: '#0000ff' } });
  });
  it('preserves 100 nested valid inline commands and 100 block scopes', () => {
    const inline = '\\blur{'.repeat(100) + '答案' + '}'.repeat(100); roundtrip(inline);
    const blocks = Array.from({ length: 100 }, () => '::: fold "层"\n').join('') + '正文\n' + ':::\n'.repeat(100);
    const { first } = roundtrip(blocks); expect(descendants(first.document, 'disclosure')).toHaveLength(100);
  });
  it('preserves row-major ordering and 200 positions, padding only explicit grid capacity', () => {
    const source = '::: pic 10*20\n' + Array.from({ length: 200 }, (_, index) => `- ![图${index + 1}](image-${index + 1}.png)`).join('\n') + '\n:::';
    const { first } = roundtrip(source), collection = descendants(first.document, 'imageCollection')[0];
    expect(collection.attrs?.columns).toBe(20); expect(collection.content).toHaveLength(200);
    expect(collection.content?.[180].content?.[0].attrs?.src).toBe('image-181.png');
    const padded = parseAuthoring('::: pic 2*3\n- ![一](1.png)\n-\n:::'); expect(descendants(padded.document, 'imageSlot')).toHaveLength(6);
  });
  it('resolves forward definitions in fold containers and rejects every duplicate reference', () => {
    roundtrip('词\\note[ref=a]{锚点}\n\n::: fold "详情"\n::: annotation a\n说明\n:::\n:::');
    const source = '\\note[ref=a]{一} \\note[ref=a]{二}\n\n::: annotation a\n甲\n:::\n\n::: annotation a\n乙\n:::';
    const result = parseAuthoring(source);
    expect(result.diagnostics.filter(item => item.severity === 'error').length).toBeGreaterThanOrEqual(4);
    expect(descendants(result.document, 'text').some(node => node.marks?.some(mark => mark.type === 'annotationReference'))).toBe(false);
    const doc = schema().nodeFromJSON(result.document); rememberAuthoringSource(doc, result); expect(serializeAuthoring(doc).text).toBe(source);
  });
  it('keeps invalid/unknown blocks, overflow and literal errors as editable source', () => {
    for (const source of ['::: future a=1\n::: annotation hidden\n说明\n:::\n:::', '::: pic 1*1\n- ![一](1.png)\n- ![二](2.png)\n:::', '::: fold "漏结束"\n正文', '\\color[rgb(999,0,0)]{内容}', '\\blur{未闭合\n\n正常段落']) {
      const result = parseAuthoring(source); expect(result.diagnostics.length).toBeGreaterThan(0);
      const doc = schema().nodeFromJSON(result.document); rememberAuthoringSource(doc, result); doc.check(); expect(serializeAuthoring(doc).text).toBe(source);
      expect(parseAuthoring(writeAuthoring(doc.toJSON(), schema()).text).document).toEqual(result.document);
    }
  });
  it('protects code, math, Markdown addresses and per-group emphasis boundaries', () => {
    const { first } = roundtrip('`\\blur{代码}` $\\color{red}{x}$ \\blur{[资料](https://example.test/a}b) 与 `}` 和 \\(a[0]+b\\)}');
    expect(descendants(first.document, 'mathInline')).toHaveLength(2);
    const broken = parseAuthoring('**甲 \\color[red]{乙** 丙}');
    expect(descendants(broken.document, 'text').some(node => node.marks?.some(mark => mark.type === 'bold'))).toBe(false);
    const escaped = parseAuthoring('\\\\blur{字面}'); expect(descendants(escaped.document, 'text').some(node => node.marks?.some(mark => mark.type === 'conceal'))).toBe(false);
  });
  it('rejects both directions of nested link/note interaction without losing source', () => {
    for (const source of ['\\note{[链接](https://example.test)}{说明}', '[\\note{锚点}{说明}](https://example.test)', '\\note{外\\note{内}{说明}}{说明}']) {
      const result = parseAuthoring(source); expect(result.diagnostics.some(item => item.severity === 'error')).toBe(true);
      expect(descendants(result.document, 'text').some(node => node.marks?.some(mark => mark.type === 'annotationReference'))).toBe(false);
    }
  });
  it('maps repeated text by final paths and escaped UTF16/math offsets', () => {
    const source = '重复 \\color[red]{重复} 重复\n\n重复 $x_{重复}$ \\{尾\\}';
    const parsed = parseAuthoring(source);
    const byPath = (path: number[]) => path.reduce((node, child) => node.content![child], parsed.document);
    for (const span of parsed.spans.filter(span => span.kind === 'text' || span.kind === 'attribute')) {
      const node = byPath(span.path), value = span.kind === 'text' ? node.text! : String(node.attrs?.latex);
      expect(span.offsets).toHaveLength(value.length + 1);
      expect(span.offsets!.slice(0, -1).map(offset => source[offset]).join('')).toBe(value);
    }
    const repeats = parsed.spans.filter(span => span.kind === 'text' && byPath(span.path).text?.includes('重复'));
    expect(repeats).toHaveLength(4); expect(new Set(repeats.map(span => span.from)).size).toBe(4);
    expect(parsed.spans.filter(span => span.kind === 'attribute')).toEqual(expect.arrayContaining([expect.objectContaining({ contentFrom: source.indexOf('x_{重复}'), contentTo: source.indexOf('x_{重复}') + 'x_{重复}'.length })]));
  });
  it('uses validated native preservation for merged tables and unsupported properties', () => {
    const native = schema().nodeFromJSON({ type: 'doc', content: [{ type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableHeader', attrs: { colspan: 2, colwidth: [80, 90] }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '合并格' }] }] }] }] }] });
    const generated = writeAuthoring(native.toJSON(), schema()); expect(generated.text).toContain('::: native version=1');
    expect(schema().nodeFromJSON(parseAuthoring(generated.text).document).eq(native)).toBe(true);
    const invalid = parseAuthoring('::: native version=1\n{"type":"imaginary"}\n:::'); expect(invalid.document.content?.[0].type).toBe('authoringRaw');
  });
  it('keeps independent source projections for equal documents and patches only the changed color', () => {
    const one = '\\color[red]{重复}\n\n::: fold "细节" open = true\n::: annotation unused\n保留定义\n:::\n原始  空白\n:::';
    const two = '\\color[color=#ff0000]{重复}\n\n::: fold title="细节" open=true\n::: annotation unused\n保留定义\n:::\n原始  空白\n:::';
    const parsedOne = parseAuthoring(one), docOne = schema().nodeFromJSON(parsedOne.document); rememberAuthoringSource(docOne, parsedOne);
    const parsedTwo = parseAuthoring(two), docTwo = schema().nodeFromJSON(parsedTwo.document); rememberAuthoringSource(docTwo, parsedTwo);
    expect(docOne.eq(docTwo)).toBe(true); expect(serializeAuthoring(docOne).text).toBe(one); expect(serializeAuthoring(docTwo).text).toBe(two);
    const json = docOne.toJSON(); json.content![0].content![0].marks![0].attrs = { color: '#0000ff' };
    const changed = schema().nodeFromJSON(json); inheritAuthoringSource(docOne, changed);
    const written = serializeAuthoring(changed); expect(written.text).toBe(one.replace('\\color[red]', '\\color[#0000ff]'));
    expect(written.spans.length).toBeGreaterThan(0); expect(serializeAuthoring(docTwo).text).toBe(two);
  });
  it('keeps raw recovery literal when a visual edit makes it resemble an executable command', () => {
    const parsed = parseAuthoring('::: future\n原文\n:::'), original = schema().nodeFromJSON(parsed.document); rememberAuthoringSource(original, parsed);
    const json = original.toJSON(); json.content![0].content![0].text = '::: tip\n仍是原文\n:::';
    const edited = schema().nodeFromJSON(json); inheritAuthoringSource(original, edited);
    const written = serializeAuthoring(edited); expect(written.text).toContain('::: native version=1');
    expect(schema().nodeFromJSON(parseAuthoring(written.text).document).eq(edited)).toBe(true);
    const literalDoc = schema().nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'authoringLiteral' }], text: '\\blur{继续原文}' }] }] });
    const inline = writeAuthoring(literalDoc.toJSON(), schema()); expect(inline.text).toContain('\\native[version=1]');
    expect(schema().nodeFromJSON(parseAuthoring(inline.text).document).eq(literalDoc)).toBe(true);
  });
  it('preserves quoted/list host scopes and recovers only the unclosed inner layer', () => {
    const { first } = roundtrip('> ::: fold "引用内"\n> 原文\n> :::\n\n- 列表\n\n  ::: tip\n  项内提示\n  :::');
    expect(descendants(first.document, 'disclosure')).toHaveLength(1);
    const recovered = parseAuthoring('::: fold "外部"\n```txt\n:::\n```\n:::: tip\n未关闭的内层\n:::');
    expect(descendants(recovered.document, 'disclosure')).toHaveLength(1); expect(descendants(recovered.document, 'authoringRaw')).toHaveLength(1);
  });
  it('retains source provenance when the editor appends a synthetic empty tail', () => {
    const source = '::: fold "详情" open = true\n\\color[red]{内容}\n:::';
    const parsed = parseAuthoring(source), json = structuredClone(parsed.document); json.content!.push({ type: 'paragraph' });
    const before = schema().nodeFromJSON(json); rememberAuthoringSource(before, parsed);
    expect(serializeAuthoring(before).text).toBe(source);
    json.content![0].content![0].content![0].text = '修改'; const after = schema().nodeFromJSON(json); inheritAuthoringSource(before, after);
    expect(serializeAuthoring(after).text).toBe(source.replace('内容', '修改'));
  });
});
