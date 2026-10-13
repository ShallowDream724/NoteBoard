import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { EditorState as SourceState } from '@codemirror/state';
import type { EditorView as SourceView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { bookmarkKey, DocumentBookmarks } from '@/features/bookmarks/extension';
import { toggleBookmark } from '@/features/bookmarks/commands';
import { flushDocumentBookmarks, loadBookmarks, migrateBookmarks, relinquishDocumentBookmarks, resetBookmarkStorage } from '@/features/bookmarks/storage';
import { registerMdSourceView, registerMdTipTapEditor } from '@/features/editor-md/editorInstances';
import { useWindowStore, type Tab } from '@/stores/windowStore';
import { useDocumentStore } from '@/stores/documentStore';
import { captureSourceBookmarks, discardDocumentBookmarks } from '@/features/bookmarks/sourcePersistence';

const key = 'C:/notes/source.md';
const editors: Editor[] = [];
const cleanup: Array<() => void> = [];
function tab(mode: 'source' | 'visual'): Tab {
  return { key, path: key, displayName: 'source.md', kind: 'markdown', language: 'markdown', isDirty: false,
    isPreview: false, viewMode: mode, externalStatus: null, isDetached: false };
}
function create(content = '<p>A</p><p>Tail</p>') {
  const editor = new Editor({ extensions: [StarterKit, Markdown, DocumentBookmarks.configure({ docKey: key })], content });
  editors.push(editor); cleanup.push(registerMdTipTapEditor(key, editor)); return editor;
}
function enterSource(source: string) {
  useWindowStore.setState({ tabs: [tab('source')], activeKey: key });
  // Persistence's CodeMirror boundary consumes immutable real source state;
  // DOM/viewport behavior is covered in the editor and browser suites.
  cleanup.push(registerMdSourceView(key, { state: SourceState.create({ doc: source }) } as unknown as SourceView));
}
beforeEach(() => { localStorage.clear(); resetBookmarkStorage(); useWindowStore.setState({ tabs: [tab('visual')], activeKey: key }); });
afterEach(() => { editors.splice(0).forEach(editor => editor.destroy()); cleanup.splice(0).reverse().forEach(stop => stop()); useWindowStore.setState({ tabs: [], activeKey: null }); useDocumentStore.getState().clear(); resetBookmarkStorage(); });

function sourceOnlyDocument(source: string) {
  const editor = create(); toggleBookmark(editor, 0); editor.destroy();
  useDocumentStore.getState().upsertFromPayload({ key, displayName: 'source.md', dirPath: 'C:/notes', kind: 'markdown', language: 'markdown',
    content: 'A\n\nTail', encoding: 'utf8', eol: 'lf', size: 7, mtime: 0, readonly: false });
  useDocumentStore.getState().setContent(key, source);
  enterSource(source);
}

describe('source authority and window handoff', () => {
  test('explicit discard maps visual text edits back to saved content before late destruction', async () => {
    const editor = create(); toggleBookmark(editor, 0);
    useDocumentStore.getState().upsertFromPayload({ key, displayName: 'source.md', dirPath: 'C:/notes', kind: 'markdown', language: 'markdown',
      content: 'A\n\nTail', encoding: 'utf8', eol: 'lf', size: 7, mtime: 0, readonly: false });
    editor.view.dispatch(editor.state.tr.insertText('B', 1, 2)); flushDocumentBookmarks(key);
    expect(loadBookmarks(key)[0].quote).toBe('B');
    expect(await discardDocumentBookmarks(key)).toBe(true); relinquishDocumentBookmarks(key);
    expect(loadBookmarks(key)[0]).toMatchObject({ quote: 'A', missing: false });
    expect(editor.state.doc.firstChild?.textContent).toBe('B');
    editor.destroy();
    expect(loadBookmarks(key)[0]).toMatchObject({ quote: 'A', missing: false });
  });

  test('explicit discard restores a source-first baseline seed after an earlier capture', async () => {
    sourceOnlyDocument('B\n\nTail');
    expect(await captureSourceBookmarks(key)).toBe(true);
    expect(await discardDocumentBookmarks(key)).toBe(true);
    expect(loadBookmarks(key)[0]).toMatchObject({ quote: 'A', missing: false });
  });

  test('explicit discard parses an NB baseline with its native codec', async () => {
    const editor = create(); toggleBookmark(editor, 0);
    const content = '#!noteboard 1\n@block ' + JSON.stringify({ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }) + '\n@block ' +
      JSON.stringify({ type: 'paragraph', content: [{ type: 'text', text: 'Tail' }] }) + '\n';
    useDocumentStore.getState().upsertFromPayload({ key, displayName: 'source.nb', dirPath: 'C:/notes', kind: 'noteboard', language: 'markdown',
      content, encoding: 'utf8', eol: 'lf', size: content.length, mtime: 0, readonly: false });
    editor.view.dispatch(editor.state.tr.insertText('B', 1, 2)); flushDocumentBookmarks(key);
    expect(await discardDocumentBookmarks(key)).toBe(true); relinquishDocumentBookmarks(key);
    expect(loadBookmarks(key)[0]).toMatchObject({ quote: 'A', missing: false });
  });

  test('explicit discard of an NB tab without a visual owner uses the native grammar', async () => {
    const editor = create(); toggleBookmark(editor, 0);
    const baseline = '#!noteboard 1\n@block ' + JSON.stringify({ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }) + '\n@block ' +
      JSON.stringify({ type: 'paragraph', content: [{ type: 'text', text: 'Tail' }] }) + '\n';
    useDocumentStore.getState().upsertFromPayload({ key, displayName: 'source.nb', dirPath: 'C:/notes', kind: 'noteboard', language: 'markdown',
      content: baseline, encoding: 'utf8', eol: 'lf', size: baseline.length, mtime: 0, readonly: false });
    useDocumentStore.getState().setContent(key, baseline.replace('"text":"A"', '"text":"B"'));
    editor.view.dispatch(editor.state.tr.insertText('B', 1, 2)); editor.destroy();
    expect(loadBookmarks(key)[0].quote).toBe('B');
    expect(await discardDocumentBookmarks(key)).toBe(true);
    expect(loadBookmarks(key)[0]).toMatchObject({ quote: 'A', missing: false });
  });

  test('source-first session lazily maps persisted anchors without creating a visual editor', async () => {
    sourceOnlyDocument('B\n\nTail');
    expect(await captureSourceBookmarks(key)).toBe(true);
    expect(loadBookmarks(key)[0]).toMatchObject({ quote: 'B', missing: false });
  });

  test('repeated source-first barriers use the same baseline seed until a save succeeds', async () => {
    sourceOnlyDocument('B\n\nTail');
    expect(await captureSourceBookmarks(key)).toBe(true);
    expect(await captureSourceBookmarks(key)).toBe(true);
    expect(loadBookmarks(key)[0]).toMatchObject({ quote: 'B', missing: false });
    enterSource('C\n\nTail');
    expect(await captureSourceBookmarks(key)).toBe(true);
    expect(loadBookmarks(key)[0]).toMatchObject({ quote: 'C', missing: false });
    enterSource('A\n\nTail');
    expect(await captureSourceBookmarks(key)).toBe(true);
    expect(loadBookmarks(key)[0]).toMatchObject({ quote: 'A', missing: false });
  });

  test('a source edit during async grammar loading invalidates the capture', async () => {
    sourceOnlyDocument('B\n\nTail');
    const capture = captureSourceBookmarks(key);
    enterSource('C\n\nTail');
    expect(await capture).toBe(false);
    expect(loadBookmarks(key)[0].quote).toBe('A');
  });

  test('close from source mode preserves edited anchor and late hidden visual destruction cannot overwrite it', () => {
    const editor = create(); toggleBookmark(editor, 0);
    enterSource('B\n\nTail');
    flushDocumentBookmarks(key);
    expect(loadBookmarks(key)[0].quote).toBe('B');
    expect(editor.state.doc.firstChild?.textContent).toBe('A');
    useWindowStore.setState({ tabs: [], activeKey: null });
    editor.destroy();
    expect(loadBookmarks(key)[0].quote).toBe('B');
    expect(loadBookmarks(key)[0].missing).toBe(false);
  });

  test('save-as from source mode maps latest source before migrating the exact identity', () => {
    const editor = create(); toggleBookmark(editor, 0);
    enterSource('New prefix\n\nB\n\nTail');
    migrateBookmarks(key, 'C:/notes/saved.md');
    const saved = loadBookmarks('C:/notes/saved.md')[0];
    // Changing both the prefix and old bookmarked paragraph is ambiguous;
    // a deleted anchor may stay missing, but stale A must never be persisted.
    expect(saved.missing || saved.quote === 'B').toBe(true);
    editor.destroy();
    expect(loadBookmarks(key)).toHaveLength(0);
    expect(loadBookmarks('C:/notes/saved.md')).toHaveLength(1);
  });

  test('immediate window transfer flushes before target mount and old owner cannot overwrite target', () => {
    const source = create(); toggleBookmark(source, 0);
    enterSource('B\n\nTail');
    flushDocumentBookmarks(key); relinquishDocumentBookmarks(key);
    useWindowStore.setState({ tabs: [tab('visual')] });
    const target = create('<p>B</p><p>Tail</p>');
    expect(bookmarkKey.getState(target.state)?.[0].quote).toBe('B');
    source.destroy();
    expect(loadBookmarks(key)[0].quote).toBe('B');
    expect(bookmarkKey.getState(target.state)?.[0].missing).toBe(false);
  });
});
