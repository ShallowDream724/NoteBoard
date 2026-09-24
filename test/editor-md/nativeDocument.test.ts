import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import { buildDocumentExtensions, documentParser } from '@/features/editor-md/documentExtensions';
import { initializeEditorDocument, serializeEditorDocument, parseEditorDocument, parseNativeNode } from '@/features/editor-md/editorDocumentCodec';
import { encodeNativeDocument, decodeNativeDocument } from '@/core/nativeDocument';
import { portableMarkdown } from '@/features/export/portableMarkdown';
import { kindFromPath, savePolicyOf } from '@/core/docKind';
import { pandocSource } from '@/features/export/pandocDocument';

const editors: Editor[] = [];
const p = (text: string): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const sample: JSONContent = { type: 'doc', content: [
  { type: 'paragraph', attrs: { textAlign: 'center', indent: 1 }, content: [
    { type: 'text', text: '红色正文', marks: [{ type: 'textColor', attrs: { color: '#e53935' } }, { type: 'highlight', attrs: { color: '#ffff00' } }] },
  ] },
  { type: 'table', content: [
    { type: 'tableRow', attrs: { height: 70 }, content: [
      { type: 'tableHeader', attrs: { colspan: 2, background: '#ffe0b2', colwidth: [100, 200], align: 'right' }, content: [p('合并表头')] },
    ] },
    { type: 'tableRow', content: [{ type: 'tableCell', attrs: { colwidth: [100] }, content: [p('甲')] }, { type: 'tableCell', attrs: { colwidth: [200] }, content: [p('乙')] }] },
  ] },
  { type: 'image', attrs: { src: './img/example.png', alt: '示意图', width: '45%' } },
  { type: 'mathBlock', attrs: { latex: 'x^2 + y^2', delimiter: '$$' } },
] };
afterEach(() => { editors.splice(0).forEach(editor => editor.destroy()); vi.restoreAllMocks(); });
function create() {
  const editor = new Editor({ extensions: buildDocumentExtensions(), content: '',
    onBeforeCreate: ({ editor }) => initializeEditorDocument(editor, encodeNativeDocument(sample), 'noteboard', 'C:/notes') });
  editors.push(editor); return editor;
}
describe('Native document storage and portable export', () => {
  it('loads styles directly, preserves an insertion and undo without Markdown conversion', () => {
    const editor = create();
    const parse = vi.spyOn(editor.storage.markdown.manager, 'parse');
    const serialize = vi.spyOn(editor.storage.markdown.manager, 'serialize');
    const before = serializeEditorDocument(editor);
    editor.commands.setTextSelection(3);
    editor.commands.insertContent('新增');
    const saved = serializeEditorDocument(editor), json = decodeNativeDocument(saved);
    expect(JSON.stringify(json)).toContain('红色新增正文');
    expect(json.content?.[0].content?.[0].marks).toEqual(expect.arrayContaining(sample.content![0].content![0].marks!));
    expect(json.content?.[1].content?.[0].content?.[0].attrs?.colspan).toBe(2);
    expect(json.content?.[2].attrs?.src).toBe('C:/notes/img/example.png');
    parseEditorDocument(editor, before, 'history');
    expect(serializeEditorDocument(editor)).toBe(before);
    parseEditorDocument(editor, saved, 'history');
    expect(serializeEditorDocument(editor)).toBe(saved);
    expect(parse).not.toHaveBeenCalled();
    expect(serialize).not.toHaveBeenCalled();
  });
  it('rejects unknown versions, nodes and attributes instead of overwriting with a partial document', () => {
    const { schema } = documentParser();
    expect(() => decodeNativeDocument('{"format":"noteboard","version":2,"document":{"type":"doc"}}')).toThrow();
    expect(() => parseNativeNode(encodeNativeDocument({ type: 'doc', content: [{ type: 'futureWidget' }] }), schema)).toThrow();
    expect(() => parseNativeNode(encodeNativeDocument({ type: 'doc', content: [{ ...p('keep'), attrs: { futureStyle: 'red' } }] }), schema)).toThrow();
    expect(() => parseNativeNode(encodeNativeDocument({ type: 'doc', content: [{ ...p('keep'), futureContent: 'must not vanish' }] }), schema)).toThrow();
    expect(() => parseNativeNode(encodeNativeDocument({ type: 'doc', content: [{ type: 'paragraph', text: 'must not vanish' }] }), schema)).toThrow();
    expect(kindFromPath('note.NBDOC')).toBe('noteboard');
    expect(savePolicyOf('noteboard')).toBe('auto');
  });
  it('exports all content once while removing private presentation metadata', () => {
    const output = portableMarkdown(sample);
    expect(output).not.toContain('noteboard');
    expect(output).not.toContain('<mark');
    expect(output).not.toContain('==红色');
    for (const text of ['红色正文', '合并表头', '甲', '乙', '示意图', 'example.png', 'x^2 + y^2']) expect(output).toContain(text);
    expect(output.match(/合并表头/g)).toHaveLength(1);
    expect(sample.content![0].content![0].marks).toHaveLength(2);
  });
  it('keeps multiline code, lists and formulas in complex cells as standard HTML', () => {
    const complex: JSONContent = { type: 'doc', content: [{ type: 'table', content: [{ type: 'tableRow', content: [
      { type: 'tableCell', content: [p('第一段'), { type: 'codeBlock', content: [{ type: 'text', text: 'a < b\nkeep  spaces' }] },
        { type: 'mathBlock', attrs: { latex: 'x_1' } }, { type: 'mermaidBlock', attrs: { code: 'A-->B' } }] },
    ] }] }] };
    const output = portableMarkdown(complex);
    const host = document.createElement('div'); host.innerHTML = output;
    expect(host.textContent).toContain('a < b\nkeep  spaces');
    expect(host.textContent).toContain('x_1');
    expect(host.textContent).toContain('A-->B');
    expect(output).not.toContain('noteboard');
    const { schema, manager } = documentParser();
    const parse = vi.spyOn(manager, 'parse'), serialize = vi.spyOn(manager, 'serialize');
    const ast = JSON.parse(pandocSource(schema.nodeFromJSON(complex)));
    const values: string[] = [];
    const collect = (value: unknown): void => {
      if (typeof value === 'string') values.push(value);
      else if (Array.isArray(value)) value.forEach(collect);
      else if (value && typeof value === 'object') Object.values(value).forEach(collect);
    };
    collect(ast);
    expect(values).toEqual(expect.arrayContaining(['第一段', 'a < b\nkeep  spaces', 'x_1', 'A-->B']));
    expect(parse).not.toHaveBeenCalled(); expect(serialize).not.toHaveBeenCalled();
  });
});
