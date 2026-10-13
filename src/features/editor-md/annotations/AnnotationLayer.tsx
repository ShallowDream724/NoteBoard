import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@tiptap/core';
import { Check, GripHorizontal, Pencil, Pin, PinOff, Trash2, X } from 'lucide-react';
import { Tooltip } from '../../../components/Tooltip';
import { useHoverMenu } from '../../../components/useHoverMenu';
import { findScrollContainer } from '../../../core/dom/scrollContainer';
import { ANNOTATION_BEGIN_EVENT, ANNOTATION_OPEN_EVENT, ANNOTATION_DISMISS_TRANSIENT_EVENT, addAnnotation, canAddAnnotation, removeAnnotation, updateAnnotation, type AnnotationBeginRequest } from './commands';
import { annotationIndexKey } from './extension';
import { annotationAnchors, collectAnnotations, type AnnotationRecord } from './model';
import { annotationGroups } from './presentation';
import { AnnotationBodyEditor, type AnnotationDraftHandle } from './bodyEditor';
import { constrainAnnotationGeometry, type AnnotationBoundary, type AnnotationGeometry } from './geometry';
import { captureAnnotationTarget, resolveAnnotationTarget } from './draftTarget';
import { annotationPanelSession, type AnnotationPanelState as PanelState } from './panelSession';
import { editorDocumentKey } from '../editorDocumentCodec';
import './annotations.css';

type OpenRequest = { id: string; edit: boolean };
const emptyPanels: PanelState[] = [];
const noSubscribe = () => () => {};

export function AnnotationLayer({ editor, container }: { editor: Editor | null; container?: HTMLElement | null }) {
  const session = editor ? annotationPanelSession(editor) : null;
  const panels = useSyncExternalStore(session?.subscribe ?? noSubscribe, session?.snapshot ?? (() => emptyPanels));
  const setPanels = (update: (panels: PanelState[]) => PanelState[]) => session?.set(update);
  const pending = useRef<{ id: string; element: HTMLElement } | null>(null);
  const restoringFocus = useRef(false);
  const boundaryElement = useRef<HTMLElement | null>(null);
  const records = editor ? annotationIndexKey.getState(editor.state)?.records ?? collectAnnotations(editor.state.doc) : new Map<string, AnnotationRecord>();
  const boundary = (): AnnotationBoundary => {
    const rect = boundaryElement.current?.getBoundingClientRect();
    const left = Math.max(0, rect?.left ?? 0), top = Math.max(0, rect?.top ?? 0);
    const right = Math.min(window.innerWidth, rect?.right ?? window.innerWidth), bottom = Math.min(window.innerHeight, rect?.bottom ?? window.innerHeight);
    return { left, top, width: Math.max(120, right - left), height: Math.max(80, bottom - top) };
  };
  const open = (id: string, element: HTMLElement | null, editing = false) => {
    if (!editor || !(annotationIndexKey.getState(editor.state)?.records ?? collectAnnotations(editor.state.doc)).has(id)) return;
    const rect = element?.getBoundingClientRect();
    const bounds = boundary();
    setPanels(current => {
      const existing = current.find(panel => panel.id === id);
      const retained = current.filter(panel => panel.pinned || panel.editing || panel.id === id);
      return existing ? retained.map(panel => panel.id === id ? { ...panel, editing: panel.editing || editing } : panel)
        : [...retained, { id, pinned: false, editing, trigger: element, body: records.get(id)?.node, position: records.get(id)?.pos,
          geometry: constrainAnnotationGeometry({ x: rect?.left ?? bounds.left + 24, y: (rect?.bottom ?? bounds.top + 24) + 6, width: 340 }, bounds) }];
    });
  };
  const begin = ({ id, target }: AnnotationBeginRequest) => {
    if (!editor) return;
    let element: HTMLElement | null = null;
    try {
      const node = target.node ? editor.view.nodeDOM(target.from) : editor.view.domAtPos(target.from).node;
      element = node instanceof HTMLElement ? node : node?.parentElement ?? null;
    } catch { /* The panel still has the editor boundary as a stable placement fallback. */ }
    const rect = element?.getBoundingClientRect(), bounds = boundary();
    latest.current.hasPanels = true;
    setPanels(current => [...current.filter(panel => panel.pinned || panel.editing), { id, pinned: false, editing: true, creation: target, trigger: null,
      geometry: constrainAnnotationGeometry({ x: rect?.left ?? bounds.left + 24, y: (rect?.bottom ?? bounds.top + 24) + 6, width: 340 }, bounds) }]);
  };
  const closeTransient = () => setPanels(current => current.filter(panel => panel.pinned || panel.editing));
  const hover = useHoverMenu(panels.some(panel => !panel.pinned && !panel.editing), value => {
    if (value && pending.current) open(pending.current.id, pending.current.element);
    else if (!value) closeTransient();
  }, false, false, target => target instanceof Element && Boolean(editor?.view.dom.contains(target)
    && target.closest('.nb-annotation-anchor, .nb-annotation-indicator')));
  const latest = useRef({ open, begin, hover, hasTransient: false, hasPanels: false }); latest.current = { open, begin, hover, hasTransient: panels.some(panel => !panel.pinned && !panel.editing), hasPanels: panels.length > 0 };
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    boundaryElement.current = container ?? findScrollContainer(dom);
    const anchor = (target: EventTarget | null) => target instanceof Element ? target.closest<HTMLElement>('.nb-annotation-anchor, .nb-annotation-indicator') : null;
    const enter = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      const element = anchor(event.target); if (!element || element.contains(event.relatedTarget as Node | null)) return;
      pending.current = { id: element.dataset.annotationId!, element };
      if (latest.current.hasTransient) { latest.current.hover.cancel(); latest.current.open(element.dataset.annotationId!, element); }
      else latest.current.hover.enter();
    };
    const leave = (event: PointerEvent) => {
      const element = anchor(event.target); if (element && !element.contains(event.relatedTarget as Node | null)) latest.current.hover.leave();
    };
    const click = (event: MouseEvent) => {
      const element = anchor(event.target); if (!element) return;
      if (element.matches('.nb-annotation-indicator')) event.preventDefault();
      latest.current.hover.cancel(); latest.current.open(element.dataset.annotationId!, element);
    };
    const focus = (event: FocusEvent) => {
      if (restoringFocus.current) return;
      const element = anchor(event.target); if (element) { latest.current.hover.cancel(); latest.current.hover.keyboard.current = true; latest.current.open(element.dataset.annotationId!, element); }
    };
    const keyboard = (event: KeyboardEvent) => {
      const element = anchor(event.target); if (!element || event.target !== element || !['Enter', ' ', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation(); latest.current.hover.cancel(); latest.current.open(element.dataset.annotationId!, element);
      requestAnimationFrame(() => Array.from(document.querySelectorAll<HTMLElement>('.nb-annotation-panel')).find(panel => panel.dataset.annotationPanel === element.dataset.annotationId)?.querySelector<HTMLElement>('button')?.focus());
    };
    const request = (event: Event) => {
      const detail = (event as CustomEvent<OpenRequest>).detail;
      const element = Array.from(dom.querySelectorAll<HTMLElement>('.nb-annotation-indicator')).find(item => item.dataset.annotationId === detail.id) ?? null;
      latest.current.hover.cancel(); latest.current.open(detail.id, element, detail.edit);
    };
    const beginRequest = (event: Event) => { latest.current.hover.cancel(); latest.current.begin((event as CustomEvent<AnnotationBeginRequest>).detail); };
    const dismissTransient = () => { latest.current.hover.cancel(); closeTransient(); };
    dom.addEventListener('pointerover', enter); dom.addEventListener('pointerout', leave);
    dom.addEventListener('click', click); dom.addEventListener('focusin', focus); dom.addEventListener('keydown', keyboard, true);
    dom.addEventListener(ANNOTATION_OPEN_EVENT, request); dom.addEventListener(ANNOTATION_BEGIN_EVENT, beginRequest);
    dom.addEventListener(ANNOTATION_DISMISS_TRANSIENT_EVENT, dismissTransient);
    return () => {
      dom.removeEventListener('pointerover', enter); dom.removeEventListener('pointerout', leave);
      dom.removeEventListener('click', click); dom.removeEventListener('focusin', focus); dom.removeEventListener('keydown', keyboard, true);
      dom.removeEventListener(ANNOTATION_OPEN_EVENT, request); dom.removeEventListener(ANNOTATION_BEGIN_EVENT, beginRequest);
      dom.removeEventListener(ANNOTATION_DISMISS_TRANSIENT_EVENT, dismissTransient);
    };
  }, [editor, container]);
  if (!editor || !panels.length) return null;
  const index = annotationIndexKey.getState(editor.state);
  const counts = index?.groupCounts ?? new Map<string, number>();
  if (!index) for (const group of annotationGroups(editor.state.doc, annotationAnchors(editor.state.doc))) {
    counts.set(group.id, (counts.get(group.id) ?? 0) + 1);
  }
  return createPortal(<>{panels.map(panel => {
    const record = !panel.removed ? records.get(panel.id) : null;
    const bodyRecord = record ?? (panel.body ? { id: panel.id, pos: -1, node: panel.body } : panel.creation ? { id: panel.id, pos: -1, node: editor.schema.nodes.annotationBody.create({ id: panel.id }, editor.schema.nodes.paragraph.create()) } : null);
    if (!bodyRecord) return null;
    return <AnnotationPanel key={panel.id} editor={editor} record={bodyRecord} panel={panel} anchorCount={counts.get(panel.id) ?? 0} boundary={boundary}
      branch={hover.branch} onEnter={hover.contentProps.onPointerEnter} onFocus={hover.contentProps.onFocusCapture}
      onLeave={event => { if (!panel.pinned && !panel.editing) hover.leave(event); }}
      onChange={change => setPanels(current => current.map(item => item.id === panel.id ? { ...item, ...change } : item))}
      onClose={restore => { hover.cancel(); setPanels(current => current.filter(item => item.id !== panel.id));
        if (restore) { restoringFocus.current = true; if (panel.trigger?.isConnected) panel.trigger.focus(); else editor.view.focus(); restoringFocus.current = false; }
      }}/ >;
  })}</>, document.body);
}

function AnnotationPanel({ editor, record, panel, anchorCount, boundary, branch, onChange, onClose, onEnter, onFocus, onLeave }: {
  editor: Editor; record: AnnotationRecord; panel: PanelState; anchorCount: number; boundary(): AnnotationBoundary;
  branch: string; onChange(change: Partial<PanelState>): void; onClose(restore: boolean): void; onEnter(): void; onFocus(): void; onLeave(event: ReactPointerEvent<HTMLElement>): void;
}) {
  const element = useRef<HTMLDivElement>(null), draft = useRef<AnnotationDraftHandle | null>(null);
  const gesture = useRef<{ id: number; x: number; y: number; geometry: AnnotationGeometry; resize: boolean } | null>(null);
  const [error, setError] = useState('');
  const callbacks = useRef({ boundary, onChange }); callbacks.current = { boundary, onChange };
  const geometry = useRef(panel.geometry); geometry.current = panel.geometry;
  useLayoutEffect(() => {
    const constrain = () => {
      const node = element.current; if (!node) return;
      const bounds = callbacks.current.boundary();
      node.style.maxHeight = `${Math.max(80, bounds.height - 16)}px`;
      const current = geometry.current;
      const next = constrainAnnotationGeometry({ ...current, height: current.height ?? node.offsetHeight }, bounds);
      if (next.x !== current.x || next.y !== current.y || next.width !== current.width || (current.height !== undefined && next.height !== current.height)) {
        callbacks.current.onChange({ geometry: { ...next, ...(current.height === undefined ? { height: undefined } : {}) } });
      }
    };
    constrain();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(constrain);
    if (element.current) observer?.observe(element.current);
    window.addEventListener('resize', constrain); window.addEventListener('scroll', constrain, true);
    return () => { observer?.disconnect(); window.removeEventListener('resize', constrain); window.removeEventListener('scroll', constrain, true); };
  }, []);
  const start = (event: ReactPointerEvent<HTMLElement>, resize: boolean) => {
    if (!panel.pinned || event.button !== 0 || gesture.current || (event.target as Element).closest('button')) return;
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, resize,
      geometry: { ...panel.geometry, ...(resize ? { height: element.current?.offsetHeight ?? 240 } : {}) } };
  };
  const move = (event: ReactPointerEvent<HTMLElement>) => {
    const current = gesture.current; if (!current || current.id !== event.pointerId) return;
    const dx = event.clientX - current.x, dy = event.clientY - current.y;
    const next = current.resize ? { ...current.geometry, width: current.geometry.width + dx, height: current.geometry.height! + dy }
      : { ...current.geometry, x: current.geometry.x + dx, y: current.geometry.y + dy };
    onChange({ geometry: constrainAnnotationGeometry(next, boundary()) });
  };
  const end = (event: ReactPointerEvent<HTMLElement>, cancel: boolean) => {
    const current = gesture.current; if (!current || current.id !== event.pointerId) return;
    if (cancel) onChange({ geometry: current.geometry });
    gesture.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const pointerHandlers = { onPointerMove: move, onPointerUp: (event: ReactPointerEvent<HTMLElement>) => end(event, false), onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => end(event, true), onLostPointerCapture: () => { gesture.current = null; } };
  const save = () => {
    if (!draft.current) return;
    if (panel.removed) { setError('说明已被移除，无法保存。草稿已保留。'); return; }
    if (panel.creation) {
      const selection = resolveAnnotationTarget(panel.creation, editor.state.doc);
      if (!selection) { setError('原选区已删除，请重新选择正文。说明草稿已保留。'); return; }
      if (!addAnnotation(editor, draft.current.content(), { id: record.id, selection, open: false })) { setError('当前选区无法添加说明，请重新选择正文。说明草稿已保留。'); return; }
    } else if (!updateAnnotation(editor, record.id, draft.current.content())) { setError('说明已被移除，无法保存。'); return; }
    const saved = (annotationIndexKey.getState(editor.state)?.records ?? collectAnnotations(editor.state.doc)).get(record.id);
    setError(''); onChange({ editing: false, creation: undefined, body: saved?.node, position: saved?.pos });
    requestAnimationFrame(() => element.current?.querySelector<HTMLElement>('[data-annotation-edit]')?.focus());
  };
  const visibleError = error || (panel.removed ? '说明已被移除，无法保存。草稿已保留。' : panel.creation?.invalid ? '原选区已删除，请重新选择正文。说明草稿已保留。' : '');
  const deleteLabel = anchorCount > 1 ? `删除说明及全部 ${anchorCount} 处关联` : '移除说明';
  return <div ref={element} role="dialog" aria-label="补充说明" aria-modal="false" className="nb-annotation-panel" data-annotation-panel={record.id} data-shortcuts-suspended={panel.editing || undefined} data-nb-menu-branch={branch}
    data-annotation-editor-key={editorDocumentKey(editor)} data-annotation-target-from={panel.creation?.from} data-annotation-target-to={panel.creation?.to} data-annotation-target-invalid={panel.creation?.invalid || undefined}
    data-pinned={panel.pinned || undefined} style={{ left: panel.geometry.x, top: panel.geometry.y, width: panel.geometry.width, height: panel.geometry.height }}
    onPointerEnter={onEnter} onPointerLeave={onLeave} onFocus={onFocus}
    onKeyDownCapture={event => {
      if (panel.editing && event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.nativeEvent.isComposing && event.keyCode !== 229
        && event.target instanceof Element && event.target.closest('.nb-annotation-richtext')) {
        event.preventDefault(); event.stopPropagation(); save();
      }
    }}
    onKeyDown={event => {
      if (event.defaultPrevented || event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(true); }
    }}>
    <div className="nb-annotation-header" onPointerDown={event => start(event, false)} {...pointerHandlers}>
      <span className="nb-annotation-title">补充说明{anchorCount > 1 ? ` · ${anchorCount} 处共用` : ''}{panel.editing ? ' · 未保存草稿' : ''}</span>
      {panel.pinned && <span className="nb-annotation-move" role="button" tabIndex={0} aria-label="移动说明，使用方向键" onKeyDown={event => {
        if (!event.key.startsWith('Arrow')) return; event.preventDefault();
        const step = event.shiftKey ? 30 : 10;
        onChange({ geometry: constrainAnnotationGeometry({ ...panel.geometry,
          x: panel.geometry.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0),
          y: panel.geometry.y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0) }, boundary()) });
      }}><GripHorizontal size={14}/></span>}
      <div className="nb-annotation-actions">
        {!panel.creation && !panel.removed && <Tooltip content={deleteLabel}><button type="button" aria-label={deleteLabel} onClick={() => { removeAnnotation(editor, record.id); onClose(true); }}><Trash2 size={14}/></button></Tooltip>}
        {!panel.editing && <Tooltip content="编辑说明"><button type="button" aria-label="编辑说明" data-annotation-edit onClick={() => onChange({ editing: true })}><Pencil size={14}/></button></Tooltip>}
        <Tooltip content={panel.pinned ? '取消固定' : '固定说明'}><button type="button" aria-label={panel.pinned ? '取消固定' : '固定说明'} aria-pressed={panel.pinned}
          onClick={() => onChange({ pinned: !panel.pinned })}>{panel.pinned ? <PinOff size={14}/> : <Pin size={14}/>}</button></Tooltip>
        <Tooltip content={panel.editing ? '取消编辑' : '关闭说明'}><button type="button" aria-label={panel.editing ? '取消编辑' : '关闭说明'} onClick={() => onClose(true)}><X size={14}/></button></Tooltip>
      </div>
    </div>
    <div className="nb-annotation-scroll" data-editor-scroll><AnnotationBodyEditor editor={editor} body={record.node} editable={panel.editing} draft={draft}
      restoredDraft={annotationPanelSession(editor).draft(panel.id)} onDraftState={state => annotationPanelSession(editor).retainDraft(panel.id, state)}/></div>
    {panel.editing && <div className="nb-annotation-footer">
      <span className="nb-annotation-save-hint">Enter 保存 · Shift + Enter 换行</span>
      <button type="button" onClick={() => { setError(''); if (panel.creation || panel.removed) onClose(true); else onChange({ editing: false }); }}>取消</button>
      <button type="button" className="nb-annotation-save" onClick={save}><Check size={14}/>保存</button>
    </div>}
    {visibleError && <div role="alert" className="nb-annotation-error">{visibleError}{panel.creation && <button type="button" onClick={() => {
      if (!canAddAnnotation(editor)) { setError('请先在正文中选择要添加说明的文字或内容块。'); return; }
      setError(''); onChange({ creation: captureAnnotationTarget(editor.state.selection) });
    }}>使用当前选区</button>}</div>}
    {panel.pinned && <span className="nb-annotation-resize" role="button" tabIndex={0} aria-label="调整说明大小，使用方向键"
      onPointerDown={event => start(event, true)} {...pointerHandlers} onKeyDown={event => {
        if (!event.key.startsWith('Arrow')) return; event.preventDefault();
        const step = event.shiftKey ? 40 : 16;
        onChange({ geometry: constrainAnnotationGeometry({ ...panel.geometry,
          width: panel.geometry.width + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0),
          height: (panel.geometry.height ?? element.current?.offsetHeight ?? 240) + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0) }, boundary()) });
      }}/ >}
  </div>;
}
