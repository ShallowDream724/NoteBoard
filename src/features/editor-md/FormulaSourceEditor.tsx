import { useLayoutEffect, useRef, type KeyboardEvent } from 'react';
import { useNativeSourceInput, useInlineSourceInput } from './useNativeSourceInput';
import { readSourceText, readSourceSelection, replaceSourceSelection, writeSourceSelection } from './nativeSourceDom';
import { mathClosingDelimiter, type MathDelimiter } from './mathSyntax';
import './formulaSourceEditor.css';

interface SourceEditorProps {
  value: string; display: boolean; onChange: (value: string) => void;
  delimiter?: MathDelimiter;
  initialSelection?: { anchor: number; head: number };
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void; onClose: () => void;
}

function InlineFormulaSource({ value, delimiter = '$', initialSelection, onChange, onKeyDown, onClose }: SourceEditorProps) {
  const pendingBlur = useRef(false);
  const { input, composing, inputProps, publish } = useInlineSourceInput({ value, onChange, onCompositionCommit: () => {
    if (pendingBlur.current && document.activeElement !== input.current) onClose();
    pendingBlur.current = false;
  } });
  useLayoutEffect(() => {
    const element = input.current!;
    element.focus();
    writeSourceSelection(element, initialSelection ?? { anchor: value.length, head: value.length });
  }, []);
  return <span className="formula-source-editor formula-source-inline" onBlur={event => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    if (composing.current) pendingBlur.current = true;
    else onClose();
  }}>
    <span className="formula-source-delimiter" aria-hidden="true">{delimiter}</span>
    <span {...inputProps} className="formula-source-text" contentEditable="plaintext-only" suppressContentEditableWarning
      role="textbox" aria-label="行内公式源码" aria-multiline="true" spellCheck={false} data-shortcuts-suspended tabIndex={0}
      onFocus={() => { pendingBlur.current = false; }}
      onPaste={event => {
        event.preventDefault();
        if (!composing.current) publish(replaceSourceSelection(event.currentTarget, event.clipboardData.getData('text/plain')));
      }}
      onKeyDown={event => {
        if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
        onKeyDown(event);
        if (event.defaultPrevented) return;
        const element = event.currentTarget, text = readSourceText(element), selection = readSourceSelection(element);
        const control = event.ctrlKey || event.metaKey;
        // Native Home/End and Select All can escape a nested inline editing
        // host into the surrounding paragraph. Keep source navigation local.
        if (control && event.key.toLowerCase() === 'a') {
          event.preventDefault(); writeSourceSelection(element, { anchor: 0, head: text.length }); return;
        }
        if ((event.key === 'Home' || event.key === 'End') && !event.altKey) {
          event.preventDefault();
          const end = text.indexOf('\n', selection.head);
          const head = event.key === 'Home' ? (control ? 0 : text.lastIndexOf('\n', selection.head - 1) + 1)
            : control || end === -1 ? text.length : end;
          writeSourceSelection(element, { anchor: event.shiftKey ? selection.anchor : head, head }); return;
        }
        if (selection.anchor === selection.head && ((event.key === 'Backspace' && selection.head === 0)
          || (event.key === 'Delete' && selection.head === text.length))) event.preventDefault();
        if (event.key === 'Enter' && event.shiftKey && !event.ctrlKey && !event.metaKey) {
          event.preventDefault(); publish(replaceSourceSelection(event.currentTarget, '\n')); return;
        }
      }}/>
    <span className="formula-source-delimiter" aria-hidden="true">{mathClosingDelimiter(delimiter)}</span>
  </span>;
}

function BlockFormulaSource({ value, initialSelection, onChange, onKeyDown, onClose }: SourceEditorProps) {
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
  }, [value]);
  return <div className="formula-source-editor formula-source-display" onBlur={event => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    if (composing.current) pendingBlur.current = true;
    else onClose();
  }}>
    <textarea {...inputProps} aria-label="块公式源码" spellCheck={false} data-shortcuts-suspended rows={4}
      onFocus={() => { pendingBlur.current = false; }}
      onKeyDown={event => {
        if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
        onKeyDown(event);
      }}
      onPointerUp={() => { manualHeight.current = input.current!.offsetHeight; }}/>
    <div className="formula-source-hint">Enter 换行 · Ctrl+Enter 完成</div>
  </div>;
}

export function FormulaSourceEditor(props: SourceEditorProps) {
  return props.display ? <BlockFormulaSource {...props}/> : <InlineFormulaSource {...props}/>;
}
