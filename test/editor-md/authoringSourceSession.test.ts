import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EditorState, Text } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { documentParser } from '@/features/editor-md/documentExtensions';
import { encodeNativeDocument, readNativeMetadata } from '@/core/nativeDocument';
import { parseNativeNode, serializeNativeNode } from '@/features/editor-md/editorDocumentCodec';
import { parseAuthoring, inheritAuthoringSource, serializeAuthoring } from '@/features/declarative/authoring';
import { AuthoringSourceSession, captureAuthoringSelection, authoringToVisual, visualToAuthoring, authoringBookmarkSelection, authoringMathSelection } from '@/features/editor-md/authoringSourceSession';
import { readSourceDocument, setSourceDocumentAdapter } from '@/features/editor-md/sourceDocumentAdapter';
import { setSourceNativeMetadata, replaceSourceDocument } from '@/features/editor-md/sourceDocumentSync';
import { stagePendingSourceSnapshot, flushPendingSourceSnapshot, hasPendingSourceSnapshot, discardPendingSourceSnapshot } from '@/features/editor-md/visualSnapshot';

const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
describe('declarative source authority', () => {
  it('defers conversion until the storage barrier and retains failed input for retry', () => {
    const key = 'authoring-pending.nb', text = Text.of(['changed']);
    const materialize = vi.fn(() => { throw new Error('invalid schema'); });
    stagePendingSourceSnapshot(key, { text, materialize, revision: 1, isNewGroup: true });
    expect(materialize).not.toHaveBeenCalled();
    expect(() => flushPendingSourceSnapshot(key)).toThrow('invalid schema');
    expect(hasPendingSourceSnapshot(key)).toBe(true);
    discardPendingSourceSnapshot(key);
  });
  it('keeps original native frames until input, then persists native frames through the shared adapter', () => {
    const schema = documentParser().schema;
    const original = '#!noteboard 1\r\n@block {"content":[{"text":"same","type":"text"}],"type":"paragraph"}\r\n';
    const text = serializeAuthoring(parseNativeNode(original, schema)).text;
    const view = new EditorView({ state: EditorState.create({ doc: text }) });
    try {
      const session = new AuthoringSourceSession(view, schema, '', original);
      session.bind(); setSourceDocumentAdapter(view, session);
      expect(readSourceDocument(view)).toBe(original);
      const authored = '\\bold{changed}';
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: authored } });
      const stored = readSourceDocument(view);
      expect(stored.startsWith('#!noteboard 1\n')).toBe(true);
      expect(parseNativeNode(stored, schema).textContent).toBe('changed');
      const visualDoc = parseNativeNode(stored, schema, '');
      expect(serializeAuthoring(visualDoc).text).toBe(authored);
      setSourceNativeMetadata(view, { markdown: { path: 'a.md', baselineHash: 'base', projectionVersion: 1 } });
      expect(view.state.doc.toString()).toBe(authored);
      expect(readSourceDocument(view)).toContain('@meta ');
      replaceSourceDocument(view, stored.replace('"changed"', '"edited"'));
      expect(view.state.doc.toString()).toBe('\\b{edited}');
      replaceSourceDocument(view, original);
      expect(view.state.doc.toString()).toBe(text);
      expect(readSourceDocument(view)).toBe(original);
    } finally { setSourceDocumentAdapter(view, null); view.destroy(); }
  });

  it('saves semantic-equivalent source edits and restores them from disk in a new session', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'nb-authored-'));
    const path = join(folder, 'notes.nb');
    const schema = documentParser().schema;
    const original = encodeNativeDocument({ type: 'doc', content: [paragraph('正文')] });
    const authored = '<!-- 待整理 -->\n\n\\bold{正文}\n';
    const view = new EditorView({ state: EditorState.create({ doc: '正文' }) });
    let reopened: EditorView | undefined;
    try {
      const session = new AuthoringSourceSession(view, schema, folder, original);
      session.bind();
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: authored } });
      const stored = session.materialize(view.state.doc);
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: authored.replace('待整理', '整理后') } });
      const commentOnly = session.materialize(view.state.doc);
      expect(commentOnly).not.toBe(stored);
      expect(parseNativeNode(commentOnly, schema, folder).eq(parseNativeNode(stored, schema, folder))).toBe(true);
      session.replace(stored);
      expect(view.state.doc.toString()).toBe(authored);
      await writeFile(path, stored);
      view.destroy();

      const onDisk = await readFile(path, 'utf8');
      const parsed = parseNativeNode(onDisk, schema, folder);
      reopened = new EditorView({ state: EditorState.create({ doc: serializeAuthoring(parsed).text }) });
      const restored = new AuthoringSourceSession(reopened, schema, folder, onDisk);
      restored.bind();
      expect(restored.text).toBe(authored);
      expect(restored.materialize(reopened.state.doc)).toBe(onDisk);
      const index = [...Array(parsed.childCount).keys()].find(i => parsed.child(i).textContent === '正文')!;
      const edited = parsed.copy(parsed.content.replaceChild(index, schema.node('paragraph', null, schema.text('新增', [schema.mark('bold')]))));
      inheritAuthoringSource(parsed, edited);
      const visualSave = serializeNativeNode(edited, folder, readNativeMetadata(onDisk));
      const source = serializeAuthoring(parseNativeNode(visualSave, schema, folder)).text;
      expect(source).toBe(authored.replace('正文', '新增'));
    } finally { view.destroy(); reopened?.destroy(); await rm(folder, { recursive: true, force: true }); }
  });

  it('validates relative references in the current directory and ignores unknown authored versions', () => {
    const { schema } = documentParser();
    const original = encodeNativeDocument({ type: 'doc', content: [paragraph('正文')] });
    const source = '正文 [资料](./reading.md)';
    const view = new EditorView({ state: EditorState.create({ doc: '正文' }) });
    try {
      const session = new AuthoringSourceSession(view, schema, 'C:/notebook', original);
      session.bind();
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: source } });
      const stored = session.materialize(view.state.doc);
      expect(serializeAuthoring(parseNativeNode(stored, schema, 'C:/notebook')).text).toBe(source);
      expect(serializeAuthoring(parseNativeNode(stored, schema, 'C:/moved')).text).toContain('C:/notebook/reading.md');
      const future = stored.replace('"version":1,"source"', '"version":7,"source"');
      expect(serializeAuthoring(parseNativeNode(future, schema, 'C:/notebook')).text).toContain('C:/notebook/reading.md');
    } finally { view.destroy(); }
  });

  it('uses paths for repeated text in containers and preserves reversed selections', () => {
    const schema = documentParser().schema;
    const native = encodeNativeDocument({ type: 'doc', content: [paragraph('same'),
      { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableHeader', content: [paragraph('same')] }] }] },
      { type: 'disclosure', attrs: { title: 'detail', open: true }, content: [paragraph('same')] },
      { type: 'codeBlock', content: [{ type: 'text', text: 'same' }] },
    ] });
    const doc = parseNativeNode(native, schema), serialized = serializeAuthoring(doc);
    const points: number[] = []; doc.descendants((node, pos) => { if (node.isText && node.text === 'same') points.push(pos); });
    const visual = { anchor: points[3] + 3, head: points[1] + 1 };
    const source = visualToAuthoring(doc, serialized.spans, visual);
    expect(source.anchor).toBeGreaterThan(source.head);
    const bookmark = captureAuthoringSelection(serialized.spans, source);
    expect(authoringToVisual(doc, bookmark)).toEqual(visual);
    expect(authoringBookmarkSelection(serialized.spans, bookmark)).toEqual(source);
    for (const position of points) {
      const selection = { anchor: position + 2, head: position + 2 };
      expect(authoringToVisual(doc, captureAuthoringSelection(serialized.spans, visualToAuthoring(doc, serialized.spans, selection)))).toEqual(selection);
    }
  });

  it('retains offsets inside escaped payloads and nonvisual parameters by their structural span', () => {
    const spans = [{ path: [0], from: 0, to: 20, contentFrom: 9, contentTo: 15, kind: 'attribute' as const, offsets: [9, 11, 12, 15] }];
    const bookmark = captureAuthoringSelection(spans, { anchor: 11, head: 15 });
    expect(bookmark.anchor.offset).toBe(1); expect(bookmark.head.offset).toBe(3);
    expect(authoringBookmarkSelection(spans, bookmark)).toEqual({ anchor: 11, head: 15 });
  });

  it('restores precise source endpoints between blocks and before an escaped character', () => {
    const source = '正文 \\{字面\\}\n\n后文';
    const parsed = parseAuthoring(source);
    const selection = { anchor: source.indexOf('\n') + 1, head: source.indexOf('\\') };
    const bookmark = captureAuthoringSelection(parsed.spans, selection);
    expect(authoringBookmarkSelection(parsed.spans, bookmark)).toEqual(selection);
  });

  it('opens a formula editor only for selections within one formula payload', () => {
    const source = '正文 $abc$ 后文 $xyz$';
    const parsed = parseAuthoring(source);
    const doc = documentParser().schema.nodeFromJSON(parsed.document);
    const find = (anchor: number, head: number) => authoringMathSelection(doc, captureAuthoringSelection(parsed.spans, { anchor, head }));
    const first = source.indexOf('abc'), second = source.indexOf('xyz');
    expect(find(first + 2, first + 1)).toEqual({ position: 4, anchor: 2, head: 1 });
    expect(find(1, first + 1)).toBeNull();
    expect(find(second + 2, first + 1)).toBeNull();
  });
});
