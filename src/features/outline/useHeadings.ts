import { useState, useEffect, useCallback, useRef } from 'react';
import type { Editor } from '@tiptap/core';
import type { Transaction } from '@tiptap/pm/state';
import { EDITOR_SEARCH_NAVIGATION_META } from '../../core/editor/searchNavigation';
import { lastAtOrBefore } from '../../core/dom/orderedPosition';
import { HeadingIndex, type HeadingItem } from './headingIndex';

export type { HeadingItem } from './headingIndex';

export function useHeadings(editor: Editor | null) {
  const [headings, setHeadings] = useState<HeadingItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const headingsRef = useRef<HeadingItem[]>([]);

  const updateActiveHeading = useCallback(() => {
    const current = headingsRef.current;
    if (!editor || !current.length) { setActiveId(null); return; }
    const index = lastAtOrBefore(current.length, i => current[i].pos, editor.state.selection.from);
    setActiveId(index >= 0 ? current[index].id : null);
  }, [editor]);

  useEffect(() => {
    if (!editor) {
      headingsRef.current = [];
      setHeadings(previous => previous.length ? [] : previous);
      setActiveId(null);
      return;
    }
    const index = new HeadingIndex(editor.state.doc);
    headingsRef.current = index.items;
    setHeadings(index.items);
    updateActiveHeading();
    const handleTransaction = ({ transaction, appendedTransactions }: { transaction: Transaction; appendedTransactions: Transaction[] }) => {
      let items = index.apply(transaction);
      for (const appended of appendedTransactions) items = index.apply(appended);
      if (items !== headingsRef.current) { headingsRef.current = items; setHeadings(items); }
    };
    const handleSelectionUpdate = ({ transaction }: { transaction: Transaction }) => {
      if (transaction.getMeta(EDITOR_SEARCH_NAVIGATION_META)) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(updateActiveHeading, 100);
    };
    editor.on('transaction', handleTransaction);
    editor.on('selectionUpdate', handleSelectionUpdate);
    return () => {
      editor.off('transaction', handleTransaction);
      editor.off('selectionUpdate', handleSelectionUpdate);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [editor, updateActiveHeading]);

  return { headings, activeId, setActiveId };
}
