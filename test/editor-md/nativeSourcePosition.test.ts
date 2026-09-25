import { describe, expect, it, vi } from 'vitest';
import type { Node as DocumentNode } from '@tiptap/pm/model';
import { documentParser } from '@/features/editor-md/documentExtensions';
import { parseNativeNode, serializeNativeNode } from '@/features/editor-md/editorDocumentCodec';
import { encodeNativeDocument, type NativeNode } from '@/core/nativeDocument';
import { mapNativeDocumentSelection } from '@/features/editor-md/nativeSourcePosition';

const paragraph = (text: string): NativeNode => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const parse = (source: string) => parseNativeNode(source, documentParser().schema);
function textPositions(doc: DocumentNode, text: string): number[] {
  const positions: number[] = [];
  doc.descendants((node, pos) => { if (node.isText && node.text === text) positions.push(pos); });
  return positions;
}
function point(doc: DocumentNode, source: string, direction: 'source' | 'visual', anchor: number) {
  return mapNativeDocumentSelection(doc, source, direction, { anchor, head: anchor });
}

describe('native frame cursor correspondence', () => {
  it('maps duplicate text by frame/content path and keeps reversed selections', () => {
    const source = encodeNativeDocument({ type: 'doc', content: [paragraph('same'), paragraph('same'), paragraph('last')] });
    const doc = parse(source), second = textPositions(doc, 'same')[1], last = textPositions(doc, 'last')[0];
    const mapped = mapNativeDocumentSelection(doc, source, 'source', { anchor: last + 3, head: second + 1 });
    expect(mapped).toEqual({ anchor: source.indexOf('last') + 3, head: source.lastIndexOf('same') + 1 });
    expect(mapNativeDocumentSelection(doc, source, 'visual', mapped)).toEqual({ anchor: last + 3, head: second + 1 });
  });

  it('maps every JSON escape boundary, including CRLF records and escaped surrogate pairs', () => {
    const escaped = String.raw`a\n\"\\\u4e2d\uD83D\uDE00z`;
    const source = `#!noteboard 1\r\n@block {"content":[{"text":"${escaped}","type":"text"}],"type":"paragraph"}\r\n`;
    const doc = parse(source), start = source.indexOf(escaped), boundaries = [0, 1, 3, 5, 7, 13, 19, 25, 26];
    boundaries.forEach((offset, index) => {
      expect(point(doc, source, 'source', 1 + index)).toEqual({ anchor: start + offset, head: start + offset });
      expect(point(doc, source, 'visual', start + offset)).toEqual({ anchor: 1 + index, head: 1 + index });
    });
    // A source range cutting through an escape remains inside this text run.
    expect(point(doc, source, 'visual', start + 9).anchor).toBe(6);
  });

  it('preserves authored adjacent text runs when ProseMirror merges their nodes', () => {
    const source = '#!noteboard 1\n@block {"type":"paragraph","content":[{"type":"text","text":"ab"},{"type":"text","text":"cd"}]}\n';
    const doc = parse(source); expect(doc.firstChild!.childCount).toBe(1);
    expect(point(doc, source, 'source', 4).anchor).toBe(source.indexOf('cd') + 1);
    expect(point(doc, source, 'visual', source.indexOf('cd') + 1).anchor).toBe(4);
  });

  it('maps table rows, cells, nested lists and code text through child frames', () => {
    const source = encodeNativeDocument({ type: 'doc', content: [{ type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [
      { type: 'bulletList', content: [{ type: 'listItem', content: [paragraph('nested')] }] },
      { type: 'codeBlock', content: [{ type: 'text', text: 'a\nb' }] },
    ] }] }] }, paragraph('tail')] });
    const doc = parse(source), nested = textPositions(doc, 'nested')[0], code = textPositions(doc, 'a\nb')[0];
    expect(point(doc, source, 'source', nested + 4).anchor).toBe(source.indexOf('nested') + 4);
    expect(point(doc, source, 'source', code + 2).anchor).toBe(source.indexOf('a\\nb') + 3);
    expect(point(doc, source, 'visual', source.indexOf('a\\nb') + 3).anchor).toBe(code + 2);
  });

  it('uses actual canonical visual order for presentation and annotation records', () => {
    const source = encodeNativeDocument({ type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'anchor', marks: [{ type: 'annotationReference', attrs: { id: 'note' } }] }] },
      { type: 'annotationStore', content: [{ type: 'annotationBody', attrs: { id: 'note' }, content: [paragraph('note body')] }] },
    ] });
    const doc = parse(source); expect(doc.firstChild!.type.name).toBe('annotationStore');
    for (const text of ['anchor', 'note body']) {
      const visual = textPositions(doc, text)[0];
      expect(point(doc, source, 'source', visual + 2).anchor).toBe(source.indexOf(text) + 2);
      expect(point(doc, source, 'visual', source.indexOf(text) + 2).anchor).toBe(visual + 2);
    }
  });

  it('maps atoms to their record and malformed blocks without stealing later text', () => {
    const source = '#!noteboard 1\n@block {"type":"image","attrs":{"src":"a.png"}}\n@block {broken\n@block {"type":"paragraph","content":[{"type":"text","text":"after"}]}\n';
    const doc = parse(source);
    expect(point(doc, source, 'visual', source.indexOf('a.png') + 2).anchor).toBe(0);
    expect(point(doc, source, 'visual', source.indexOf('{broken') + 4).anchor).toBe(1);
    const after = textPositions(doc, 'after')[0];
    expect(point(doc, source, 'source', after + 3).anchor).toBe(source.indexOf('after') + 3);
    // Original diagnostic line numbers are stale after inserting an earlier block.
    const changed = doc.copy(doc.content.addToStart(documentParser().schema.nodeFromJSON(paragraph('new'))));
    const changedSource = serializeNativeNode(changed);
    expect(point(changed, changedSource, 'visual', changedSource.indexOf('{broken') + 4).anchor).toBe(6);
  });

  it('keeps a malformed child at its table row and maps an editor-added tail to EOF', () => {
    const source = '#!noteboard 1\n@block {"type":"table"}\n@child {broken-row\n@child {"type":"tableRow","content":[{"type":"tableCell","content":[{"type":"paragraph","content":[{"type":"text","text":"good row"}]}]}]}\n';
    const parsed = parse(source), doc = parsed.copy(parsed.content.addToEnd(documentParser().schema.nodes.paragraph.create()));
    let error = -1; doc.descendants((node, position) => { if (node.type.name === 'nativeError') error = position; });
    expect(point(doc, source, 'visual', source.indexOf('{broken-row') + 3).anchor).toBe(error);
    expect(point(doc, source, 'visual', source.indexOf('good row') + 3).anchor).toBe(textPositions(doc, 'good row')[0] + 3);
    expect(point(doc, source, 'source', doc.content.size - 1).anchor).toBe(source.length);
    expect(point(doc, source, 'visual', source.length).anchor).toBe(doc.content.size - 1);
  });

  it('reuses one immutable index for large-table repeated transfers without JSON/tree serialization', () => {
    const source = encodeNativeDocument({ type: 'doc', content: [{ type: 'table', content: Array.from({ length: 2000 }, (_, index) => ({ type: 'tableRow', content: [{ type: 'tableCell', content: [paragraph(`row-${index}`)] }] })) }] });
    const doc = parse(source), position = textPositions(doc, 'row-1999')[0], json = vi.spyOn(JSON, 'parse'), serialize = vi.spyOn(doc, 'toJSON');
    try {
      const first = point(doc, source, 'source', position + 5), calls = json.mock.calls.length;
      expect(first.anchor).toBe(source.indexOf('row-1999') + 5); expect(calls).toBeGreaterThan(0);
      for (let index = 0; index < 50; index++) expect(point(doc, source, 'visual', first.anchor).anchor).toBe(position + 5);
      expect(json).toHaveBeenCalledTimes(calls); expect(serialize).not.toHaveBeenCalled();
    } finally { json.mockRestore(); serialize.mockRestore(); }
  });
});
