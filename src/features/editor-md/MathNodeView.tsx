import { useState, useEffect, useLayoutEffect, useRef, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { TextSelection } from '@tiptap/pm/state';
import { dispatchEditorShortcut } from './dispatchEditorShortcut';
import { isDisplayMath, writeMath, type MathDelimiter } from './mathSyntax';
import { openEmbeddedEditor } from './embeddedEditor';
import { FormulaSourceEditor } from './FormulaSourceEditor';
import { consumeMathEditingRequest } from './mathEditingRequest';
import { mountMathPreview, type MathPreviewController } from './mathPreview';
import { positionInlineMathPreview } from './positionInlineMathPreview';
import { useSettingsStore } from '../../stores/settingsStore';
import { readSourceSelection, readSourceText } from './nativeSourceDom';
import '../../core/math/alignment.css';

/** The document owns committed source; the native input owns only an IME preedit. */
export function MathNodeView({ node, editor, getPos, updateAttributes, selected }: NodeViewProps) {
  const enabled = useSettingsStore(state => state.settings.editor.enableMath);
  const block = node.type.name === 'mathBlock';
  const delimiter = (node.attrs.delimiter ?? (block ? '$$' : '$')) as MathDelimiter;
  const display = isDisplayMath(delimiter);
  const latex = String(node.attrs.latex ?? '');
  const [editing, setEditing] = useState(false);
  const [initialSelection, setInitialSelection] = useState<{ anchor: number; head: number }>();
  const seenSelection = useRef(false);
  const alignment = block && ['left', 'center', 'right'].includes(node.attrs.textAlign) ? node.attrs.textAlign : 'center';
  const viewportRef = useRef<HTMLSpanElement>(null);
  const inlineInputRef = useRef<HTMLSpanElement>(null);
  const previewRef = useRef<MathPreviewController | null>(null);
  const [inputHost, setInputHost] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const pos = getPos();
    if (typeof pos !== 'number') return;
    const request = consumeMathEditingRequest(editor, pos);
    if (!request) return;
    setInitialSelection(request);
    setEditing(true);
  });
  useLayoutEffect(() => {
    if (!editing) { setInputHost(null); return; }
    const pos = getPos();
    if (typeof pos !== 'number') return;
    const { host, close } = openEmbeddedEditor(editor, pos, display ? undefined : inlineInputRef.current ?? undefined);
    setInputHost(host);
    return close;
  }, [editing, editor, display]);
  useEffect(() => {
    const host = viewportRef.current;
    if (!host) return;
    if (!enabled) {
      host.textContent = writeMath({ latex, delimiter }, block);
      return () => host.replaceChildren();
    }
    const preview = mountMathPreview(host, latex, display, false, editor.view.dom);
    previewRef.current = preview;
    // Source changes replace the controller on the same connected host. Keep
    // its last measured geometry while the new formula is being prepared.
    return () => { previewRef.current = null; preview.dispose(host.isConnected); };
  }, [enabled, latex, delimiter, block, display, editor]);
  // Focus changes are priority changes, not a new formula or DOM lifetime.
  useEffect(() => { previewRef.current?.setEditing(editing); });
  useLayoutEffect(() => {
    const preview = viewportRef.current;
    if (!editing || display || !preview) return;
    return positionInlineMathPreview(preview);
  }, [editing, display]);
  // New empty blocks have a node selection; opening this transient editor adds
  // no document or history step.
  useEffect(() => {
    if (!selected) { seenSelection.current = false; return; }
    if (seenSelection.current) return;
    seenSelection.current = true;
    if (block && !latex) {
      // TipTap's focus command runs in the next frame. Queue behind it so the
      // source textarea keeps focus after toolbar/slash insertion.
      const frame = requestAnimationFrame(() => setEditing(true));
      return () => cancelAnimationFrame(frame);
    }
  }, [block, selected, latex]);

  const exit = () => {
    setEditing(false);
    const pos = getPos();
    if (typeof pos !== 'number') return;
    const tr = editor.state.tr, after = pos + node.nodeSize;
    if (block && after === tr.doc.content.size) tr.insert(after, editor.schema.nodes.paragraph.create());
    tr.setSelection(TextSelection.near(tr.doc.resolve(after), 1));
    editor.view.dispatch(tr);
    // Hand focus back in the same key event. A queued focus leaves a gap after
    // the textarea unmounts and can drop the user's next fast keystrokes.
    editor.view.focus();
  };

  const handleKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if ((event.key === 'Backspace' || event.key === 'Delete') && !latex.trim()) {
      event.preventDefault(); event.stopPropagation();
      const pos = getPos();
      if (typeof pos !== 'number') return;
      setEditing(false);
      const tr = editor.state.tr.delete(pos, pos + node.nodeSize);
      tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(pos, tr.doc.content.size)), -1));
      editor.view.dispatch(tr);
      editor.view.focus();
      return;
    }
    const control = event.ctrlKey || event.metaKey;
    const caret = readSourceSelection(event.currentTarget);
    if (!display && event.key === 'ArrowRight' && !event.shiftKey && !event.altKey && !control
      && caret.anchor === caret.head && caret.head === readSourceText(event.currentTarget).length) {
      event.preventDefault(); event.stopPropagation(); exit();
      return;
    }
    if (control && ['z', 'y'].includes(event.key.toLowerCase())) {
      event.preventDefault(); event.stopPropagation();
      dispatchEditorShortcut(editor.view, event.shiftKey || event.key.toLowerCase() === 'y' ? 'Ctrl+Shift+Z' : 'Ctrl+Z');
      return;
    }
    if (event.key === 'Escape' || (event.key === 'Enter' && (control || (!display && !event.shiftKey)))) {
      event.preventDefault(); event.stopPropagation(); exit();
    }
  };

  return (
    <NodeViewWrapper
      as={block ? 'div' : 'span'}
      className={'math-node' + (display ? ' math-node-display' : '') + (editing ? ' math-node-editing' : '')}
      data-math-delimiter={delimiter}
      data-math-align={block ? alignment : undefined}
      contentEditable={false}
      style={{
        display: display ? 'block' : editing ? 'inline' : 'inline-block', width: block ? '100%' : undefined, boxSizing: 'border-box', maxWidth: '100%', verticalAlign: 'baseline',
        padding: display ? (editing ? '0 10px 8px' : '8px 10px') : '0 2px', borderRadius: 'var(--radius-sm)', textAlign: block ? alignment : undefined,
        color: node.attrs.textColor || undefined,
        background: node.attrs.background || undefined,
        boxShadow: selected && !editing ? '0 0 0 2px var(--editor-selection-background)' : undefined,
      }}
      onClick={() => { if (!editing) setInitialSelection(undefined); setEditing(true); }}
    >
      {editing && !display && <span ref={inlineInputRef} className="embedded-source-editor embedded-source-inline" data-editor-control="true"/>}
      {editing && inputHost && createPortal(<FormulaSourceEditor value={latex} display={display} delimiter={delimiter} initialSelection={initialSelection}
        onChange={value => updateAttributes({ latex: value })} onKeyDown={handleKey} onClose={() => setEditing(false)}/>, inputHost)}
      <span ref={viewportRef} className="math-node-preview" title={editing ? undefined : '点击编辑公式'}
        style={{ display: display ? 'block' : 'inline-block', overflowWrap: 'anywhere', whiteSpace: enabled ? undefined : 'pre-wrap', fontFamily: enabled ? undefined : 'var(--mono-font-family)' }}/>
    </NodeViewWrapper>
  );
}
