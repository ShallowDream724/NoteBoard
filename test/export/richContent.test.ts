import type { JSONContent } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { documentParser } from '../../src/features/editor-md/documentExtensions';
import { portableMarkdown } from '../../src/features/export/portableMarkdown';
import { pandocSource } from '../../src/features/export/pandocDocument';
import { renderDocument } from '../../src/features/export/renderDocument';
import { projectRichContent, richExportDiagnostics } from '../../src/features/export/richProjection';
import { localFileUrl, standaloneHtml } from '../../src/features/export/standaloneHtml';

const paragraph = (text: string): JSONContent => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] });
const image = (src: string): JSONContent => ({ type: 'image', attrs: { src, alt: src } });
const sample = (): JSONContent => ({ type: 'doc', content: [
  { type: 'paragraph', content: [
    { type: 'text', text: '锚点', marks: [{ type: 'annotationReference', attrs: { id: 'note-a' } }] },
    { type: 'text', text: '加粗', marks: [{ type: 'bold' }, { type: 'annotationReference', attrs: { id: 'note-a' } }] },
    { type: 'text', text: '模糊文字', marks: [{ type: 'conceal' }] },
  ] },
  { type: 'imageCollection', attrs: { layout: 'carousel', columns: 3, annotationId: 'note-b' }, content: [
    { type: 'imageSlot', content: [image('one.png'), paragraph('图注一')] },
    { type: 'imageSlot', content: [paragraph('')] },
    { type: 'imageSlot', content: [image('two.png'), paragraph('图注二')] },
    { type: 'imageSlot', content: [paragraph('只有图注')] },
  ] },
  { type: 'disclosure', attrs: { title: '折叠标题', open: false, concealed: true }, content: [paragraph('隐藏正文'), { type: 'mathBlock', attrs: { latex: 'x^2' } }] },
  { type: 'annotationStore', content: [
    { type: 'annotationBody', attrs: { id: 'note-b' }, content: [paragraph('块级说明'), image('note.png')] },
    { type: 'annotationBody', attrs: { id: 'note-a' }, content: [paragraph('行内说明'), { type: 'bulletList', content: [{ type: 'listItem', content: [paragraph('说明列表')] }] }] },
  ] },
] });

describe('rich document export conservation', () => {
  it('exports every image, caption, collapsed body and numbered annotation to clean Markdown', () => {
    const source = sample(), original = structuredClone(source);
    const markdown = portableMarkdown(source);
    for (const text of ['one.png', 'two.png', 'note.png', '图注一', '图注二', '只有图注', '折叠标题', '隐藏正文', '模糊文字', '行内说明', '块级说明', '说明列表']) expect(markdown).toContain(text);
    expect(markdown).not.toMatch(/<details|<section|noteboard-|data-nb-/);
    expect(markdown.match(/one\.png/g)).toHaveLength(2); // URL and authored alt text
    expect(markdown).toContain('\\[1\\]'); expect(markdown).toContain('\\[2\\]');
    expect(markdown.indexOf('行内说明')).toBeLessThan(markdown.indexOf('块级说明'));
    expect(source).toEqual(original);
    const projection = projectRichContent(source, 'portable').document;
    documentParser().schema.nodeFromJSON(projection).check();
    expect(JSON.stringify(projection)).not.toMatch(/imageCollection|imageSlot|annotationReference|concealed|conceal"/);
    // One reference for a single continuous anchor, even when marks split it.
    expect(projection.content![0].content!.filter(node => node.text === '[1]')).toHaveLength(1);
  });

  it('gives Word/LaTeX native image, grid, math and footnote AST without rebuilding the document', () => {
    const doc = documentParser().schema.nodeFromJSON(sample()); doc.check();
    const ast = pandocSource(doc);
    expect(ast.match(/"t":"Image"/g)).toHaveLength(3);
    expect(ast.match(/"t":"Note"/g)).toHaveLength(2);
    const table = JSON.parse(ast).blocks.find((value: { t: string }) => value.t === 'Table');
    expect(table.c[2]).toHaveLength(3);
    expect(table.c[4][0][3]).toHaveLength(2);
    expect(ast).not.toMatch(/RawBlock|RawInline/);
    expect(ast).toContain('DisplayMath');
    for (const text of ['折叠标题', '隐藏正文', '图注一', '图注二', '行内说明', '块级说明', '说明列表']) expect(ast).toContain(text);
  });

  it('prints all slots and details, clears conceal, and appends accessible notes', async () => {
    const doc = documentParser().schema.nodeFromJSON(sample());
    const result = await renderDocument('', 'Test', '', undefined, doc);
    const root = document.createElement('div'); root.innerHTML = result.html;
    expect(root.querySelectorAll('.export-image-slot')).toHaveLength(4);
    expect(root.querySelectorAll('img')).toHaveLength(3);
    expect(root.querySelector('.export-image-carousel')).toBeNull();
    expect(root.querySelector('details')?.hasAttribute('open')).toBe(true);
    expect(root.querySelector('[data-nb-conceal]')).toBeNull();
    expect(root.querySelector('#export-note-1')?.textContent).toContain('行内说明');
    expect(root.querySelector('#export-note-2')?.textContent).toContain('块级说明');
    expect(root.querySelector('a[href="#export-note-2"]')).not.toBeNull();
    expect(richExportDiagnostics(result.richSummary, 'pdf').join(' ')).toContain('完整网格');
    expect(richExportDiagnostics(result.richSummary, 'noteboard')).toEqual([]);
  });

  it('keeps HTML interactive with a readable script-free fallback and a full print projection', async () => {
    const doc = documentParser().schema.nodeFromJSON(sample());
    const result = await renderDocument('', 'Test', '', undefined, doc, undefined, undefined, 'html');
    const root = document.createElement('div'); root.innerHTML = result.html;
    expect(root.querySelector('.export-image-carousel')).not.toBeNull();
    expect(root.querySelectorAll('.export-image-slot')).toHaveLength(4);
    expect(root.querySelectorAll('.export-image-slot[data-empty]')).toHaveLength(1);
    expect(root.querySelector('details')?.hasAttribute('open')).toBe(false);
    expect(root.querySelectorAll('[data-nb-conceal]')).toHaveLength(2);
    expect(root.querySelectorAll('img')).toHaveLength(3);
    const html = standaloneHtml(result.html, '<report>');
    expect(html).toContain('<title>&lt;report&gt;</title>');
    expect(html).toContain("addEventListener('beforeprint'");
    expect(html).toContain('.katex-html{display:none}');
    expect(html).not.toContain('@import');
    expect(localFileUrl('C:\\Notes\\图片 #1.png')).toBe('file:///C:/Notes/%E5%9B%BE%E7%89%87%20%231.png');
  });

  it('keeps image block references inside the slot caption grammar', () => {
    const source = sample();
    source.content![1].content![0].content![0].attrs!.annotationId = 'note-a';
    const projection = projectRichContent(source, 'html').document;
    documentParser().schema.nodeFromJSON(projection).check();
    expect(projection.content![1].content![0].content!.filter(node => node.type === 'paragraph')).toHaveLength(1);
  });

  it('preserves unknown/error blocks as ordinary code and rejects missing annotation bodies', () => {
    const markdown = portableMarkdown({ type: 'doc', content: [
      { type: 'futureWidget', attrs: { caption: '不可丢失' } },
      { type: 'nativeError', attrs: { raw: '@broken\n原始内容', message: '错误' } },
    ] });
    expect(markdown).toContain('```');
    expect(markdown).toContain('futureWidget');
    expect(markdown).toContain('不可丢失');
    expect(markdown).toContain('@broken\n原始内容');
    expect(markdown).not.toMatch(/noteboard-|nativeError|message/);
    expect(() => projectRichContent({ type: 'doc', content: [{ ...paragraph('anchor'), attrs: { annotationId: 'missing' } }] }, 'print')).toThrow('missing 缺少正文');
  });
});
