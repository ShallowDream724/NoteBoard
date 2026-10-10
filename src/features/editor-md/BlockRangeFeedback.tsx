import { useLayoutEffect, useRef } from 'react';
import type { Editor } from '@tiptap/core';
import type { Transaction } from '@tiptap/pm/state';
import { findScrollContainer } from '../../core/dom/scrollContainer';
import { findTopLevelBlockElement } from './blockReorder';
import { listItemHorizontalBounds, releaseListMarkerGeometry } from './listMarkerGeometry';
import './blockRangeFeedback.css';

/** A UI-owned overlay: hovering never changes selection, history or editable DOM.
 * Only the current block is measured; large documents require no block traversal. */
export function BlockRangeFeedback({ editor, pos, to, className = '' }: { editor: Editor; pos: number; to?: number; className?: string }) {
  const overlay = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => () => releaseListMarkerGeometry(editor.view), [editor]);
  useLayoutEffect(() => {
    const layer = overlay.current;
    if (!layer) return;
    const host = findScrollContainer(editor.view.dom);
    let currentPos: number | null = pos;
    let currentEnd = to;
    let target: HTMLElement | null = null;
    let lastTarget: HTMLElement | null = null;
    let frame = 0;
    const update = () => {
      frame = 0;
      const dom = currentPos === null || currentPos >= editor.state.doc.content.size ? null : editor.view.nodeDOM(currentPos);
      const next = findTopLevelBlockElement(editor.view.dom, dom);
      if (target !== next) {
        if (target) resize.unobserve(target);
        target = next;
        if (target) resize.observe(target);
      }
      if (!target || !target.isConnected) { layer.hidden = true; return; }
      const rect = target.getBoundingClientRect(), bounds = host.getBoundingClientRect();
      const end = currentEnd === undefined || currentEnd > editor.state.doc.content.size ? null : editor.state.doc.resolve(currentEnd);
      const lastPos = end?.nodeBefore ? currentEnd! - end.nodeBefore.nodeSize : currentPos;
      const last = lastPos === null ? null : findTopLevelBlockElement(editor.view.dom, editor.view.nodeDOM(lastPos));
      if (last !== lastTarget) {
        if (lastTarget && lastTarget !== target) resize.unobserve(lastTarget);
        lastTarget = last;
        if (lastTarget && lastTarget !== target) resize.observe(lastTarget);
      }
      // Outside markers are not part of an LI's border box. Include only its
      // own list's horizontal gutter while retaining the current item's height.
      const scale = bounds.width / host.offsetWidth || 1;
      const row = listItemHorizontalBounds(editor.view, currentPos!, target, rect, scale);
      const lastRect = last?.getBoundingClientRect() ?? rect;
      const lastRow = last && lastPos !== null ? listItemHorizontalBounds(editor.view, lastPos, last, lastRect, scale) : row;
      // Clip to the scroll viewport so a huge table never creates a huge layer.
      const left = Math.max(Math.min(row.left, lastRow.left) - 2 * scale, bounds.left);
      const right = Math.min(Math.max(row.right, lastRow.right) + 2 * scale, bounds.right - (host.offsetWidth - host.clientWidth) * scale);
      const top = Math.max(rect.top - 2 * scale, bounds.top);
      const bottom = Math.min(lastRect.bottom + 2 * scale, bounds.bottom);
      layer.hidden = right <= left || bottom <= top;
      Object.assign(layer.style, {
        left: `${(left - bounds.left) / scale + host.scrollLeft}px`,
        top: `${(top - bounds.top) / scale + host.scrollTop}px`,
        width: `${Math.max(0, right - left) / scale}px`,
        height: `${Math.max(0, bottom - top) / scale}px`,
      });
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    const onTransaction = ({ transaction }: { transaction: Transaction }) => {
      if (!transaction.docChanged) return;
      if (currentPos !== null) {
        const mapped = transaction.mapping.mapResult(currentPos, 1);
        const before = transaction.before.nodeAt(currentPos), after = transaction.doc.nodeAt(mapped.pos);
        // Attribute-only replacements may map a boundary as deleted. Preserve
        // that same content, but never move feedback onto the following block.
        const replaced = before?.type === after?.type && before?.content === after?.content;
        currentPos = mapped.deletedAcross || mapped.deleted && !replaced ? null : mapped.pos;
      }
      if (currentEnd !== undefined) currentEnd = transaction.mapping.map(currentEnd, -1);
      schedule();
    };
    const resize = new ResizeObserver(schedule);
    resize.observe(host);
    resize.observe(editor.view.dom);
    update();
    host.addEventListener('scroll', schedule, { passive: true });
    editor.on('transaction', onTransaction);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      host.removeEventListener('scroll', schedule);
      editor.off('transaction', onTransaction);
    };
  }, [editor, pos, to]);
  return <div ref={overlay} className={`nb-block-range-feedback ${className}`} aria-hidden="true" hidden/>;
}
