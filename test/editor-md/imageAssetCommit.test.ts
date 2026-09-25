import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { encodeNativeDocument } from '@/core/nativeDocument';
import { useDocumentStore } from '@/stores/documentStore';
import { useWindowStore } from '@/stores/windowStore';
import { prepareImageSources } from '@/features/editor-md/imageAssetSource';
import { initializeEditorDocument, serializeEditorDocument } from '@/features/editor-md/editorDocumentCodec';
import { commitImageAssetSources } from '@/features/editor-md/imageAssetCommit';
import { ImageSourcesStep } from '@/features/editor-md/imageSourcesStep';

const views = vi.hoisted(() => ({ editor: null as Editor | null, source: null as EditorView | null }));
vi.mock('@/features/editor-md/editorInstances', () => ({ getMdTipTapEditor: () => views.editor, getMdSourceView: () => views.source }));
vi.mock('@/features/history/documentHistory', () => ({ synchronizeCurrentDocumentHistoryContent: vi.fn() }));
vi.mock('@/features/editor-md/visualSnapshot', () => ({ flushPendingSourceSnapshot: vi.fn(), flushPendingVisualSnapshot: vi.fn() }));
const key = 'C:\\notes\\images.nb', old = `C:/recovery/.noteboard-assets/${'a'.repeat(64)}.png`;
const json = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'before' }] }, { type: 'image', attrs: { src: old } }, { type: 'paragraph', content: [{ type: 'text', text: 'after' }] }] };
const captured = encodeNativeDocument(json);
beforeEach(() => {
  useDocumentStore.setState({ documents: new Map() }); useWindowStore.setState({ tabs: [], activeKey: null });
  useDocumentStore.getState().upsertFromPayload({ key, displayName: 'images.nb', dirPath: 'C:\\notes', kind: 'noteboard', language: 'plaintext', content: captured, encoding: 'utf8', eol: 'lf', size: captured.length, mtime: 0, readonly: false });
  useWindowStore.getState().openTab({ key, displayName: 'images.nb', path: key, kind: 'noteboard', language: 'plaintext', isDirty: false, isPreview: false, viewMode: 'visual', externalStatus: null, isDetached: false });
  views.editor = new Editor({ extensions: [StarterKit, Image], content: json });
  initializeEditorDocument(views.editor, captured, 'noteboard');
});
afterEach(() => { views.editor?.destroy(); views.source?.destroy(); views.editor = null; views.source = null; });
it('updates every image in one attribute step without moving selection or reparsing the document', async () => {
  const editor = views.editor!, prepared = await prepareImageSources(captured, 'noteboard', async () => './img/a.png');
  editor.commands.setTextSelection(3);
  const dispatch = vi.spyOn(editor.view, 'dispatch');
  commitImageAssetSources(key, captured, prepared);
  expect(dispatch).toHaveBeenCalledOnce();
  expect(dispatch.mock.calls[0][0].steps).toHaveLength(1);
  expect(dispatch.mock.calls[0][0].steps[0]).toBeInstanceOf(ImageSourcesStep);
  expect(editor.state.selection.from).toBe(3);
  expect(serializeEditorDocument(editor)).toBe(prepared.content);
});
it('source authority updates source and preserves a stale hidden visual tree', async () => {
  useWindowStore.getState().setTabViewMode(key, 'source');
  const editor = views.editor!, before = editor.state.doc;
  views.source = new EditorView({ state: EditorState.create({ doc: captured }) });
  const prepared = await prepareImageSources(captured, 'noteboard', async () => './img/a.png');
  commitImageAssetSources(key, captured, prepared);
  expect(editor.state.doc).toBe(before);
  expect(views.source.state.doc.toString()).toBe(prepared.content);
});
it('keeps input received during save unchanged and dirty instead of installing an old capture', async () => {
  const prepared = await prepareImageSources(captured, 'noteboard', async () => './img/a.png');
  const changed = captured + '@block {"type":"paragraph","content":[{"type":"text","text":"late input"}]}\n';
  useDocumentStore.getState().setContent(key, changed);
  commitImageAssetSources(key, captured, prepared);
  expect(useDocumentStore.getState().getDocument(key)).toMatchObject({ content: changed, isDirty: true });
});
it('does not associate late visual input with stale source even while the store mirror still matches', async () => {
  const prepared = await prepareImageSources(captured, 'noteboard', async () => './img/a.png');
  views.editor!.commands.insertContentAt(2, 'late ');
  const before = serializeEditorDocument(views.editor!);
  expect(useDocumentStore.getState().getDocument(key)?.content).toBe(captured);
  commitImageAssetSources(key, captured, prepared);
  expect(serializeEditorDocument(views.editor!)).toBe(before);
  expect(before).toContain('late ');
});
it('does not replace late CodeMirror input while the source store mirror is stale', async () => {
  useWindowStore.getState().setTabViewMode(key, 'source');
  const prepared = await prepareImageSources(captured, 'noteboard', async () => './img/a.png');
  views.source = new EditorView({ state: EditorState.create({ doc: captured }) });
  views.source.dispatch({ changes: { from: captured.length, insert: '\nlate source input' } });
  const before = views.source.state.doc.toString();
  commitImageAssetSources(key, captured, prepared);
  expect(views.source.state.doc.toString()).toBe(before);
});
it('remaps a large flat image document linearly and provides an exact inverse with no position map', () => {
  const editor = views.editor!, image = editor.schema.nodes.image;
  const doc = editor.schema.nodes.doc.create(null, Array.from({ length: 2000 }, (_, index) => image.create({ src: `old-${index}` })));
  const step = new ImageSourcesStep(Array.from({ length: 2000 }, (_, pos) => ({ pos, src: 'same' })));
  const result = step.apply(doc).doc!;
  expect(result.childCount).toBe(2000); expect(result.lastChild?.attrs.src).toBe('same');
  expect(step.getMap().map(1777)).toBe(1777);
  expect(step.invert(doc).apply(result).doc?.eq(doc)).toBe(true);
});
