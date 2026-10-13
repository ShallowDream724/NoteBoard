import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Editor } from '@tiptap/core';
import { BookmarkPlus, BookmarkMinus, X } from 'lucide-react';
import { Tooltip } from '../../components/Tooltip';
import { bookmarkKey } from './extension';
import { hasBookmarkAt, removeBookmark, toggleBookmark } from './commands';
import { navigateBookmark } from './navigation';
import { MAX_DOCUMENT_BOOKMARKS, type DocumentBookmark } from './model';
import { getBookmarkStorageError, subscribeBookmarkStorage } from './storage';

export function BookmarkPanel({ editor }: { editor: Editor | null }) {
  const [records, setRecords] = useState<readonly DocumentBookmark[]>([]);
  const [current, setCurrent] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const storageError = useSyncExternalStore(subscribeBookmarkStorage, getBookmarkStorageError);
  useEffect(() => {
    setMessage(null);
    if (!editor) { setRecords([]); setCurrent(false); return; }
    const update = () => { setRecords(bookmarkKey.getState(editor.state) ?? []); setCurrent(hasBookmarkAt(editor)); };
    update(); editor.on('transaction', update);
    return () => { editor.off('transaction', update); };
  }, [editor]);
  const visible = [...records].sort((a, b) => Number(a.missing) - Number(b.missing) || a.pos - b.pos);
  const remove = (id: string, button: HTMLElement) => {
    if (!editor) return;
    const item = button.closest('.nb-bookmark-item');
    const next = item?.nextElementSibling?.querySelector<HTMLButtonElement>('button:not(:disabled)') ??
      item?.previousElementSibling?.querySelector<HTMLButtonElement>('button:not(:disabled)') ??
      button.closest('.nb-bookmark-panel')?.querySelector<HTMLButtonElement>('.nb-bookmark-add');
    removeBookmark(editor, id); next?.focus({ preventScroll: true });
  };
  return <div className="nb-bookmark-panel" role="tabpanel" id="nb-navigation-bookmarks" aria-labelledby="nb-navigation-tab-bookmarks">
    <div className="nb-bookmark-actions">
      <button type="button" className="nb-bookmark-add" disabled={!editor} onPointerDown={event => event.preventDefault()} onClick={() => {
        if (!editor) return;
        setMessage(toggleBookmark(editor) ? null : records.length >= MAX_DOCUMENT_BOOKMARKS ? `每篇文档最多 ${MAX_DOCUMENT_BOOKMARKS} 个书签，请先移除不用的书签。` : '先在正文中选择一个位置。');
      }}>{current ? <BookmarkMinus size={14}/> : <BookmarkPlus size={14}/>}<span>{current ? '移除当前位置' : '添加当前位置'}</span></button>
      <span className="nb-bookmark-count">{records.length || ''}</span>
    </div>
    {(message || storageError) && <p className="nb-bookmark-message" role="status">{message || storageError}</p>}
    {!records.length ? <div className="nb-navigation-empty">暂无书签<br/>在需要返回的段落添加书签</div> : <div className="nb-outline-list nb-bookmark-list">
      {visible.map(record => <div className="nb-bookmark-item" key={record.id} data-missing={record.missing || undefined}>
        <Tooltip content={record.missing ? `${record.label}（内容已删除或无法唯一定位）` : record.label} side="left">
          <button className="nb-bookmark-target" type="button" disabled={record.missing} onClick={() => editor && navigateBookmark(editor, record)} onKeyDown={event => {
            if (event.key === 'Delete') { event.preventDefault(); remove(record.id, event.currentTarget); }
          }}>
            <span>{record.label}</span>{record.missing && <small>内容已失效</small>}
          </button>
        </Tooltip>
        <Tooltip content="移除书签" shortcut="Delete" side="left"><button className="nb-bookmark-remove" type="button" aria-label={`移除书签：${record.label}`} onClick={event => remove(record.id, event.currentTarget)}><X size={13}/></button></Tooltip>
      </div>)}
    </div>}
  </div>;
}
