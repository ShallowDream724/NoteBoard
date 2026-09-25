import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import { buildDocumentExtensions, documentParser } from '@/features/editor-md/documentExtensions';
import { initializeEditorDocument, serializeEditorDocument, parseEditorDocument, parseNativeNode, serializeNativeNode, setEditorNativeMetadata, getEditorNativeMetadata } from '@/features/editor-md/editorDocumentCodec';
import { encodeNativeDocument, decodeNativeDocument, decodeNativeFile, readNativeMetadata, replaceNativeMetadata } from '@/core/nativeDocument';
import { normalizeImageReferenceText } from '@/features/editor-md/imageReferences';
import { portableMarkdown } from '@/features/export/portableMarkdown';
import { kindFromPath, savePolicyOf } from '@/core/docKind';
import { pandocSource } from '@/features/export/pandocDocument';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { history, undoDepth } from '@codemirror/commands';
import { setSourceNativeMetadata } from '@/features/editor-md/sourceDocumentSync';

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
  it('preserves unknown versions, nodes and attributes as local raw error blocks', () => {
    const { schema } = documentParser();
    expect(decodeNativeDocument('{"format":"noteboard","version":2,"document":{"type":"doc"}}').content![0].type).toBe('nativeError');
    for (const bad of [{ type: 'futureWidget' }, { ...p('keep'), attrs: { futureStyle: 'red' } }, { ...p('keep'), futureContent: 'must not vanish' }, { type: 'paragraph', text: 'must not vanish' }]) {
      const source = encodeNativeDocument({ type: 'doc', content: [p('before'), bad, p('after')] });
      const doc = parseNativeNode(source, schema);
      expect(doc.child(1).type.name).toBe('nativeError');
      expect(doc.lastChild!.textContent).toBe('after');
      expect(serializeNativeNode(doc)).toBe(source);
      expect(String(doc.child(1).attrs.raw)).toContain(JSON.stringify(bad));
    }
    expect(kindFromPath('note.NBDOC')).toBe('noteboard');
    expect(savePolicyOf('noteboard')).toBe('auto');
  });
  it('recovers bad middle records and table rows without losing their raw text on visual edits', () => {
    const source = '#!noteboard 1\n@block {"type":"paragraph","content":[{"type":"text","text":"before"}]}\n@block {broken\n@block {"type":"table"}\n@child {broken-row\n@child {"type":"tableRow","content":[{"type":"tableCell","content":[{"type":"paragraph","content":[{"type":"text","text":"good row"}]}]}]}\n@block {"type":"paragraph","content":[{"type":"text","text":"after"}]}\n';
    const decoded = decodeNativeFile(source);
    expect(decoded.diagnostics).toHaveLength(2);
    const editor = create(); parseEditorDocument(editor, source);
    expect(editor.getText()).toContain('good row'); expect(editor.getText()).toContain('after');
    editor.view.dispatch(editor.state.tr.insertText('new ', 1));
    const saved = serializeEditorDocument(editor);
    expect(saved).toContain('@block {broken\n'); expect(saved).toContain('@child {broken-row\n');
    expect(decodeNativeFile(saved).diagnostics).toHaveLength(2);
  });
  it('frames a large table by row and reuses unchanged immutable row serialization', () => {
    const table = { type: 'table', content: Array.from({ length: 10000 }, (_, index) => ({ type: 'tableRow', content: [{ type: 'tableCell', content: [p(String(index))] }] })) };
    const source = encodeNativeDocument({ type: 'doc', content: [table] });
    expect(source.match(/^@child /gm)).toHaveLength(10000);
    expect(source.split('\n')[1]).toBe('@block {"type":"table"}');
    const { schema } = documentParser(), doc = schema.nodeFromJSON({ type: 'doc', content: [table] });
    const toJSON = vi.spyOn(doc, 'toJSON');
    expect(serializeNativeNode(doc)).toContain('9999'); expect(toJSON).not.toHaveBeenCalled();
  });
  it('reads and replaces metadata without parsing or changing body records and invalidates cached headers', () => {
    const metadata = { markdown: { path: './note.md', baselineHash: 'abc', projectionVersion: 1 }, future: { flag: true } };
    const source = encodeNativeDocument(sample, metadata), body = '@block {broken\n';
    expect(readNativeMetadata(source)).toEqual(metadata);
    expect(readNativeMetadata(replaceNativeMetadata('#!noteboard 1\n' + body, metadata))).toEqual(metadata);
    expect(replaceNativeMetadata('#!noteboard 1\n' + body, metadata).endsWith(body)).toBe(true);
    const editor = create(); parseEditorDocument(editor, source);
    expect(getEditorNativeMetadata(editor)).toEqual(metadata);
    const updated = { ...metadata, markdown: { ...metadata.markdown, baselineHash: 'def' } };
    setEditorNativeMetadata(editor, updated);
    expect(readNativeMetadata(serializeEditorDocument(editor))).toEqual(updated);
    expect(decodeNativeFile(serializeEditorDocument(editor)).document).toEqual(decodeNativeFile(source).document);
  });
  it('decodes escaped native image references and retains images for broken records', () => {
    const source = '#!noteboard 1\n@block {"type":"image","attrs":{"src":"img/\\u0070icture.png"}}\n';
    expect(normalizeImageReferenceText(source, true)).toContain('picture.png');
    expect(normalizeImageReferenceText(source + '@block {bad\n', true)).toBeNull();
  });
  it('updates live source metadata while preserving body, selection and undo state', () => {
    const body = '@block {broken\n@block {"type":"paragraph","content":[{"type":"text","text":"selected"}]}\n';
    const source = '#!noteboard 1\n' + body, anchor = source.indexOf('selected');
    const view = new EditorView({ state: EditorState.create({ doc: source, selection: { anchor, head: anchor + 8 }, extensions: [history()] }) });
    try {
      setSourceNativeMetadata(view, { markdown: { path: './note.md', baselineHash: 'new', projectionVersion: 1 } });
      expect(view.state.doc.toString().endsWith(body)).toBe(true);
      expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe('selected');
      expect(undoDepth(view.state)).toBe(0);
    } finally { view.destroy(); }
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
