import { useState, useEffect, useLayoutEffect, useRef, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { TextSelection } from '@tiptap/pm/state';
import { dispatchEditorShortcut } from './dispatchEditorShortcut';
import { isDisplayMath, writeMath, type MathDelimiter } from './mathSyntax';
import { openEmbeddedEditor } from './embeddedEditor';
import { FormulaSourceEditor } from './FormulaSourceEditor';
import { mountMathPreview, type MathPreviewController } from './mathPreview';
import { useSettingsStore } from '../../stores/settingsStore';

/** The document owns the draft, even while the source input has focus. */
export function MathNodeView({ node, editor, getPos, updateAttributes, selected }: NodeViewProps) {
  const enabled = useSettingsStore(state => state.settings.editor.enableMath);
  const block = node.type.name === 'mathBlock';
  const delimiter = (node.attrs.delimiter ?? (block ? '$$' : '$')) as MathDelimiter;
  const display = isDisplayMath(delimiter);
  const latex = String(node.attrs.latex ?? '');
  const [editing, setEditing] = useState(false);
  const viewportRef = useRef<HTMLSpanElement>(null);
  const previewRef = useRef<MathPreviewController | null>(null);
  const [inputHost, setInputHost] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!editing) { setInputHost(null); return; }
    const pos = getPos();
    if (typeof pos !== 'number') return;
    const { host, close } = openEmbeddedEditor(editor, pos);
    setInputHost(host);
    return close;
  }, [editing, editor]);
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

  const exit = () => {
    setEditing(false);
    const pos = getPos();
    if (typeof pos !== 'number') return;
    editor.chain().focus().command(({ tr }) => {
      const after = pos + node.nodeSize;
      if (block && after === tr.doc.content.size) tr.insert(after, editor.schema.nodes.paragraph.create());
      tr.setSelection(TextSelection.near(tr.doc.resolve(after), 1));
      return true;
    }).run();
  };

  const handleKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if ((event.key === 'Backspace' || event.key === 'Delete') && !latex.trim()) {
      event.preventDefault(); event.stopPropagation();
      const pos = getPos();
      if (typeof pos !== 'number') return;
      setEditing(false);
      editor.chain().focus().command(({ tr }) => {
        tr.delete(pos, pos + node.nodeSize);
        tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(pos, tr.doc.content.size)), -1));
        return true;
      }).run();
      return;
    }
    const control = event.ctrlKey || event.metaKey;
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
      className={'math-node' + (display ? ' math-node-display' : '')}
      data-math-delimiter={delimiter}
      contentEditable={false}
      style={{
        display: display ? 'block' : 'inline-block', maxWidth: '100%', verticalAlign: 'baseline',
        padding: display ? '8px 0' : '0 2px', borderRadius: 'var(--radius-sm)',
        color: node.attrs.textColor || undefined,
        background: node.attrs.background || undefined,
        boxShadow: selected && !editing ? '0 0 0 2px var(--editor-selection-background)' : undefined,
      }}
      onClick={() => setEditing(true)}
    >
      {editing && inputHost && createPortal(<FormulaSourceEditor value={latex} display={display}
        onChange={value => updateAttributes({ latex: value })} onKeyDown={handleKey} onClose={() => setEditing(false)}/>, inputHost)}
      <span ref={viewportRef} title={editing ? undefined : '点击编辑公式'}
        style={{ display: display ? 'block' : 'inline-block', overflowWrap: 'anywhere', whiteSpace: enabled ? undefined : 'pre-wrap', fontFamily: enabled ? undefined : 'var(--mono-font-family)' }}/>
    </NodeViewWrapper>
  );
}
