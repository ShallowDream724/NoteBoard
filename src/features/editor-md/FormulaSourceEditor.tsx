import { useLayoutEffect, useRef, type KeyboardEvent } from 'react';
import { useNativeSourceInput } from './useNativeSourceInput';
import { mathClosingDelimiter, type MathDelimiter } from './mathSyntax';
import './formulaSourceEditor.css';

export function FormulaSourceEditor({ value, display, delimiter = '$', initialSelection, onChange, onKeyDown, onClose }: {
  value: string; display: boolean; onChange: (value: string) => void;
  delimiter?: MathDelimiter;
  initialSelection?: { anchor: number; head: number };
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void; onClose: () => void;
}) {
  const pendingBlur = useRef(false);
  const manualHeight = useRef(0);
  const resize = useRef<() => void>(() => {});
  const { input, composing, inputProps } = useNativeSourceInput({ value, onChange, onCompositionCommit: changed => {
    if (!changed) resize.current();
    if (pendingBlur.current && document.activeElement !== input.current) onClose();
    pendingBlur.current = false;
  } });
  useLayoutEffect(() => {
    const element = input.current!;
    const anchor = initialSelection?.anchor ?? value.length, head = initialSelection?.head ?? anchor;
    element.focus();
    element.setSelectionRange(Math.min(anchor, head), Math.max(anchor, head), anchor > head ? 'backward' : 'forward');
  }, []);
  useLayoutEffect(() => {
    if (!display) { resize.current = () => {}; return; }
    const element = input.current!;
    const update = () => {
      if (composing.current) return;
      const line = Number.parseFloat(getComputedStyle(element).lineHeight) || 22;
      const maximum = Math.max(120, Math.min(window.innerHeight * .4, 480));
      element.style.height = '0px';
      element.style.height = `${Math.max(manualHeight.current, Math.min(maximum, Math.max(4 * line + 18, element.scrollHeight)))}px`;
    };
    resize.current = update;
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width ?? 0;
      if (width !== previousWidth) { previousWidth = width; update(); }
    });
    let previousWidth = element.clientWidth;
    observer.observe(element);
    return () => observer.disconnect();
  }, [value, display]);
  const Wrapper = display ? 'div' : 'span';
  return <Wrapper className={`formula-source-editor ${display ? 'formula-source-display' : 'formula-source-inline'}`} onBlur={event => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    if (composing.current) pendingBlur.current = true;
    else onClose();
  }}>
    {!display && <span className="formula-source-delimiter formula-source-opening" aria-hidden="true">{delimiter}</span>}
    {!display && <span className="formula-source-measure" aria-hidden="true">{value || ' '}{'\u200b'}</span>}
    <textarea {...inputProps} aria-label={display ? '块公式源码' : '行内公式源码'} spellCheck={false} data-shortcuts-suspended rows={display ? 4 : 1}
      onFocus={() => { pendingBlur.current = false; }}
      onKeyDown={event => {
        if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
        onKeyDown(event);
      }}
      onPointerUp={display ? () => { manualHeight.current = input.current!.offsetHeight; } : undefined}/>
    {!display && <span className="formula-source-delimiter formula-source-closing" aria-hidden="true">{mathClosingDelimiter(delimiter)}</span>}
    {display && <div className="formula-source-hint">Enter 换行 · Ctrl+Enter 完成</div>}
  </Wrapper>;
}
