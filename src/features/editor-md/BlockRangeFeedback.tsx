import { useLayoutEffect, useRef } from 'react';
import type { Editor } from '@tiptap/core';
import type { Transaction } from '@tiptap/pm/state';
import { findScrollContainer } from '../../core/dom/scrollContainer';
import { findTopLevelBlockElement } from './blockReorder';
import './blockRangeFeedback.css';

/** A UI-owned overlay: hovering never changes selection, history or editable DOM.
 * Only the current block is measured; large documents require no block traversal. */
export function BlockRangeFeedback({ editor, pos }: { editor: Editor; pos: number }) {
  const overlay = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const layer = overlay.current;
    if (!layer) return;
    const host = findScrollContainer(editor.view.dom);
    let currentPos: number | null = pos;
    let target: HTMLElement | null = null;
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
      const scale = bounds.width / host.offsetWidth || 1;
      // Clip to the scroll viewport so a huge table never creates a huge layer.
      const left = Math.max(rect.left - 2 * scale, bounds.left);
      const right = Math.min(rect.right + 2 * scale, bounds.right - (host.offsetWidth - host.clientWidth) * scale);
      const top = Math.max(rect.top - 2 * scale, bounds.top);
      const bottom = Math.min(rect.bottom + 2 * scale, bounds.bottom);
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
  }, [editor, pos]);
  return <div ref={overlay} className="nb-block-range-feedback" aria-hidden="true" hidden/>;
}
