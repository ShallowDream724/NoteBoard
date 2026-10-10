import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { Editor } from '@tiptap/core';
import { TextSelection, type Selection, type SelectionBookmark, type Transaction } from '@tiptap/pm/state';
import * as Popover from '@radix-ui/react-popover';
import { ArrowRight, ChevronDown, ChevronRight, ListRestart } from 'lucide-react';
import { OrderedListIcon } from '../../../components/OrderedListIcon';
import { Tooltip } from '../../../components/Tooltip';
import { HoverMenuContext, useHoverMenu } from '../../../components/useHoverMenu';
import { useEditorMenuPortalContainer } from '../../../components/EditorMenuScope';
import { selectBlock } from '../blockActions';
import { continueNumbering, createNumberingDraft, getNumberingContext, setNumberingStyle } from './numbering';
import { formatNumbering, NUMBERING_STYLES, type NumberingStyle } from './styles';
import { validStart as isValidNumberingStart } from './model';
import './numberingControl.css';
import { NUMBERING_OPERATION } from './extension';

type NumberingContext = ReturnType<typeof getNumberingContext>;

/** A block handle is an implicit row target; an intersecting text range stays explicit. */
export function prepareNumberingTarget(editor: Editor, pos?: number) {
  if (pos == null) return;
  const selection = editor.state.selection, node = editor.state.doc.nodeAt(pos);
  if (node && selection instanceof TextSelection && !selection.empty
    && selection.from < pos + node.nodeSize && selection.to > pos) return;
  selectBlock(editor, pos);
}

function ContinuePreview({ context }: { context: NumberingContext }) {
  const previousStyle = context.previousStyle ?? context.style;
  return <div className="nb-numbering-preview" role="tooltip" aria-label="继续编号预览">
    <div className="nb-numbering-preview-label">接续上方列表</div>
    <div className="nb-numbering-preview-line" data-numbering-style={previousStyle}><span>{formatNumbering((context.next ?? 2) - 1, previousStyle)}</span><p>{context.previousText || '空列表项'}</p></div>
    <div className="nb-numbering-preview-join"><ArrowRight size={12}/></div>
    <div className="nb-numbering-preview-line is-current" data-numbering-style={context.style}><span>{formatNumbering(context.next ?? 1, context.style)}</span><p>{context.currentText || '空列表项'}</p></div>
  </div>;
}

function ContinueNumberingAction({ context, onApply, quick = false }: {
  context: NumberingContext; onApply: () => void; quick?: boolean;
}) {
  const [preview, setPreview] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const portal = useEditorMenuPortalContainer();
  const hide = () => { clearTimeout(timer.current); setPreview(false); };
  useEffect(() => () => clearTimeout(timer.current), []);
  return <Popover.Root open={preview} onOpenChange={setPreview} modal={false}>
    <Popover.Anchor asChild><button type="button" role="menuitem" className={`nb-numbering-row${quick ? ' nb-numbering-quick' : ''}`}
      disabled={!context.canContinue} onClick={() => { hide(); onApply(); }}
      onPointerEnter={event => { if (context.canContinue && event.pointerType !== 'touch') timer.current = setTimeout(() => setPreview(true), 500); }}
      onPointerLeave={hide} onBlur={hide}>
      {quick && <ListRestart size={16}/>}<span>继续编号</span>
      {context.next != null && <span className="nb-numbering-row-hint">从 {context.next} 继续</span>}
    </button></Popover.Anchor>
    <Popover.Portal container={portal}><Popover.Content className="nb-numbering-preview-popover" side="right" align="start" sideOffset={8} collisionPadding={12}
      onOpenAutoFocus={event => event.preventDefault()} onCloseAutoFocus={event => event.preventDefault()}
      onPointerDown={event => event.preventDefault()} onInteractOutside={event => event.preventDefault()}>
      <ContinuePreview context={context}/>
    </Popover.Content></Popover.Portal>
  </Popover.Root>;
}

function NumberingStyleMenu({ style, onChoose }: { style: NumberingStyle; onChoose: (style: NumberingStyle) => void }) {
  const [open, setOpen] = useState(false);
  const hover = useHoverMenu(open, setOpen, false, false);
  const portal = useEditorMenuPortalContainer();
  return <Popover.Root modal={false} open={open} onOpenChange={hover.change}>
    <Popover.Trigger {...hover.triggerProps} className="nb-numbering-row nb-numbering-style-trigger" aria-label="编号样式" aria-haspopup="menu">
      <span>编号样式</span><span className="nb-numbering-style-current">{formatNumbering(1, style)}</span><ChevronRight size={13}/>
    </Popover.Trigger>
    <Popover.Portal container={portal}><Popover.Content role="menu" aria-label="编号样式" className="nb-numbering-style-menu" side="right" align="start" sideOffset={5} collisionPadding={10}
      {...hover.contentProps} onOpenAutoFocus={hover.onOpenAutoFocus} onCloseAutoFocus={hover.onCloseAutoFocus}
      onPointerDown={event => { event.preventDefault(); event.stopPropagation(); }} onMouseDown={event => event.stopPropagation()}>
      <HoverMenuContext.Provider value={hover}>
        {NUMBERING_STYLES.map(option => <button type="button" role="menuitemradio" aria-checked={style === option.value} key={option.value}
          aria-label={option.label} title={option.label} onClick={() => { onChoose(option.value); setOpen(false); }}>
          <span className="nb-numbering-style-sample" data-numbering-style={option.value} aria-hidden="true">{[1, 2, 3].map(value => <span key={value}><b>{formatNumbering(value, option.value)}</b><i/></span>)}</span>
        </button>)}
      </HoverMenuContext.Provider>
    </Popover.Content></Popover.Portal>
  </Popover.Root>;
}

export interface NumberingControlProps {
  editor: Editor | null;
  disabled?: boolean;
  active?: boolean;
  onToggle: () => void;
  targetPos?: number;
  targetSelection?: Selection;
  variant?: 'toolbar' | 'block' | 'overflow';
  onDone?: () => void;
  isCurrentTarget?: () => boolean;
  collapsePriority?: number;
  overflowId?: string;
}

/** Shared top/block/overflow UI. The command layer alone owns list scope and history. */
export function NumberingControl({ editor, disabled, active, onToggle, targetPos, targetSelection, variant = 'toolbar', onDone, isCurrentTarget }: NumberingControlProps) {
  const [open, setOpen] = useState(false);
  const [context, setContext] = useState<NumberingContext | null>(null);
  const [start, setStart] = useState('1');
  const draft = useRef<ReturnType<typeof createNumberingDraft> | null>(null);
  const selection = useRef<SelectionBookmark | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const portal = useEditorMenuPortalContainer();
  const finishDraft = (cancel = false) => {
    const current = draft.current; draft.current = null;
    if (!current) return;
    if (cancel) current.cancel(); else current.commit();
    current.destroy();
    // List splitting may replace a whole list node. The command layer restores
    // logical item/text offsets more accurately than a plain bookmark mapping.
    if (editor && !editor.isDestroyed) selection.current = editor.state.selection.getBookmark();
  };
  const changeOpen = (next: boolean) => {
    if (next && (!editor || disabled || isCurrentTarget?.() === false)) return;
    if (next && !open && editor) {
      if (targetSelection) {
        if (targetSelection.$from.doc !== editor.state.doc) return;
        if (!editor.state.selection.eq(targetSelection)) editor.view.dispatch(editor.state.tr.setSelection(targetSelection).setMeta('addToHistory', false));
      }
      prepareNumberingTarget(editor, targetPos);
      selection.current = editor.state.selection.getBookmark();
      setContext(getNumberingContext(editor));
      setStart('1');
    }
    if (!next) finishDraft();
    setOpen(next);
  };
  const hover = useHoverMenu(open, changeOpen, disabled || !editor);
  useEffect(() => {
    if (!open || !editor) return;
    const map = ({ transaction }: { transaction: Transaction }) => {
      if (draft.current && transaction.docChanged && !transaction.getMeta(NUMBERING_OPERATION)) {
        finishDraft(); setOpen(false); return;
      }
      if (selection.current) selection.current = draft.current ? transaction.selection.getBookmark() : selection.current.map(transaction.mapping);
    };
    editor.on('transaction', map);
    return () => { editor.off('transaction', map); };
  }, [editor, open]);
  useEffect(() => () => { const current = draft.current; draft.current = null; current?.commit(); current?.destroy(); }, [editor]);
  const restoreSelection = () => {
    if (!editor || editor.isDestroyed || isCurrentTarget?.() === false) return false;
    if (selection.current) editor.view.dispatch(editor.state.tr.setSelection(selection.current.resolve(editor.state.doc)).setMeta('addToHistory', false));
    return true;
  };
  const done = () => { changeOpen(false); editor?.view.dom.focus({ preventScroll: true }); onDone?.(); };
  const apply = (action: (editor: Editor) => unknown) => {
    finishDraft();
    if (editor && restoreSelection()) action(editor);
    done();
  };
  const validStart = start !== '' && isValidNumberingStart(Number(start));
  const restart = () => {
    if (!editor || !context?.available || !validStart) return;
    if (!draft.current) { if (!restoreSelection()) return; draft.current = createNumberingDraft(editor); }
    if (draft.current.update(Number(start))) done();
  };
  const inputKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { finishDraft(); return; }
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); finishDraft(true); done(); }
    if (event.key === 'Enter') { event.preventDefault(); restart(); }
  };
  return <Popover.Root modal={false} open={open} onOpenChange={hover.change}>
    <div className={`nb-numbering-control nb-numbering-control-${variant}`} data-active={active || undefined}>
      <Tooltip content="有序列表" shortcut="Ctrl+Shift+7" helpKey="list.ordered" disabled={disabled || open} side={variant === 'block' ? 'right' : 'bottom'}>
        <button type="button" className="nb-numbering-main" aria-label="有序列表" aria-pressed={active} disabled={disabled}
          onPointerEnter={hover.keepAlive} onPointerLeave={hover.leave}
          onPointerDown={event => { event.preventDefault(); event.stopPropagation(); }}
          onClick={event => { event.stopPropagation(); changeOpen(false); onToggle(); }}><OrderedListIcon size={18}/>{variant === 'overflow' && <span>有序列表</span>}</button>
      </Tooltip>
      {editor && <Popover.Trigger {...hover.triggerProps} className="nb-numbering-arrow" aria-label="有序列表选项" aria-haspopup="menu" disabled={disabled}>
        <ChevronDown className="nb-menu-chevron" size={11}/>
      </Popover.Trigger>}
    </div>
    <Popover.Portal container={portal}><Popover.Content role="menu" aria-label="有序列表选项" className="nb-numbering-menu" side={variant === 'block' || variant === 'overflow' ? 'right' : 'bottom'} align="start" sideOffset={6} collisionPadding={10}
      {...hover.contentProps} onPointerLeave={() => { if (document.activeElement !== input.current) hover.leave(); }}
      onPointerDown={event => { event.stopPropagation(); if (!(event.target instanceof HTMLInputElement)) event.preventDefault(); }}
      onMouseDown={event => event.stopPropagation()} onOpenAutoFocus={hover.onOpenAutoFocus} onCloseAutoFocus={event => event.preventDefault()}
      onEscapeKeyDown={event => { event.preventDefault(); finishDraft(true); done(); }}>
      <HoverMenuContext.Provider value={hover}>
        {context && <>
          <ContinueNumberingAction context={context} onApply={() => apply(continueNumbering)}/>
          <div className={`nb-numbering-row nb-numbering-restart${!context.available ? ' is-disabled' : ''}`} role="group" aria-label="重新编号">
            <span>从</span><input ref={input} type="number" min="1" step="1" aria-label="重新编号起始值" aria-invalid={start !== '' && !validStart || undefined} value={start} disabled={!context.available}
              onFocus={() => { hover.keepAlive(); hover.keyboard.current = true; }} onKeyDown={inputKey}
              onChange={event => {
                const value = event.target.value; setStart(value);
                const number = Number(value);
                if (!value || !isValidNumberingStart(number) || !editor) return;
                if (!draft.current) { if (!restoreSelection()) return; draft.current = createNumberingDraft(editor); }
                draft.current.update(number);
              }}/><button type="button" onClick={restart} disabled={!context.available || !validStart}>重新编号</button>
          </div>
          {context.available ? <NumberingStyleMenu style={context.style} onChoose={style => apply(next => setNumberingStyle(next, style))}/>
            : <button type="button" className="nb-numbering-row" disabled><span>编号样式</span><ChevronRight size={13}/></button>}
        </>}
      </HoverMenuContext.Provider>
    </Popover.Content></Popover.Portal>
  </Popover.Root>;
}

/** The block menu exposes only the useful quick action; other options live in the split button. */
export function BlockContinueNumbering({ editor, pos, close }: { editor: Editor; pos: number; close: () => void }) {
  const context = useMemo(() => getNumberingContext(editor, pos), [editor, pos]);
  if (!context.canContinue || context.start === context.next) return null;
  return <ContinueNumberingAction context={context} quick onApply={() => {
    prepareNumberingTarget(editor, pos); continueNumbering(editor); editor.view.dom.focus({ preventScroll: true }); close();
  }}/>;
}
