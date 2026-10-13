import type { Editor } from '@tiptap/core';
import { getMarkdownManager, withEditableTail } from '../editor-md/serialize';
import { captureBookmarkContexts, mapBookmarks, type DocumentBookmark } from './model';
import { recoverBookmarks } from './model';
import { hasBookmarkPersistence, loadBookmarks, saveBookmarks, reportBookmarkStorageError } from './storage';
import { useWindowStore } from '../../stores/windowStore';
import { useDocumentStore } from '../../stores/documentStore';
import { getMdSourceView, getMdTipTapEditor } from '../editor-md/editorInstances';
import { getDocumentRevision } from '../../core/editor/editorRegistry';
import { getSessionGeneration } from '../session/documentSession';

// A failed save or transfer can repeat its barrier before the disk baseline
// advances. Retain only the small baseline anchor seed, never source text/docs.
const sourceSeeds = new Map<string, { generation: number; baseline: string; persisted: string; records: readonly DocumentBookmark[] }>();
function fingerprint(value: string): string {
  let first = 2166136261, second = 5381;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 16777619); second = Math.imul(second, 33) ^ code;
  }
  return `${value.length}:${first >>> 0}:${second >>> 0}`;
}
useWindowStore.subscribe((state, previous) => {
  if (state.tabs === previous.tabs) return;
  const sourceKeys = new Set(state.tabs.filter(tab => tab.viewMode === 'source').map(tab => tab.key));
  for (const key of sourceSeeds.keys()) if (!sourceKeys.has(key)) sourceSeeds.delete(key);
});

/** Explicit save/close/identity barrier only. The hidden visual root must not
 * be serialized as source authority, nor parsed on each CodeMirror keystroke. */
export function sourceBookmarkSnapshot(editor: Editor, source: string, records: readonly DocumentBookmark[]): readonly DocumentBookmark[] {
  if (!records.length) return records;
  const parsed = getMarkdownManager(editor)?.parse?.(source);
  if (!parsed) throw new Error('无法解析最新源码中的书签位置');
  const doc = withEditableTail(editor, editor.schema.nodeFromJSON(parsed));
  const tr = editor.state.tr.replaceWith(0, editor.state.doc.content.size, doc.content).setMeta('noteboard-document-replacement', 'sync');
  return captureBookmarkContexts(doc, mapBookmarks(tr, records));
}

/** Source-first sessions have no visual view/persistence owner. Load grammar only
 * at an explicit barrier with stored bookmarks, and discard a stale async capture. */
export async function captureSourceBookmarks(docKey: string, currentSource?: string): Promise<boolean> {
  if (hasBookmarkPersistence(docKey) || useWindowStore.getState().getTab(docKey)?.viewMode !== 'source') return true;
  const records = loadBookmarks(docKey);
  if (!records.length) { sourceSeeds.delete(docKey); return true; }
  const document = useDocumentStore.getState().getDocument(docKey);
  const source = currentSource ?? getMdSourceView(docKey)?.state.doc.toString() ?? document?.content;
  const baseline = document?.baselineContent ?? document?.persistedContent;
  if (source == null || baseline == null) return true;
  const generation = getSessionGeneration(docKey), revision = getDocumentRevision(docKey);
  const baselineFingerprint = fingerprint(baseline), persistedFingerprint = fingerprint(JSON.stringify(records));
  const seed = sourceSeeds.get(docKey);
  const input = seed?.generation === generation && seed.baseline === baselineFingerprint && seed.persisted === persistedFingerprint ? seed.records : records;
  if (source === baseline) {
    const saved = input === records || saveBookmarks(docKey, input);
    if (saved) sourceSeeds.delete(docKey); return saved;
  }
  const isCurrent = () => getSessionGeneration(docKey) === generation && getDocumentRevision(docKey) === revision &&
    !hasBookmarkPersistence(docKey) && useWindowStore.getState().getTab(docKey)?.viewMode === 'source' &&
    (getMdSourceView(docKey)?.state.doc.toString() ?? useDocumentStore.getState().getDocument(docKey)?.content) === source &&
    useDocumentStore.getState().getDocument(docKey)?.baselineContent === document?.baselineContent;
  try {
    const [{ parseMarkdownDocument }, { EditorState }] = await Promise.all([
      import('../editor-md/documentExtensions'), import('@tiptap/pm/state'),
    ]);
    if (!isCurrent()) return false;
    const before = parseMarkdownDocument(baseline), after = parseMarkdownDocument(source);
    const restored = recoverBookmarks(before, input);
    const transaction = EditorState.create({ doc: before }).tr.replaceWith(0, before.content.size, after.content)
      .setMeta('noteboard-document-replacement', 'sync');
    const snapshot = captureBookmarkContexts(after, mapBookmarks(transaction, restored));
    if (!isCurrent()) return false;
    const saved = saveBookmarks(docKey, snapshot);
    sourceSeeds.set(docKey, { generation, baseline: baselineFingerprint, persisted: fingerprint(JSON.stringify(snapshot)), records: input });
    return saved;
  } catch {
    if (isCurrent()) reportBookmarkStorageError('源码书签未能同步到本机；已有书签副本已保留。');
    return false;
  }
}

/** User explicitly discards content: persist anchors against the existing disk
 * baseline without changing the live document or normal save/close behavior. */
export async function discardDocumentBookmarks(docKey: string): Promise<boolean> {
  const document = useDocumentStore.getState().getDocument(docKey);
  const baseline = document?.baselineContent ?? document?.persistedContent;
  if (baseline == null) return true;
  const registered = getMdTipTapEditor(docKey), editor = registered && !registered.isDestroyed ? registered : undefined;
  const records = editor ? (await import('./extension')).bookmarkKey.getState(editor.state) ?? [] : loadBookmarks(docKey);
  if (!records.length) return true;
  const generation = getSessionGeneration(docKey), revision = getDocumentRevision(docKey);
  const ownerDoc = editor?.state.doc;
  const isCurrent = () => getSessionGeneration(docKey) === generation && getDocumentRevision(docKey) === revision &&
    useDocumentStore.getState().getDocument(docKey)?.baselineContent === document?.baselineContent &&
    (editor ? !editor.isDestroyed && editor.state.doc === ownerDoc : !hasBookmarkPersistence(docKey));
  try {
    let snapshot: readonly DocumentBookmark[];
    if (editor) {
      if (document?.kind === 'noteboard') {
        const { parseNativeNode } = await import('../editor-md/editorDocumentCodec');
        if (!isCurrent()) return false;
        const target = withEditableTail(editor, parseNativeNode(baseline, editor.schema));
        const tr = editor.state.tr.replaceWith(0, editor.state.doc.content.size, target.content).setMeta('noteboard-document-replacement', 'sync');
        snapshot = captureBookmarkContexts(target, mapBookmarks(tr, records));
      } else snapshot = sourceBookmarkSnapshot(editor, baseline, records);
    } else {
      const [{ parseMarkdownDocument, documentParser }, { EditorState }] = await Promise.all([
        import('../editor-md/documentExtensions'), import('@tiptap/pm/state'),
      ]);
      if (!isCurrent()) return false;
      let parse = parseMarkdownDocument;
      if (document?.kind === 'noteboard') {
        const { parseNativeNode } = await import('../editor-md/editorDocumentCodec');
        if (!isCurrent()) return false;
        const schema = documentParser().schema;
        parse = source => parseNativeNode(source, schema);
      }
      const target = parse(baseline);
      const seed = sourceSeeds.get(docKey);
      if (seed?.generation === generation && seed.baseline === fingerprint(baseline)) {
        snapshot = captureBookmarkContexts(target, recoverBookmarks(target, seed.records));
      } else {
        const source = getMdSourceView(docKey)?.state.doc.toString() ?? document?.content ?? baseline;
        const before = parse(source), restored = recoverBookmarks(before, records);
        const tr = EditorState.create({ doc: before }).tr.replaceWith(0, before.content.size, target.content).setMeta('noteboard-document-replacement', 'sync');
        const mapped = mapBookmarks(tr, restored), disk = recoverBookmarks(target, records);
        snapshot = captureBookmarkContexts(target, mapped.map((record, index) => !disk[index].missing ? disk[index] : record));
      }
    }
    if (!isCurrent()) return false;
    const saved = saveBookmarks(docKey, snapshot);
    if (saved) sourceSeeds.delete(docKey);
    return saved;
  } catch {
    if (isCurrent()) reportBookmarkStorageError('书签未能恢复到已保存内容；已有书签副本已保留。');
    return false;
  }
}
