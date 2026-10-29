import { describe, expect, it } from 'vitest';
import type { JSONContent } from '@tiptap/core';
import { documentParser, parseMarkdownDocument } from '../../src/features/editor-md/documentExtensions';
import { parseAuthoring } from '../../src/features/declarative/authoring';
import { writeAuthoring } from '../../src/features/declarative/write';

const paragraph = (text = '内容'): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text }] });
function preserves(content: JSONContent[]) {
  const { schema } = documentParser(), doc = schema.nodeFromJSON({ type: 'doc', content }); doc.check();
  const written = writeAuthoring(doc.toJSON(), schema), parsed = parseAuthoring(written.text);
  expect(parsed.diagnostics.filter(item => item.severity === 'error')).toEqual([]);
  expect(schema.nodeFromJSON(parsed.document).toJSON()).toEqual(doc.toJSON()); return written;
}
function table(rows: Array<Array<Record<string, unknown>>>): JSONContent {
  return { type: 'table', content: rows.map((cells, row) => ({ type: 'tableRow', content: cells.map(attrs => ({ type: row ? 'tableCell' : 'tableHeader', attrs, content: [paragraph()] })) })) };
}
describe('declarative serialization preservation guards', () => {
  it('preserves the null color of standard highlight instead of emitting an invalid bg command', () => {
    const doc = parseMarkdownDocument('==中文=='), written = writeAuthoring(doc.toJSON(), doc.type.schema);
    expect(written.text).not.toContain('\\bg[]'); expect(parseMarkdownDocument(written.text).toJSON()).toEqual(doc.toJSON());
  });
  it('retains nondefault ordered list markers in explicit native content', () => {
    const list = { type: 'orderedList', attrs: { start: 3, type: 'a' }, content: [{ type: 'listItem', content: [paragraph()] }] };
    expect(preserves([list]).text).toContain('native');
  });
  it('retains differing row widths, partial widths, row alignments and merged cell dimensions', () => {
    for (const rows of [
      [[{ colwidth: [80] }], [{ colwidth: [120] }]],
      [[{ colwidth: [80] }, {}], [{ colwidth: [80] }, {}]],
      [[{ align: 'left' }], [{ align: 'right' }]],
      [[{ colspan: 2, colwidth: [80, 90] }]],
    ]) expect(preserves([table(rows)]).text).toContain('native');
    expect(preserves([table([[{ colwidth: [80], align: 'left' }, { colwidth: [90], align: 'right' }], [{ colwidth: [80], align: 'left' }, { colwidth: [90], align: 'right' }]])]).text).toContain('widths=[80,90]');
  });
  it('retains image titles, legacy widths and caption representation', () => {
    const base = { type: 'image', attrs: { src: 'image.png', alt: '图片', title: '' } };
    expect(preserves([base]).text).toContain('native');
    for (const image of [
      { ...base, attrs: { ...base.attrs, width: '320px' } },
      { ...base, attrs: { ...base.attrs, alt: null } },
      { ...base, attrs: { ...base.attrs, caption: '纯文本图注', captionContent: null } },
    ]) expect(preserves([image]).text).toContain('native');
    const slotImage = { ...base, attrs: { ...base.attrs, align: 'right' } };
    expect(preserves([{ type: 'imageCollection', attrs: { columns: 1 }, content: [{ type: 'imageSlot', content: [slotImage] }] }]).text).toContain('native');
  });
  it('retains nondefault link attributes and inline display-math ownership', () => {
    expect(preserves([{ type: 'paragraph', content: [{ type: 'text', text: '链接', marks: [{ type: 'link', attrs: { href: 'https://example.test', target: '_self', rel: 'author' } }] }] }]).text).toContain('native');
    expect(preserves([{ type: 'paragraph', content: [{ type: 'mathInline', attrs: { latex: 'x', delimiter: '$$' } }] }]).text).toContain('native');
  });
  it('retains explicit left alignment and adds explain only once around styled blocks', () => {
    expect(preserves([{ ...paragraph(), attrs: { textAlign: 'left' } }]).text).toContain('::: left');
    const written = preserves([{ ...paragraph(), attrs: { textAlign: 'right', blockBackground: '#eff6ff', annotationId: 'note1' } }, { type: 'annotationStore', content: [{ type: 'annotationBody', attrs: { id: 'note1' }, content: [paragraph('说明')] }] }]);
    expect(written.text.match(/explain ref=note1/g)).toHaveLength(1);
  });
  it('keeps adjacent independent lists separate', () => { preserves([{ type: 'bulletList', content: [{ type: 'listItem', content: [paragraph('一')] }] }, { type: 'bulletList', content: [{ type: 'listItem', content: [paragraph('二')] }] }]); });
  it('selects the authoring codec only for nondefault presentation attributes', () => {
    const { manager, schema } = documentParser();
    const ordinary = schema.nodeFromJSON({ type: 'doc', content: [paragraph()] }).toJSON();
    expect(manager.serialize(ordinary)).not.toContain('native');
    const align = schema.nodeFromJSON({ type: 'doc', content: [{ ...paragraph(), attrs: { textAlign: 'right' } }] }).toJSON();
    expect(manager.serialize(align)).toContain('::: right');
    const indent = schema.nodeFromJSON({ type: 'doc', content: [{ ...paragraph(), attrs: { indent: 2 } }] }).toJSON();
    expect(manager.serialize(indent)).toContain('native');
  });
  it('keeps literal text from becoming block syntax, formulas or HTML entities', () => {
    for (const value of ['# 标题', '- 列表', '1. 顺序', '::: tip', '$x$', '&amp;', '    四个空格', '甲  \n乙', '甲\n\n乙']) preserves([paragraph(value)]);
  });
  it('preserves a final hardBreak and annotation ids that match alignment aliases', () => {
    preserves([{ type: 'paragraph', content: [{ type: 'text', text: 'a' }, { type: 'hardBreak' }] }]);
    for (const id of ['left', 'center', 'right', 'L', 'M', 'R', 'middle', 'centre']) {
      const written = preserves([{ type: 'paragraph', content: [{ type: 'text', text: '引用', marks: [{ type: 'annotationReference', attrs: { id } }] }] }, { type: 'annotationStore', content: [{ type: 'annotationBody', attrs: { id }, content: [paragraph('说明')] }] }]);
      expect(written.text).toContain(`annotation id=${id}`);
      expect(parseAuthoring(`::: annotation ${id}\n说明\n:::`).diagnostics.filter(item => item.severity === 'error')).toEqual([]);
    }
  });
});
