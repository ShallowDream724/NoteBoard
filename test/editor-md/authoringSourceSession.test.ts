import { describe, expect, it, vi } from 'vitest';
import { EditorState, Text } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { documentParser } from '@/features/editor-md/documentExtensions';
import { encodeNativeDocument } from '@/core/nativeDocument';
import { parseNativeNode } from '@/features/editor-md/editorDocumentCodec';
import { serializeAuthoring } from '@/features/declarative/authoring';
import { AuthoringSourceSession, captureAuthoringSelection, authoringToVisual, visualToAuthoring, authoringBookmarkSelection } from '@/features/editor-md/authoringSourceSession';
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
      const visualDoc = parseNativeNode(stored, schema);
      session.transferAuthoredSource(visualDoc);
      expect(serializeAuthoring(visualDoc).text).toBe(authored);
      setSourceNativeMetadata(view, { markdown: { path: 'a.md', baselineHash: 'base', projectionVersion: 1 } });
      expect(view.state.doc.toString()).toBe(authored);
      expect(readSourceDocument(view)).toContain('@meta ');
      replaceSourceDocument(view, stored.replace('"changed"', '"edited"'));
      expect(view.state.doc.toString()).toBe('\\bold{edited}');
      replaceSourceDocument(view, original);
      expect(view.state.doc.toString()).toBe(text);
      expect(readSourceDocument(view)).toBe(original);
    } finally { setSourceDocumentAdapter(view, null); view.destroy(); }
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
});
