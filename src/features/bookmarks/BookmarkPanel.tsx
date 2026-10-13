import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Bookmark, BookmarkPlus, X } from 'lucide-react';
import { Tooltip } from '../../components/Tooltip';
import { bookmarkKey } from './extension';
import { addBookmark, removeBookmark, setBookmarkColor } from './commands';
import { navigateBookmark } from './navigation';
import { BOOKMARK_COLORS, MAX_DOCUMENT_BOOKMARKS, type DocumentBookmark } from './types';
import { getBookmarkStorageError, subscribeBookmarkStorage } from './storage';
import { BookmarkContextMenu, type BookmarkMenuAnchor } from './BookmarkContextMenu';
import { BookmarkPreview } from './BookmarkPreview';
import { BOOKMARK_PANEL_REVEAL, pendingBookmarkReveal, consumeBookmarkReveal } from './panelNavigation';

interface Snapshot { records: readonly DocumentBookmark[]; doc: PMNode | null }
const EMPTY: Snapshot = { records: [], doc: null };

export function BookmarkPanel({ editor }: { editor: Editor | null }) {
  const [{ records, doc }, setSnapshot] = useState<Snapshot>(EMPTY);
  const [message, setMessage] = useState<string | null>(null);
  const [batch, setBatch] = useState(false);
  const [menu, setMenu] = useState<BookmarkMenuAnchor | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const storageError = useSyncExternalStore(subscribeBookmarkStorage, getBookmarkStorageError);
  const closeMenu = useCallback(() => setMenu(null), []);
  useLayoutEffect(() => {
    if (!editor) return;
    let highlighted: HTMLElement | undefined, timer: ReturnType<typeof setTimeout> | undefined;
    const reveal = () => {
      const id = pendingBookmarkReveal(editor); if (!id) return;
      const item = [...panel.current?.querySelectorAll<HTMLElement>('.nb-bookmark-item') ?? []].find(element => element.dataset.bookmarkId === id);
      const list = panel.current?.querySelector<HTMLElement>('.nb-bookmark-list');
      if (!item || !list) return;
      consumeBookmarkReveal(editor); clearTimeout(timer); highlighted?.removeAttribute('data-revealed'); highlighted = item;
      const row = item.getBoundingClientRect(), bounds = list.getBoundingClientRect();
      if (row.top < bounds.top || row.bottom > bounds.bottom) list.scrollTop += row.top - bounds.top - (bounds.height - row.height) / 2;
      item.dataset.revealed = ''; item.querySelector<HTMLButtonElement>('.nb-bookmark-target')?.focus({ preventScroll: true });
      timer = setTimeout(() => item.removeAttribute('data-revealed'), 1100);
    };
    reveal(); editor.view.dom.addEventListener(BOOKMARK_PANEL_REVEAL, reveal);
    return () => { editor.view.dom.removeEventListener(BOOKMARK_PANEL_REVEAL, reveal); clearTimeout(timer); highlighted?.removeAttribute('data-revealed'); };
  }, [editor, records]);
  useEffect(() => {
    setMessage(null); setBatch(false); setMenu(null);
    if (!editor) { setSnapshot(EMPTY); return; }
    const update = () => {
      const records = bookmarkKey.getState(editor.state) ?? EMPTY.records, doc = editor.state.doc;
      setSnapshot(previous => previous.records === records && previous.doc === doc ? previous : { records, doc });
    };
    update(); editor.on('transaction', update);
    return () => { editor.off('transaction', update); };
  }, [editor]);
  useEffect(() => {
    if (!batch) return;
    if (!records.length) { setBatch(false); return; }
    const outside = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('.nb-bookmark-remove,.nb-bookmark-menu')) setBatch(false);
    };
    const keydown = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') setBatch(false); };
    document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', keydown, true);
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', keydown, true); };
  }, [batch, records.length]);
  const visible = useMemo(() => [...records].sort((a, b) => Number(a.missing) - Number(b.missing) || a.pos - b.pos), [records]);
  const currentMenu = menu && records.find(record => record.id === menu.id);
  useEffect(() => { if (menu && !currentMenu) setMenu(null); }, [menu, currentMenu]);
  const remove = (id: string, focusAfter = false) => {
    if (!editor) return;
    const item = Array.from(panel.current?.querySelectorAll<HTMLElement>('[data-bookmark-id]') ?? []).find(element => element.dataset.bookmarkId === id);
    const selector = batch ? '.nb-bookmark-remove' : '.nb-bookmark-target:not(:disabled),.nb-bookmark-color';
    const next = item?.nextElementSibling?.querySelector<HTMLButtonElement>(selector) ??
      item?.previousElementSibling?.querySelector<HTMLButtonElement>(selector) ??
      panel.current?.querySelector<HTMLButtonElement>('.nb-bookmark-add');
    removeBookmark(editor, id); if (focusAfter) next?.focus({ preventScroll: true });
  };
  const openMenu = (record: DocumentBookmark, trigger: HTMLElement, x?: number, y?: number, colors = false) => {
    const bounds = trigger.getBoundingClientRect();
    setMenu({ id: record.id, x: x ?? bounds.left, y: y ?? bounds.bottom + 3, colors, trigger });
  };
  const keydown = (event: KeyboardEvent<HTMLElement>, record: DocumentBookmark) => {
    if (event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey) {
      event.preventDefault(); openMenu(record, event.currentTarget);
    } else if (event.key === 'Delete') { event.preventDefault(); remove(record.id, true); }
  };
  return <div ref={panel} className="nb-bookmark-panel" role="tabpanel" id="nb-navigation-bookmarks" aria-labelledby="nb-navigation-tab-bookmarks">
    <div className="nb-bookmark-actions">
      <button type="button" className="nb-bookmark-add" disabled={!editor} onPointerDown={event => event.preventDefault()} onClick={() => {
        if (!editor) return;
        const record = addBookmark(editor);
        setMessage(record ? records.some(previous => previous.id === record.id) ? '此处已有书签' : '已添加书签'
          : records.length >= MAX_DOCUMENT_BOOKMARKS ? `每篇文档最多 ${MAX_DOCUMENT_BOOKMARKS} 个书签，请先移除不用的书签。` : '先在正文中选择一个位置。');
      }}><BookmarkPlus size={14}/><span>添加书签</span></button>
      <span className="nb-bookmark-count" aria-label={`按文档顺序排列，共 ${records.length} 个书签`}>{records.length || ''}</span>
    </div>
    {(message || storageError) && <p className="nb-bookmark-message" role="status">{storageError || message}</p>}
    {batch && <p className="nb-bookmark-message" role="status">点击 × 删除，点空白处或按 Esc 结束</p>}
    {!records.length ? <div className="nb-navigation-empty">暂无书签<br/>选中文字或内容块添加书签</div> : <div className="nb-outline-list nb-bookmark-list" aria-label="书签，按文档顺序排列">
      {visible.map(record => <div className="nb-bookmark-item" key={record.id} data-bookmark-id={record.id} data-missing={record.missing || undefined}
        onContextMenu={event => { event.preventDefault(); event.stopPropagation(); openMenu(record, event.currentTarget.querySelector<HTMLElement>('.nb-bookmark-target')!, event.clientX, event.clientY); }}>
        <Tooltip content="书签颜色" side="left"><button type="button" className="nb-bookmark-color" aria-label={`书签颜色：${record.label}`} aria-haspopup="menu"
          style={{ color: BOOKMARK_COLORS.find(color => color.value === (record.color ?? 'amber'))?.css }}
          onClick={event => openMenu(record, event.currentTarget, undefined, undefined, true)} onKeyDown={event => keydown(event, record)}><Bookmark size={15}/></button></Tooltip>
        <Tooltip content={record.missing ? `${record.label}（内容已删除或无法唯一定位）` : record.label} side="left">
          <button className="nb-bookmark-target" type="button" disabled={record.missing} aria-label={record.label}
            onClick={() => editor && navigateBookmark(editor, record)} onKeyDown={event => keydown(event, record)}>
            {doc ? <BookmarkPreview doc={doc} record={record}/> : <span>{record.label}</span>}{record.missing && <small>内容已失效</small>}
          </button>
        </Tooltip>
        {batch && <Tooltip content="删除书签" shortcut="Delete" side="left"><button className="nb-bookmark-remove" type="button" aria-label={`删除书签：${record.label}`} onClick={event => remove(record.id, event.detail === 0)} onKeyDown={event => keydown(event, record)}><X size={13}/></button></Tooltip>}
      </div>)}
    </div>}
    {menu && currentMenu && <BookmarkContextMenu anchor={menu} record={currentMenu} onClose={closeMenu}
      onNavigate={() => { if (editor) navigateBookmark(editor, currentMenu); }}
      onRemove={() => remove(currentMenu.id, true)} onBatch={() => setBatch(true)}
      onColor={color => { if (editor) setBookmarkColor(editor, currentMenu.id, color); menu.trigger.focus({ preventScroll: true }); }}/>}
  </div>;
}
