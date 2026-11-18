import { expect, it } from 'vitest';
import { inheritAuthoringSource, parseAuthoring, rememberAuthoringSource, serializeAuthoring } from '../../src/features/declarative/authoring';
import { documentParser } from '../../src/features/editor-md/documentExtensions';

function topSpans(source: string) {
  const parsed = parseAuthoring(source);
  return parsed.document.content!.map((node, index) => {
    const span = parsed.spans.find(item => item.kind === 'node' && item.path.length === 1 && item.path[0] === index);
    return { type: node.type, range: span && [span.from, span.to], source: span && source.slice(span.from, span.to) };
  });
}

it('maps original CRLF offsets for a reference use, table and repeated heading', () => {
  const blocks = ['# same', '[a]: /target', '[same][a]', '| same | B |\n| --- | --- |\n| same | 2 |', '# same'];
  const source = blocks.join('\n\n').replaceAll('\n', '\r\n');
  const spans = topSpans(source);
  expect(spans.map(span => span.source)).toEqual([blocks[0], blocks[2], blocks[3].replaceAll('\n', '\r\n'), blocks[4]]);
  expect(spans.at(-1)?.range?.[0]).toBe(source.lastIndexOf('# same'));
  const cell = parseAuthoring(source).spans.find(span => span.kind === 'text' && span.path.join('.') === '2.1.0.0.0')!;
  expect(source.slice(cell.from, cell.to)).toBe('same');
  expect(cell.from).toBe(source.lastIndexOf('| same |') + 2);
});

it('places blank paragraphs at their own insertion points, including the trailing paragraph', () => {
  const source = '\r\n\r\n# A\r\n\r\n\r\n\r\n# A\r\n\r\n';
  const spans = topSpans(source);
  expect(spans.map(span => span.source)).toEqual(['', '# A', '', '# A', '']);
  expect(spans.map(span => span.range?.[0])).toEqual([0, 4, 11, 15, source.length]);
});

it('keeps Markdown after ignored boundaries and multi-block HTML aligned with its own source', () => {
  const source = '<section><p>same</p><blockquote><p>same</p></blockquote></section>\n\n<!-- noteboard-list-boundary -->\n\n# same\n\nsame';
  const spans = topSpans(source);
  expect(spans.slice(0, 2).map(span => span.source)).toEqual([undefined, undefined]);
  expect(spans.slice(-2).map(span => span.range?.[0])).toEqual([source.indexOf('# same'), source.lastIndexOf('same')]);
  const tail = parseAuthoring(source).spans.find(span => span.kind === 'text' && span.path[0] === spans.length - 1);
  expect(tail?.from).toBe(source.lastIndexOf('same'));
});

it('edits a repeated word inside a multi-block HTML token without rewriting the wrapper or attributes', () => {
  const source = '<section data-name="same"><p>same</p>\r\n<blockquote><p>same</p></blockquote></section>\r\n\r\nsame';
  const parsed = parseAuthoring(source), schema = documentParser().schema;
  const before = schema.nodeFromJSON(parsed.document);
  rememberAuthoringSource(before, parsed);
  const json = before.toJSON();
  json.content[1].content[0].content[0].text = 'new';
  const after = schema.nodeFromJSON(json);
  inheritAuthoringSource(before, after);
  expect(serializeAuthoring(after).text).toBe(source.replace('<blockquote><p>same', '<blockquote><p>new'));
});

it('locates a declaration after an identical literal code example', () => {
  const raw = '\\color[red]{same}', source = '`' + raw + '` ' + raw;
  const parsed = parseAuthoring(source);
  const styled = parsed.spans.find(span => span.kind === 'node' && span.path.join('.') === '0.2');
  expect(styled?.from).toBe(source.lastIndexOf(raw));
});

it('withholds a shared declaration range from its individual output paragraphs', () => {
  const source = '::: center\nsame\n\nsame\n:::\n\nsame';
  const spans = topSpans(source);
  expect(spans.map(span => span.source)).toEqual([undefined, undefined, 'same']);
  expect(spans.at(-1)?.range?.[0]).toBe(source.lastIndexOf('same'));
});

it('maps a paragraph longer than the JavaScript argument limit', () => {
  const source = 'abc'.repeat(51_000);
  const parsed = parseAuthoring(source);
  const span = parsed.spans.find(item => item.kind === 'text');
  expect(span?.offsets).toHaveLength(source.length + 1);
  expect(span?.to).toBe(source.length);
});
