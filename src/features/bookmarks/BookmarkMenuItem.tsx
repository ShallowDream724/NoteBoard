import type { Editor } from '@tiptap/core';
import { Bookmark, BookmarkMinus } from 'lucide-react';
import { bookmarkKey } from './extension';
import { hasBookmarkAt, toggleBookmark } from './commands';
import { showToast } from '../../stores/toastStore';

/** All block/selection menus share one document-local bookmark action. */
export function BookmarkMenuItem({ editor, position, run }: {
  editor: Editor;
  position?: number;
  run: (action: () => void) => void;
}) {
  if (!bookmarkKey.getState(editor.state)) return null;
  const marked = hasBookmarkAt(editor, position);
  const Icon = marked ? BookmarkMinus : Bookmark;
  return <button role="menuitem" type="button" onClick={() => run(() => {
    if (!toggleBookmark(editor, position)) showToast('此文档最多添加 100 个书签，请先移除不再需要的书签。', 'warning');
  })}><Icon size={16}/>{marked ? '移除书签' : '添加书签'}</button>;
}
