import { describe, expect, it } from 'vitest';
import type { NativeNode } from '../../src/core/nativeDocument';
import { linkedTextEdit, mergeLinkedMarkdownTrees } from '../../src/features/document-format/linkedMarkdownUpdatesMerge';

const text = (value: string, color?: string): NativeNode => ({ type: 'text', text: value, ...(color ? { marks: [{ type: 'textColor', attrs: { color } }] } : {}) });
const paragraph = (...content: NativeNode[]): NativeNode => ({ type: 'paragraph', content });
const doc = (...content: NativeNode[]): NativeNode => ({ type: 'doc', content });
const value = (node: NativeNode): string => node.text ?? (node.content ?? []).map(value).join('');

describe('linked Markdown structural merge', () => {
  it('changes a styled span and preserves rich containers and untouched runs', () => {
    const rich = doc({ ...paragraph(text('Hello ', 'red'), text('world', 'blue')), attrs: { textAlign: 'center', indent: 2 } });
    const projected = doc(paragraph(text('Hello world'))), external = doc(paragraph(text('Hello earth')));
    const result = mergeLinkedMarkdownTrees(rich, rich, projected, external);
    expect(result.kind).toBe('merged');
    if (result.kind === 'conflict') return;
    expect(value(result.document)).toBe('Hello earth');
    expect(result.document.content?.[0].attrs).toEqual(rich.content?.[0].attrs);
    expect(result.document.content?.[0].content?.[0]).toBe(rich.content?.[0].content?.[0]);
    expect(result.document.content?.[0].content?.[1].marks).toEqual(rich.content?.[0].content?.[1].marks);
    expect(value(rich)).toBe('Hello world');
  });

  it('merges independent local and external edits in the same block', () => {
    const baseline = doc(paragraph(text('alpha middle omega', 'red')));
    const projection = doc(paragraph(text('alpha middle omega')));
    const local = doc(paragraph(text('ALPHA middle omega', 'red')));
    const external = doc(paragraph(text('alpha middle OMEGA')));
    const result = mergeLinkedMarkdownTrees(baseline, local, projection, external);
    expect(result.kind).toBe('merged');
    if (result.kind !== 'conflict') expect(value(result.document)).toBe('ALPHA middle OMEGA');
  });

  it('reports overlapping local edits without changing the local document', () => {
    const baseline = doc(paragraph(text('hello world'))), local = doc(paragraph(text('hello local'))), remote = doc(paragraph(text('hello remote')));
    const result = mergeLinkedMarkdownTrees(baseline, local, baseline, remote);
    expect(result).toMatchObject({ kind: 'conflict', reason: 'overlap', path: [0] });
    expect(value(local)).toBe('hello local');
  });

  it('reports inserted blocks, changed table topology and ambiguous styles', () => {
    const baseline = doc(paragraph(text('one')));
    expect(mergeLinkedMarkdownTrees(baseline, baseline, baseline, doc(paragraph(text('one')), paragraph(text('two'))))).toMatchObject({ kind: 'conflict', reason: 'structure' });
    const rich = doc(paragraph(text('abc', 'red'), text('def', 'blue'))), projection = doc(paragraph(text('abcdef')));
    expect(mergeLinkedMarkdownTrees(rich, rich, projection, doc(paragraph(text('a NEW f'))))).toMatchObject({ kind: 'conflict', reason: 'ambiguous-style' });
    const table = doc({ type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [paragraph(text('cell'))] }] }] });
    const changed = structuredClone(table); changed.content![0].content![0].content!.push({ type: 'tableCell', content: [paragraph(text('new'))] });
    expect(mergeLinkedMarkdownTrees(table, table, table, changed)).toMatchObject({ kind: 'conflict', reason: 'structure' });
  });

  it('detects moved semantic mark boundaries even when the text is unchanged', () => {
    const baseline = doc(paragraph({ ...text('red'), marks: [{ type: 'bold' }] }, text(' blue')));
    const external = doc(paragraph({ ...text('red b'), marks: [{ type: 'bold' }] }, text('lue')));
    expect(mergeLinkedMarkdownTrees(baseline, baseline, baseline, external)).toMatchObject({ kind: 'conflict', reason: 'structure' });
  });

  it('does not assign a moved paragraph the style of its previous position', () => {
    const rich = doc(paragraph(text('first', 'red')), paragraph(text('second', 'blue')));
    const projection = doc(paragraph(text('first')), paragraph(text('second')));
    const external = doc(paragraph(text('second')), paragraph(text('first')));
    expect(mergeLinkedMarkdownTrees(rich, rich, projection, external)).toMatchObject({ kind: 'conflict', reason: 'structure' });
  });

  it('keeps presentation nodes and aligns repeated paragraphs strictly by position', () => {
    const presentation: NativeNode = { type: 'documentPresentation', attrs: { fontFamily: 'serif' } };
    const rich = doc(presentation, paragraph(text('same', 'red')), paragraph(text('same', 'blue')));
    const projection = doc(paragraph(text('same')), paragraph(text('same')));
    const result = mergeLinkedMarkdownTrees(rich, rich, projection, doc(paragraph(text('same')), paragraph(text('changed'))));
    expect(result.kind).toBe('merged');
    if (result.kind !== 'conflict') {
      expect(result.document.content?.[0]).toBe(presentation);
      expect(result.document.content?.[1]).toBe(rich.content?.[1]);
      expect(result.document.content?.[2].content?.[0].marks).toEqual(rich.content?.[2].content?.[0].marks);
    }
  });

  it('replays sparse accepted changes before a second external update', () => {
    const rich = doc(paragraph(text('Hello world', 'red'))), projection = doc(paragraph(text('Hello world')));
    const first = mergeLinkedMarkdownTrees(rich, rich, projection, doc(paragraph(text('Hello earth'))));
    if (first.kind === 'conflict') throw new Error(first.message);
    const second = mergeLinkedMarkdownTrees(rich, first.document, projection, doc(paragraph(text('Hello planet'))), first.patches);
    expect(second.kind).toBe('merged');
    if (second.kind !== 'conflict') expect(value(second.document)).toBe('Hello planet');
    expect(value(rich)).toBe('Hello world');
  });

  it('never splits surrogate pairs when deriving the local edit', () => {
    expect(linkedTextEdit('a😀z', 'a😄z')).toEqual({ start: 1, end: 3, text: '😄' });
    const rich = doc(paragraph(text('a😀z', 'red'))), projection = doc(paragraph(text('a😀z')));
    const result = mergeLinkedMarkdownTrees(rich, rich, projection, doc(paragraph(text('a😄z'))));
    if (result.kind === 'conflict') throw new Error(result.message);
    expect(value(result.document)).toBe('a😄z');
  });

  it('handles large repeated block sets with one positional traversal', () => {
    const rich = doc(...Array.from({ length: 10000 }, () => paragraph(text('repeated', 'red'))));
    const projected = doc(...Array.from({ length: 10000 }, () => paragraph(text('repeated'))));
    const remote = { ...projected, content: [...projected.content!] }; remote.content![9999] = paragraph(text('updated'));
    const result = mergeLinkedMarkdownTrees(rich, rich, projected, remote);
    if (result.kind === 'conflict') throw new Error(result.message);
    expect(result.changedBlocks).toBe(1);
    expect(result.document.content?.[0]).toBe(rich.content?.[0]);
    expect(result.patches).toHaveLength(1);
  });
});
