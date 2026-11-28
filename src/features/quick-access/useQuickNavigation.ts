import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type { Editor } from '@tiptap/core';
import { bookmarkKey } from '../bookmarks/extension';
import { navigateBookmark } from '../bookmarks/navigation';
import type { DocumentBookmark } from '../bookmarks/types';
import { navigateHeading } from '../outline/navigateHeading';
import { useHeadingItems } from '../outline/useHeadings';
import type { QuickNavigation } from './quickAccessItems';

const NO_BOOKMARKS: readonly DocumentBookmark[] = [];

export function useQuickNavigation(editor: Editor | null, isCurrent: (editor: Editor) => boolean): QuickNavigation[] {
  const headings = useHeadingItems(editor);
  const bookmarks = useSyncExternalStore(
    useCallback(listener => {
      editor?.on('transaction', listener);
      return () => { editor?.off('transaction', listener); };
    }, [editor]),
    () => editor && !editor.isDestroyed ? bookmarkKey.getState(editor.state) ?? NO_BOOKMARKS : NO_BOOKMARKS,
  );
  return useMemo(() => {
    if (!editor) return [];
    return [
      ...headings.map((heading): QuickNavigation => ({
        id: `heading:${heading.id}`, type: 'heading', label: heading.text, detail: `标题 ${heading.level}`,
        run: () => { if (isCurrent(editor)) navigateHeading(editor, heading); },
      })),
      ...bookmarks.filter(record => !record.missing).map((bookmark): QuickNavigation => ({
        id: `bookmark:${bookmark.id}`, type: 'bookmark', label: bookmark.label, detail: '书签',
        run: () => {
          if (!isCurrent(editor)) return;
          const current = bookmarkKey.getState(editor.state)?.find(record => record.id === bookmark.id);
          if (current && !current.missing) {
            editor.view.focus();
            navigateBookmark(editor, current);
          }
        },
      })),
    ];
  }, [editor, headings, bookmarks, isCurrent]);
}
