import { useLayoutEffect, useRef, type KeyboardEvent } from 'react';
import { useNativeSourceInput } from './useNativeSourceInput';

export function FormulaSourceEditor({ value, display, initialSelection, onChange, onKeyDown, onClose }: {
  value: string; display: boolean; onChange: (value: string) => void;
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
    const element = input.current!;
    const update = () => {
      if (composing.current) return;
      const line = Number.parseFloat(getComputedStyle(element).lineHeight) || 22;
      const maximum = Math.max(120, Math.min(window.innerHeight * .4, 480));
      element.style.height = '0px';
      element.style.height = `${Math.max(manualHeight.current, Math.min(maximum, Math.max((display ? 4 : 3) * line + 18, element.scrollHeight)))}px`;
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
  return <div onBlur={event => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    if (composing.current) pendingBlur.current = true;
    else onClose();
  }} style={{ width: '100%', padding: '8px 0 10px', boxSizing: 'border-box' }}>
    <textarea {...inputProps} aria-label={display ? '块公式源码' : '行内公式源码'} spellCheck={false} data-shortcuts-suspended
      onFocus={() => { pendingBlur.current = false; }}
      onKeyDown={event => {
        if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
        onKeyDown(event);
      }}
      onPointerUp={() => { manualHeight.current = input.current!.offsetHeight; }}
      style={{ display: 'block', boxSizing: 'border-box', width: '100%', minHeight: 90, maxHeight: '75vh', padding: '8px 10px',
        fontFamily: 'var(--mono-font-family)', fontSize: 'var(--mono-font-size)', lineHeight: 1.5,
        border: '1px solid var(--editor-accent)', borderRadius: 'var(--radius-sm)', resize: 'vertical',
        background: 'var(--editor-surface)', color: 'var(--editor-text)', outline: 'none' }}/>
    <div style={{ paddingTop: 4, fontSize: 11, color: 'var(--editor-text-muted)' }}>{display ? 'Enter 换行 · Ctrl+Enter 完成' : 'Enter 完成 · Shift+Enter 换行'}</div>
  </div>;
}
