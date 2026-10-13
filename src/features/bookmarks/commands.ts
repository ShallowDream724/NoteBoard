import type { Editor } from '@tiptap/core';
import { AllSelection, NodeSelection, TextSelection } from '@tiptap/pm/state';
import { bookmarkKey } from './extension';
import { bookmarkLabel, createBookmark, MAX_DOCUMENT_BOOKMARKS, resolveBookmarkBlock } from './model';
import { BOOKMARK_COLORS, type BookmarkColor, type DocumentBookmark } from './types';
import { rangeQuote } from './rangeAnchors';
import { showToast } from '../../stores/toastStore';

function targetBookmark(editor: Editor, position?: number): DocumentBookmark | null {
  if (editor.isDestroyed) return null;
  const selection = editor.state.selection, from = position ?? selection.from;
  const inlineNode = selection instanceof NodeSelection && selection.node.isInline ? selection.node : null;
  if (!selection.empty && (selection instanceof TextSelection || selection instanceof AllSelection || inlineNode) && from === selection.from) {
    let start = selection.from, end = selection.to;
    if (selection instanceof AllSelection) {
      const doc = editor.state.doc, hidden = new Set(['annotationStore', 'documentPresentation']);
      for (let index = 0; index < doc.childCount && hidden.has(doc.child(index).type.name); index++) start += doc.child(index).nodeSize;
      for (let index = doc.childCount - 1; index >= 0 && hidden.has(doc.child(index).type.name); index--) end -= doc.child(index).nodeSize;
    }
    if (start >= end) return null;
    const quote = rangeQuote(editor.state.doc, start, end);
    if (!quote.trim()) return null;
    return { id: '', kind: 'range', pos: start, size: end - start,
      nodeType: 'textRange', quote, label: inlineNode ? bookmarkLabel(inlineNode) : quote.replace(/\s+/g, ' ').trim().slice(0, 80), missing: false };
  }
  const target = resolveBookmarkBlock(editor.state.doc, from);
  if (!target || target.node.isTextblock && !target.node.content.size) return null;
  return createBookmark(target, '');
}
function sameTarget(a: DocumentBookmark, b: DocumentBookmark) {
  return !a.missing && a.kind === b.kind && a.pos === b.pos && (a.kind !== 'range' || a.size === b.size);
}
export function canBookmarkAt(editor: Editor, position?: number): boolean {
  return Boolean(targetBookmark(editor, position));
}
export function hasBookmarkAt(editor: Editor, position?: number): boolean {
  const target = targetBookmark(editor, position);
  return Boolean(target && bookmarkKey.getState(editor.state)?.some(record => sameTarget(record, target)));
}
export function addBookmark(editor: Editor, position?: number): DocumentBookmark | null {
  const target = targetBookmark(editor, position), records = bookmarkKey.getState(editor.state);
  if (!records || !target) return null;
  const existing = records.find(record => sameTarget(record, target));
  if (existing) { showToast('这里已有书签'); return existing; }
  if (records.length >= MAX_DOCUMENT_BOOKMARKS) return null;
  const bookmark = { ...target, id: crypto.randomUUID(), color: 'amber' as const };
  editor.view.dispatch(editor.state.tr.setMeta(bookmarkKey, [...records, bookmark]).setMeta('addToHistory', false));
  showToast('已添加书签', 'success');
  return bookmark;
}
export function toggleBookmark(editor: Editor, position?: number): boolean {
  const target = targetBookmark(editor, position), records = bookmarkKey.getState(editor.state);
  if (!records || !target) return false;
  const existing = records.find(record => sameTarget(record, target));
  if (existing) { removeBookmark(editor, existing.id); return true; }
  return Boolean(addBookmark(editor, position));
}
export function removeBookmark(editor: Editor, id: string): void {
  if (editor.isDestroyed) return;
  const records = bookmarkKey.getState(editor.state);
  if (!records) return;
  editor.view.dispatch(editor.state.tr.setMeta(bookmarkKey, records.filter(record => record.id !== id)).setMeta('addToHistory', false));
}
export function setBookmarkColor(editor: Editor, id: string, color: BookmarkColor): void {
  if (editor.isDestroyed || !BOOKMARK_COLORS.some(option => option.value === color)) return;
  const records = bookmarkKey.getState(editor.state);
  if (!records) return;
  editor.view.dispatch(editor.state.tr.setMeta(bookmarkKey, records.map(record => record.id === id ? { ...record, color } : record)).setMeta('addToHistory', false));
}
