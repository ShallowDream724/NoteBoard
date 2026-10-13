import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table';
import { TextSelection } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { bookmarkKey, DocumentBookmarks } from '@/features/bookmarks/extension';
import { hasBookmarkAt, removeBookmark, toggleBookmark } from '@/features/bookmarks/commands';
import { captureBookmarkContexts, recoverBookmarks } from '@/features/bookmarks/model';
import { loadBookmarks, migrateBookmarks, resetBookmarkStorage, saveBookmarks, getBookmarkStorageError, registerBookmarkPersistence, setOpenBookmarkDocuments, flushDocumentBookmarks, hasBookmarkWriteFailure } from '@/features/bookmarks/storage';
import { navigateBookmark } from '@/features/bookmarks/navigation';

const editors: Editor[] = [];
function editor(content: string, docKey = 'C:/notes/first.md') {
  const result = new Editor({ extensions: [StarterKit, Table, TableRow, TableCell, TableHeader, DocumentBookmarks.configure({ docKey })], content });
  editors.push(result); return result;
}
function records(target: Editor) { return bookmarkKey.getState(target.state)!; }
function atText(target: Editor, text: string) {
  let found = -1;
  target.state.doc.descendants((node, pos) => { if (node.isTextblock && node.textContent === text) found = pos; });
  return found;
}
beforeEach(() => { localStorage.clear(); resetBookmarkStorage(); });
afterEach(() => { editors.splice(0).forEach(target => target.destroy()); resetBookmarkStorage(); vi.restoreAllMocks(); });

describe('document-local bookmarks', () => {
  test('adds local metadata without altering document, undo depth or source identity', () => {
    const target = editor('<p>First sentence. Second sentence.</p>');
    const before = target.state.doc;
    target.commands.setTextSelection({ from: 17, to: 32 });
    expect(toggleBookmark(target)).toBe(true);
    expect(records(target)).toHaveLength(1);
    expect(records(target)[0].label).toBe('Second sentence');
    expect(target.state.doc).toBe(before);
    expect(target.can().undo()).toBe(false);
    expect(hasBookmarkAt(target)).toBe(true);
    removeBookmark(target, records(target)[0].id);
    expect(records(target)).toHaveLength(0);
    expect(target.state.doc).toBe(before);
  });

  test('caret in list item or table cell targets its actual paragraph', () => {
    const target = editor('<ul><li><p>First item</p></li><li><p>Last item</p></li></ul><table><tbody><tr><td><p>Cell</p></td></tr></tbody></table>');
    const itemPos = atText(target, 'Last item'), cellPos = atText(target, 'Cell');
    target.commands.setTextSelection(itemPos + 4);
    toggleBookmark(target);
    expect(records(target)[0].pos).toBe(itemPos);
    expect(records(target)[0].nodeType).toBe('paragraph');
    target.commands.setTextSelection(cellPos + 2);
    toggleBookmark(target);
    expect(records(target)[1].pos).toBe(cellPos);
    // Explicit block boundaries may deliberately bookmark the list container.
    toggleBookmark(target, 0);
    expect(records(target)[2].nodeType).toBe('bulletList');
  });

  test('maps anchors across prefix edits and changes target text without changing its label', () => {
    const target = editor('<p>Prefix</p><p>Target</p>');
    const position = atText(target, 'Target');
    toggleBookmark(target, position);
    target.commands.insertContentAt(2, ' added');
    expect(records(target)[0].pos).toBe(position + 6);
    target.commands.insertContentAt(records(target)[0].pos + 3, 'changed ');
    expect(records(target)[0].quote).toBe('Tachanged rget');
    expect(records(target)[0].label).toBe('Target');
    expect(records(target)[0].missing).toBe(false);
  });

  test('deleting one of repeated paragraphs stays missing; undo restores exact original anchor', () => {
    const target = editor('<p>Repeated</p><p>Repeated</p><p>End</p>');
    toggleBookmark(target, 0);
    const size = target.state.doc.firstChild!.nodeSize;
    target.view.dispatch(target.state.tr.delete(0, size));
    expect(records(target)[0].missing).toBe(true);
    expect(target.commands.undo()).toBe(true);
    expect(records(target)[0].missing).toBe(false);
    expect(records(target)[0].pos).toBe(0);
    target.commands.redo();
    expect(records(target)[0].missing).toBe(true);
  });

  test('ordinary typing never rescans unresolved anchors; ambiguous reopen is missing', () => {
    const target = editor('<p>Repeated</p><p>Repeated</p><p>End</p>');
    toggleBookmark(target, 0);
    const saved = records(target);
    expect(recoverBookmarks(target.state.doc, saved)[0].missing).toBe(true);
    target.view.dispatch(target.state.tr.delete(0, target.state.doc.firstChild!.nodeSize));
    const descendants = vi.spyOn(target.state.doc, 'descendants');
    target.view.dispatch(target.state.tr.insertText('x', 2));
    expect(descendants).not.toHaveBeenCalled();
    expect(records(target)[0].missing).toBe(true);
    saveBookmarks('C:/notes/first.md', records(target));
    const reopened = editor('<p>Repeated</p><p>End</p>');
    expect(records(reopened)[0].missing).toBe(true);
  });

  test('undoing unrelated text does not restore a deleted repeated bookmark', () => {
    const target = editor('<p>dup</p><p>dup</p><p>tail</p>');
    toggleBookmark(target, 0);
    target.view.dispatch(closeHistory(target.state.tr.delete(0, 5)));
    expect(records(target)[0].missing).toBe(true);
    target.view.dispatch(closeHistory(target.state.tr.insertText('!', target.state.doc.content.size - 1)));
    target.commands.undo();
    expect(records(target)[0].missing).toBe(true);
    target.commands.undo();
    expect(records(target)[0].missing).toBe(false);
    expect(records(target)[0].pos).toBe(0);
  });

  test('reopens unique target after edits and keeps documents isolated', () => {
    const first = editor('<p>Prefix</p><p>Target</p>');
    toggleBookmark(first, atText(first, 'Target'));
    saveBookmarks('C:/notes/first.md', records(first));
    const reopened = editor('<p>New</p><p>Prefix</p><p>Target</p>');
    expect(records(reopened)[0].pos).toBe(atText(reopened, 'Target'));
    expect(records(editor('<p>Target</p>', 'C:/notes/second.md'))).toHaveLength(0);
  });

  test('bounded surrounding context restores repeated text only when its location is unique', () => {
    const first = editor('<p>First chapter</p><p>Repeated</p><p>Second chapter</p><p>Repeated</p><p>End</p>');
    const secondOccurrence = atText(first, 'Repeated');
    toggleBookmark(first, secondOccurrence);
    saveBookmarks('C:/notes/first.md', captureBookmarkContexts(first.state.doc, records(first)));
    const reopened = editor('<p>First chapter</p><p>Repeated</p><p>Second chapter</p><p>Repeated</p><p>End</p>');
    expect(records(reopened)[0].missing).toBe(false);
    expect(records(reopened)[0].pos).toBe(secondOccurrence);
  });

  test('source-mode root synchronization maps the actual text edit instead of losing anchors', () => {
    const target = editor('<p>Prefix</p><p>Target</p>');
    toggleBookmark(target, atText(target, 'Target'));
    const changed = target.schema.nodeFromJSON({ type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Prefix' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Target changed' }] },
    ] });
    target.view.dispatch(target.state.tr.replaceWith(0, target.state.doc.content.size, changed.content).setMeta('noteboard-document-replacement', 'sync'));
    expect(records(target)[0].missing).toBe(false);
    expect(records(target)[0].pos).toBe(atText(target, 'Target changed'));
    expect(records(target)[0].quote).toBe('Target changed');
  });

  test('save-as/rename flushes and migrates exact identity, old editor destruction cannot resurrect it', () => {
    const source = editor('<p>Target</p>', 'untitled:document-1');
    toggleBookmark(source, 0);
    migrateBookmarks('untitled:document-1', 'C:/notes/saved.md');
    expect(loadBookmarks('C:/notes/saved.md')).toHaveLength(1);
    expect(loadBookmarks('untitled:document-1')).toHaveLength(0);
    source.destroy();
    expect(loadBookmarks('untitled:document-1')).toHaveLength(0);
    expect(loadBookmarks('C:/notes/saved.md')).toHaveLength(1);
  });

  test('storage quota failure retains session anchors and reports failure', () => {
    const target = editor('<p>Target</p>'); toggleBookmark(target, 0);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('quota'); });
    saveBookmarks('C:/notes/first.md', records(target));
    expect(loadBookmarks('C:/notes/first.md')).toHaveLength(1);
    expect(getBookmarkStorageError()).toContain('未能保存');
  });

  test('failed identity migration retains unsaved memory anchors and its failure until retry', () => {
    const target = editor('<p>Target</p>'); toggleBookmark(target, 0);
    saveBookmarks('C:/notes/first.md', records(target));
    target.commands.insertContentAt(2, ' changed');
    const failure = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('quota'); });
    migrateBookmarks('C:/notes/first.md', 'C:/notes/saved.md');
    expect(loadBookmarks('C:/notes/first.md')[0].quote).toBe(records(target)[0].quote);
    expect(getBookmarkStorageError()).toContain('未能保存');
    failure.mockRestore();
    migrateBookmarks('C:/notes/first.md', 'C:/notes/saved.md');
    expect(loadBookmarks('C:/notes/saved.md')[0].quote).toBe(records(target)[0].quote);
    expect(loadBookmarks('C:/notes/first.md')).toHaveLength(0);
    expect(getBookmarkStorageError()).toBeNull();
  });

  test('source-only failed writes and last-bookmark deletion retry after quota recovers', () => {
    const target = editor('<p>Target</p>'); toggleBookmark(target, 0);
    const sourceOnly = 'C:/notes/source-only.md';
    const failure = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('quota'); });
    expect(saveBookmarks(sourceOnly, records(target))).toBe(false);
    expect(hasBookmarkWriteFailure(sourceOnly)).toBe(true);
    failure.mockRestore();
    expect(flushDocumentBookmarks(sourceOnly)).toBe(true);
    expect(loadBookmarks(sourceOnly)).toHaveLength(1);
    const removal = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new DOMException('quota'); });
    expect(saveBookmarks(sourceOnly, [])).toBe(false);
    expect(loadBookmarks(sourceOnly)).toHaveLength(0);
    removal.mockRestore();
    expect(flushDocumentBookmarks(sourceOnly)).toBe(true);
    expect(hasBookmarkWriteFailure(sourceOnly)).toBe(false);
    expect(localStorage.getItem('noteboard.document-bookmarks.v2:' + encodeURIComponent(sourceOnly))).toBeNull();
  });

  test('successful destination flush releases failed memory of the committed old identity', () => {
    const target = editor('<p>Target</p>'); toggleBookmark(target, 0);
    saveBookmarks('C:/notes/first.md', records(target));
    target.commands.insertContentAt(2, ' changed');
    const failure = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('quota'); });
    migrateBookmarks('C:/notes/first.md', 'C:/notes/saved.md');
    expect(hasBookmarkWriteFailure('C:/notes/first.md')).toBe(true);
    failure.mockRestore();
    expect(flushDocumentBookmarks('C:/notes/saved.md')).toBe(true);
    expect(hasBookmarkWriteFailure('C:/notes/first.md')).toBe(false);
    expect(loadBookmarks('C:/notes/saved.md')[0].quote).toBe(records(target)[0].quote);
    expect(getBookmarkStorageError()).toBeNull();
  });

  test('late destination recovery cannot release newer source-first bookmarks at a reopened path', () => {
    const source = 'C:/notes/first.md', destination = 'C:/notes/saved.md';
    const target = editor('<p>Target</p>'); toggleBookmark(target, 0);
    saveBookmarks(source, records(target));
    target.commands.insertContentAt(2, ' changed');
    const failure = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('quota'); });
    migrateBookmarks(source, destination);
    const fresh = { ...records(target)[0], id: 'new-session', quote: 'Fresh', label: 'Fresh' };
    target.destroy();
    // Reopening the original path in source-first mode creates no plugin owner.
    expect(saveBookmarks(source, [fresh])).toBe(false);
    failure.mockRestore();
    expect(flushDocumentBookmarks(destination)).toBe(true);
    expect(loadBookmarks(source)).toEqual([fresh]);
    expect(hasBookmarkWriteFailure(source)).toBe(true);
    expect(getBookmarkStorageError()).not.toBeNull();
    expect(flushDocumentBookmarks(source)).toBe(true);
    expect(loadBookmarks(source)).toEqual([fresh]);
    expect(hasBookmarkWriteFailure(source)).toBe(false);
  });

  test('metadata writes preserve unrelated identities updated by another window', () => {
    const target = editor('<p>Target</p>'); toggleBookmark(target, 0);
    saveBookmarks('C:/notes/first.md', records(target));
    const foreign = { updatedAt: Date.now(), records: [{ ...records(target)[0], id: 'foreign' }] };
    localStorage.setItem('noteboard.document-bookmarks.v2:' + encodeURIComponent('C:/notes/foreign.md'), JSON.stringify(foreign));
    saveBookmarks('C:/notes/first.md', records(target));
    expect(loadBookmarks('C:/notes/foreign.md')[0].id).toBe('foreign');
  });

  test('interleaved writes from two windows cannot lose different document metadata', () => {
    const target = editor('<p>Target</p>'); toggleBookmark(target, 0);
    const setItem = Storage.prototype.setItem;
    let interleaved = false;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function(this: Storage, key, value) {
      if (!interleaved && key === 'noteboard.document-bookmarks.v2:' + encodeURIComponent('C:/notes/first.md')) {
        interleaved = true;
        // Another window writes between this window preparing and committing
        // its own entry. Separate document keys eliminate the old root race.
        setItem.call(this, 'noteboard.document-bookmarks.v2:' + encodeURIComponent('C:/notes/second.md'), JSON.stringify({ updatedAt: Date.now(), records: [{ ...records(target)[0], id: 'second' }] }));
      }
      setItem.call(this, key, value);
    });
    saveBookmarks('C:/notes/first.md', records(target));
    expect(loadBookmarks('C:/notes/first.md')).toHaveLength(1);
    expect(loadBookmarks('C:/notes/second.md')[0].id).toBe('second');
  });

  test('legacy combined metadata migrates without overwriting newer per-document entries', () => {
    const target = editor('<p>Target</p>'); toggleBookmark(target, 0);
    const base = records(target)[0];
    localStorage.setItem('noteboard.document-bookmarks.v1', JSON.stringify({
      'C:/notes/legacy.md': { updatedAt: 1, records: [{ ...base, id: 'legacy' }] },
      'C:/notes/newer.md': { updatedAt: 1, records: [{ ...base, id: 'old' }] },
    }));
    localStorage.setItem('noteboard.document-bookmarks.v2:' + encodeURIComponent('C:/notes/newer.md'), JSON.stringify({ updatedAt: 2, records: [{ ...base, id: 'newer' }] }));
    resetBookmarkStorage();
    expect(loadBookmarks('C:/notes/legacy.md')[0].id).toBe('legacy');
    expect(loadBookmarks('C:/notes/newer.md')[0].id).toBe('newer');
    expect(localStorage.getItem('noteboard.document-bookmarks.v1')).toBeNull();
  });

  test('a failed legacy copy keeps old bookmarks readable and retains the durable source', () => {
    const target = editor('<p>Target</p>'); toggleBookmark(target, 0);
    localStorage.setItem('noteboard.document-bookmarks.v1', JSON.stringify({ 'C:/notes/legacy.md': { updatedAt: 1, records: records(target) } }));
    resetBookmarkStorage();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('quota'); });
    expect(loadBookmarks('C:/notes/legacy.md')).toHaveLength(1);
    expect(localStorage.getItem('noteboard.document-bookmarks.v1')).not.toBeNull();
    expect(getBookmarkStorageError()).toContain('迁移');
  });

  test('limits inactive memory without deleting durable bookmarks, preserving all live bookmarks', () => {
    const target = editor('<p>Target</p>'); toggleBookmark(target, 0);
    const base = records(target)[0];
    const live = Array.from({ length: 100 }, (_, index) => ({ ...base, id: `live-${index}` }));
    const unpin = registerBookmarkPersistence('C:/notes/live.md', () => {});
    setOpenBookmarkDocuments(['C:/notes/source-first.md']);
    saveBookmarks('C:/notes/source-first.md', live);
    saveBookmarks('C:/notes/live.md', live);
    for (let index = 0; index < 210; index++) saveBookmarks(`C:/notes/old-${index}.md`, [{ ...base, id: `old-${index}` }]);
    expect(loadBookmarks('C:/notes/live.md')).toHaveLength(100);
    expect(loadBookmarks('C:/notes/source-first.md')).toHaveLength(100);
    expect(Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).filter(key => key?.startsWith('noteboard.document-bookmarks.v2:')).length).toBe(212);
    expect(loadBookmarks('C:/notes/old-0.md')).toHaveLength(1);
    unpin();
  });

  test('navigation scrolls only document owner, centers paragraph and clamps both ends', () => {
    const target = editor('<p>Target</p>'); toggleBookmark(target, 0);
    const scroller = document.createElement('div'); scroller.dataset.editorScroll = '';
    document.body.appendChild(scroller); scroller.appendChild(target.view.dom);
    const block = target.view.nodeDOM(0) as HTMLElement;
    vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue({ top: 100, height: 400 } as DOMRect);
    vi.spyOn(block, 'getBoundingClientRect').mockReturnValue({ top: 600, height: 40 } as DOMRect);
    Object.defineProperties(scroller, { scrollHeight: { value: 1200 }, clientHeight: { value: 400 }, scrollTop: { value: 200, writable: true } });
    const scroll = vi.fn(); scroller.scrollTo = scroll;
    const selection = vi.spyOn(TextSelection, 'near');
    expect(navigateBookmark(target, records(target)[0])).toBe(true);
    expect(selection).toHaveBeenCalled();
    expect(scroll).toHaveBeenLastCalledWith({ top: 520, behavior: 'instant' });
    vi.mocked(block.getBoundingClientRect).mockReturnValue({ top: -1000, height: 40 } as DOMRect);
    navigateBookmark(target, records(target)[0]);
    expect(scroll).toHaveBeenLastCalledWith({ top: 0, behavior: 'instant' });
    vi.mocked(block.getBoundingClientRect).mockReturnValue({ top: 4000, height: 40 } as DOMRect);
    navigateBookmark(target, records(target)[0]);
    expect(scroll).toHaveBeenLastCalledWith({ top: 800, behavior: 'instant' });
    scroller.remove();
  });
});
