import type { Editor } from '@tiptap/core';
import { bookmarkKey } from './extension';
import { createBookmark, MAX_DOCUMENT_BOOKMARKS, resolveBookmarkBlock } from './model';

export function hasBookmarkAt(editor: Editor, position = editor.state.selection.from): boolean {
  const target = resolveBookmarkBlock(editor.state.doc, position);
  return Boolean(target && bookmarkKey.getState(editor.state)?.some(record => !record.missing && record.pos === target.pos));
}
export function toggleBookmark(editor: Editor, position = editor.state.selection.from): boolean {
  if (editor.isDestroyed) return false;
  const records = bookmarkKey.getState(editor.state);
  const target = resolveBookmarkBlock(editor.state.doc, position);
  if (!records || !target) return false;
  const existing = records.find(record => !record.missing && record.pos === target.pos);
  if (!existing && records.length >= MAX_DOCUMENT_BOOKMARKS) return false;
  const bookmark = createBookmark(target, crypto.randomUUID());
  const { from, to } = editor.state.selection;
  if (position === from && from !== to) {
    const selected = editor.state.doc.textBetween(from, Math.min(to, from + 160), ' ').replace(/\s+/g, ' ').trim();
    if (selected) bookmark.label = selected.slice(0, 80);
  }
  const next = existing ? records.filter(record => record.id !== existing.id) : [...records, bookmark];
  editor.view.dispatch(editor.state.tr.setMeta(bookmarkKey, next).setMeta('addToHistory', false));
  return true;
}
export function removeBookmark(editor: Editor, id: string): void {
  const records = bookmarkKey.getState(editor.state);
  if (!records || editor.isDestroyed) return;
  editor.view.dispatch(editor.state.tr.setMeta(bookmarkKey, records.filter(record => record.id !== id)).setMeta('addToHistory', false));
}
