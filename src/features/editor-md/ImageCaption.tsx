import { useLayoutEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { normalizeFigureCaption, renderFigureCaption } from './figureCaption';
import { editFigureCaption, FIGURE_CAPTION_EDIT_EVENT } from './figureCaptionCommands';
import { FigureCaptionTransition } from './figureCaptionTransition';
import './imageCaption.css';
import './captionAddControl.css';

export function ImageCaption({ editor, getPos, caption, captionContent, src, width, editable }: {
  editor: Editor; getPos: () => number | undefined; caption: unknown; captionContent?: unknown; src: string;
  width: string; editable: boolean;
}) {
  const text = normalizeFigureCaption(caption), canEdit = editable && editor.isEditable;
  const [editing, setEditing] = useState(false);
  const host = useRef<HTMLDivElement>(null), label = useRef<HTMLSpanElement>(null);
  const transition = useRef<FigureCaptionTransition | null>(null);
  const position = useRef(getPos); position.current = getPos;
  useLayoutEffect(() => {
    if (!host.current || !label.current || !canEdit) return;
    const current = new FigureCaptionTransition(label.current, host.current, {
      view: editor.view, getPos: () => position.current(), label: '图片图注', onEditingChange: setEditing,
    });
    transition.current = current;
    const open = (event: Event) => {
      if ((event as CustomEvent<{ pos: number }>).detail?.pos === position.current()) current.begin();
    };
    const dom = editor.view.dom;
    dom.addEventListener(FIGURE_CAPTION_EDIT_EVENT, open);
    return () => { dom.removeEventListener(FIGURE_CAPTION_EDIT_EVENT, open); current.destroy(); transition.current = null; };
  }, [editor, canEdit, src]);
  useLayoutEffect(() => {
    transition.current?.sync();
    if (!editing && label.current) renderFigureCaption(label.current, caption, captionContent);
  }, [caption, captionContent, editing]);
  if (!editing && !text && !canEdit) return null;
  return <div className={`nb-image-caption${!text && !editing ? ' nb-caption-empty' : ''}`} data-image-caption={text || editing ? '' : undefined}
    data-caption-host="" contentEditable={false} style={{ width }}
    onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
    <div ref={host} className="nb-caption-edit-host" hidden={!editing}/><span ref={label} hidden={editing} className={`nb-image-caption-text${!text ? ' nb-caption-add' : ''}`}
      role={canEdit ? 'button' : undefined} tabIndex={canEdit ? 0 : undefined} aria-label={canEdit ? text ? '编辑图注' : '添加图注' : undefined}
      data-placeholder={!text ? '添加图注' : undefined}
      onPointerDown={canEdit ? event => { event.preventDefault(); event.stopPropagation(); } : undefined}
      onMouseDown={canEdit ? event => { event.preventDefault(); event.stopPropagation(); } : undefined}
      onClick={canEdit ? () => { const pos = getPos(); if (typeof pos === 'number') editFigureCaption(editor, pos); } : undefined}
      onKeyDown={event => { if (canEdit && ['Enter', ' '].includes(event.key)) { event.preventDefault(); const pos = getPos(); if (typeof pos === 'number') editFigureCaption(editor, pos); } }}/>
  </div>;
}
