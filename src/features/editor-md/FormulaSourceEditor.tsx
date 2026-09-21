import { useLayoutEffect, useRef, type KeyboardEvent } from 'react';

export function FormulaSourceEditor({ value, display, onChange, onKeyDown, onClose }: {
  value: string; display: boolean; onChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void; onClose: () => void;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const manualHeight = useRef(0);
  useLayoutEffect(() => {
    const element = input.current!;
    element.focus(); element.setSelectionRange(value.length, value.length);
  }, []);
  useLayoutEffect(() => {
    const element = input.current!;
    const update = () => {
      const line = Number.parseFloat(getComputedStyle(element).lineHeight) || 22;
      const maximum = Math.max(120, Math.min(window.innerHeight * .4, 480));
      element.style.height = '0px';
      element.style.height = `${Math.max(manualHeight.current, Math.min(maximum, Math.max((display ? 4 : 3) * line + 18, element.scrollHeight)))}px`;
    };
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
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onClose();
  }} style={{ width: '100%', padding: '8px 0 10px', boxSizing: 'border-box' }}>
    <textarea ref={input} value={value} aria-label={display ? '块公式源码' : '行内公式源码'} spellCheck={false}
      onChange={event => onChange(event.target.value)} onKeyDown={onKeyDown}
      onPointerUp={() => { manualHeight.current = input.current!.offsetHeight; }}
      style={{ display: 'block', boxSizing: 'border-box', width: '100%', minHeight: 90, maxHeight: '75vh', padding: '8px 10px',
        fontFamily: 'var(--mono-font-family)', fontSize: 'var(--mono-font-size)', lineHeight: 1.5,
        border: '1px solid var(--editor-accent)', borderRadius: 'var(--radius-sm)', resize: 'vertical',
        background: 'var(--editor-surface)', color: 'var(--editor-text)', outline: 'none' }}/>
    <div style={{ paddingTop: 4, fontSize: 11, color: 'var(--editor-text-muted)' }}>{display ? 'Enter 换行 · Ctrl+Enter 完成' : 'Enter 完成 · Shift+Enter 换行'}</div>
  </div>;
}
