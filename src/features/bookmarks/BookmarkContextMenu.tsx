import { useEffect, useRef, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Bookmark, ListX, LocateFixed, Trash2 } from 'lucide-react';
import { useMenuBounds } from '../../components/useMenuBounds';
import { BOOKMARK_COLORS, type BookmarkColor, type DocumentBookmark } from './types';

export interface BookmarkMenuAnchor { id: string; x: number; y: number; colors?: boolean; trigger: HTMLElement }
interface Props {
  anchor: BookmarkMenuAnchor; record: DocumentBookmark; onClose: () => void;
  onNavigate: () => void; onRemove: () => void; onBatch?: () => void; onColor?: (color: BookmarkColor) => void;
}
export function BookmarkContextMenu({ anchor, record, onClose, onNavigate, onRemove, onBatch, onColor }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useMenuBounds(ref, true, anchor.x, anchor.y);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
    const outside = (event: Event) => { if (event.target instanceof Node && !ref.current?.contains(event.target)) onClose(); };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('scroll', outside, true); window.addEventListener('blur', onClose);
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('scroll', outside, true); window.removeEventListener('blur', onClose); };
  }, [onClose, anchor]);
  const keydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); anchor.trigger.focus({ preventScroll: true }); return; }
    if (event.key === 'Tab') { onClose(); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const buttons = [...ref.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus({ preventScroll: true });
  };
  const run = (action: () => void) => { action(); onClose(); };
  return createPortal(<div ref={ref} className="nb-bookmark-menu" role="menu" aria-label={anchor.colors ? '书签颜色' : '书签操作'}
    data-menu-min-width="156px" style={{ left: anchor.x, top: anchor.y }} onKeyDown={keydown}
    onContextMenu={event => event.preventDefault()}>
    {anchor.colors ? BOOKMARK_COLORS.map(color => <button key={color.value} type="button" role="menuitemradio" aria-checked={(record.color ?? 'amber') === color.value}
      onClick={() => run(() => onColor?.(color.value))}><Bookmark size={15} style={{ color: color.css }}/><span>{color.label}</span></button>) : <>
      <button type="button" role="menuitem" disabled={record.missing} onClick={() => run(onNavigate)}><LocateFixed size={15}/><span>跳转到书签</span></button>
      <button type="button" role="menuitem" onClick={() => run(onRemove)}><Trash2 size={15}/><span>删除书签</span></button>
      {onBatch && <><div role="separator"/>
      <button type="button" role="menuitem" onClick={() => run(onBatch)}><ListX size={15}/><span>批量删除</span></button></>}
    </>}
  </div>, document.body);
}
