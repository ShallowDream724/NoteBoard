import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { FIGURE_CAPTION_MAX_LENGTH, normalizeFigureCaption } from './figureCaption';
import { editFigureCaption, FIGURE_CAPTION_EDIT_EVENT, setFigureCaption } from './figureCaptionCommands';
import './imageCaption.css';

/** The draft stays outside the document until one explicit commit. */
export function ImageCaption({ editor, getPos, caption, src, width, editable }: {
  editor: Editor; getPos: () => number | undefined; caption: unknown; src: string;
  width: string; editable: boolean;
}) {
  const text = normalizeFigureCaption(caption);
  const [draft, setDraft] = useState(''), [editing, setEditing] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const activeSource = useRef<string | null>(null);

  useEffect(() => {
    const open = (event: Event) => {
      if (!editable || !editor.isEditable || (event as CustomEvent<{ pos: number }>).detail?.pos !== getPos()) return;
      activeSource.current = src; setDraft(text ?? ''); setEditing(true);
    };
    const dom = editor.view.dom;
    dom.addEventListener(FIGURE_CAPTION_EDIT_EVENT, open);
    return () => dom.removeEventListener(FIGURE_CAPTION_EDIT_EVENT, open);
  }, [editor, editable, getPos, src, text]);
  useEffect(() => { if (editing) input.current?.focus({ preventScroll: true }); }, [editing]);

  const finish = (commit: boolean, restoreFocus = false) => {
    if (activeSource.current === null) return;
    const originalSource = activeSource.current; activeSource.current = null;
    const pos = getPos();
    if (commit && typeof pos === 'number' && !editor.isDestroyed && editor.state.doc.nodeAt(pos)?.attrs.src === originalSource) {
      setFigureCaption(editor.view, pos, draft);
    }
    setEditing(false);
    if (restoreFocus && !editor.isDestroyed) editor.view.dom.focus({ preventScroll: true });
  };
  if (!editing && !text) return null;
  return <div className="nb-image-caption" data-image-caption="" contentEditable={false} style={{ width }}
    onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
    {editing ? <textarea ref={input} className="nb-image-caption-input" aria-label="图片图注" placeholder="添加图注"
      value={draft} maxLength={FIGURE_CAPTION_MAX_LENGTH} rows={Math.min(6, Math.max(1, draft.split('\n').length))}
      onChange={event => setDraft(event.target.value)} onBlur={() => finish(true)}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Escape') { event.preventDefault(); finish(false, true); }
        else if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); finish(true, true); }
      }} /> : editable && editor.isEditable ? <button type="button" className="nb-image-caption-text" aria-label="编辑图注"
        onClick={() => { const pos = getPos(); if (typeof pos === 'number') editFigureCaption(editor, pos); }}>{text}</button>
      : <span className="nb-image-caption-text">{text}</span>}
  </div>;
}
