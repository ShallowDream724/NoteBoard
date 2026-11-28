import { useState, useEffect, useCallback, useRef, useSyncExternalStore } from 'react';
import type { Editor } from '@tiptap/core';
import type { Transaction } from '@tiptap/pm/state';
import { EDITOR_SEARCH_NAVIGATION_META } from '../../core/editor/searchNavigation';
import { lastAtOrBefore } from '../../core/dom/orderedPosition';
import { HeadingIndex, type HeadingItem } from './headingIndex';

export type { HeadingItem } from './headingIndex';

const NO_HEADINGS: HeadingItem[] = [];
type HeadingListener = (items: HeadingItem[]) => void;
const headingRuntimes = new WeakMap<Editor, { index: HeadingIndex; listeners: Set<HeadingListener>; dispose: () => void }>();

function observeHeadingIndex(editor: Editor, listener: HeadingListener) {
  let runtime = headingRuntimes.get(editor);
  if (!runtime) {
    const index = new HeadingIndex(editor.state.doc);
    const listeners = new Set<HeadingListener>();
    const update = ({ transaction, appendedTransactions }: { transaction: Transaction; appendedTransactions: Transaction[] }) => {
      const previous = index.items;
      let current = index.apply(transaction);
      for (const appended of appendedTransactions) current = index.apply(appended);
      if (previous !== current) listeners.forEach(notify => notify(current));
    };
    editor.on('transaction', update);
    runtime = { index, listeners, dispose: () => editor.off('transaction', update) };
    headingRuntimes.set(editor, runtime);
  }
  const observed = runtime;
  observed.listeners.add(listener);
  listener(observed.index.items);
  return () => {
    observed.listeners.delete(listener);
    if (observed.listeners.size) return;
    observed.dispose();
    headingRuntimes.delete(editor);
  };
}

export function useHeadingItems(editor: Editor | null) {
  return useSyncExternalStore(
    useCallback(listener => editor && !editor.isDestroyed ? observeHeadingIndex(editor, listener) : () => {}, [editor]),
    () => editor ? headingRuntimes.get(editor)?.index.items ?? NO_HEADINGS : NO_HEADINGS,
  );
}

export function useHeadings(editor: Editor | null) {
  const [headings, setHeadings] = useState<HeadingItem[]>(NO_HEADINGS);
  const [activeId, setActiveId] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const headingsRef = useRef<HeadingItem[]>(NO_HEADINGS);

  const updateActiveHeading = useCallback(() => {
    const current = headingsRef.current;
    if (!editor || !current.length) { setActiveId(null); return; }
    const index = lastAtOrBefore(current.length, i => current[i].pos, editor.state.selection.from);
    setActiveId(index >= 0 ? current[index].id : null);
  }, [editor]);

  useEffect(() => {
    if (!editor) {
      headingsRef.current = NO_HEADINGS;
      setHeadings(NO_HEADINGS);
      setActiveId(null);
      return;
    }
    const stop = observeHeadingIndex(editor, items => {
      headingsRef.current = items;
      setHeadings(items);
    });
    updateActiveHeading();
    const handleSelectionUpdate = ({ transaction }: { transaction: Transaction }) => {
      if (transaction.getMeta(EDITOR_SEARCH_NAVIGATION_META)) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(updateActiveHeading, 100);
    };
    editor.on('selectionUpdate', handleSelectionUpdate);
    return () => {
      stop();
      editor.off('selectionUpdate', handleSelectionUpdate);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [editor, updateActiveHeading]);

  return { headings, activeId, setActiveId };
}
