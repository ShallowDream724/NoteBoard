import { useState, useEffect, useLayoutEffect, useRef, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { isDisplayMath, type MathDelimiter } from './mathSyntax';
import type { MathRendering } from './mathRendering';
import { observeNearby } from './nearViewport';
import { openEmbeddedEditor } from './embeddedEditor';
import { FormulaSourceEditor } from './FormulaSourceEditor';
import { queueMath } from './mathRenderQueue';

let nextTaskId = 0;

/** The document owns the draft, even while the source input has focus. */
export function MathNodeView({ node, editor, getPos, updateAttributes, selected }: NodeViewProps) {
  const block = node.type.name === 'mathBlock';
  const delimiter = (node.attrs.delimiter ?? (block ? '$$' : '$')) as MathDelimiter;
  const display = isDisplayMath(delimiter);
  const latex = String(node.attrs.latex ?? '');
  const [editing, setEditing] = useState(false);
  const [rendered, setRendered] = useState<MathRendering | null>(null);
  const [visible, setVisible] = useState(false);
  const viewportRef = useRef<HTMLSpanElement>(null);
  const [inputHost, setInputHost] = useState<HTMLElement | null>(null);
  const size = useRef<{ width: number; height: number } | null>(null);
  const versionRef = useRef(0);
  const identity = useRef<string | null>(null);
  identity.current ??= 'math:' + (++nextTaskId);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    return observeNearby(element, near => {
      if (!near && element.querySelector('.math-preview')) {
        const bounds = element.getBoundingClientRect();
        size.current = { width: bounds.width, height: bounds.height };
      }
      setVisible(near);
    });
  }, []);
  useEffect(() => {
    const selection = editor.state.selection;
    // TipTap also marks atoms selected when a text/all-document selection covers
    // them. Only an explicit node selection may move focus into formula source.
    if (selected && selection instanceof NodeSelection && selection.from === getPos()) setEditing(true);
  }, [selected, editor, getPos]);
  useLayoutEffect(() => {
    if (!editing) { setInputHost(null); return; }
    const pos = getPos();
    if (typeof pos !== 'number') return;
    const { host, close } = openEmbeddedEditor(editor, pos);
    setInputHost(host);
    return close;
  }, [editing, editor]);
  useEffect(() => {
    if (!visible && !editing) { setRendered(null); return; }
    const version = ++versionRef.current;
    const id = identity.current!;
    if (!latex.trim()) { setRendered(null); return; }
    const cancel = queueMath(id, { latex, display, done: result => {
        if (version === versionRef.current) setRendered(result);
    } });
    return () => { versionRef.current++; cancel(); };
  }, [latex, display, visible, editing]);

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
      editor.commands.keyboardShortcut(event.shiftKey || event.key.toLowerCase() === 'y' ? 'Mod-Shift-z' : 'Mod-z');
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
        background: selected && !editing ? 'var(--editor-selection-background)' : undefined,
      }}
      onClick={() => { setVisible(true); setEditing(true); }}
    >
      {editing && inputHost && createPortal(<FormulaSourceEditor value={latex} display={display}
        onChange={value => updateAttributes({ latex: value })} onKeyDown={handleKey} onClose={() => setEditing(false)}/>, inputHost)}
      <span ref={viewportRef} title={editing ? undefined : '点击编辑公式'}
        style={{ display: display ? 'block' : 'inline-block', overflowWrap: 'anywhere',
          ...(!rendered && !visible && !editing && size.current ? { width: size.current.width, height: size.current.height } : {}) }}>
        {rendered?.html && latex.trim()
          ? <span className="math-preview" dangerouslySetInnerHTML={{ __html: rendered.html }} />
          : !visible && !editing && size.current ? null : <span style={{ color: 'var(--editor-text-muted)' }}>{latex || (editing ? '输入 LaTeX 公式' : '点击输入公式')}</span>}
        {rendered?.error && latex.trim() && (
          <span role="status" style={{ display: 'block', fontSize: 12, color: 'var(--error-500)', whiteSpace: 'pre-wrap' }}>
            {rendered.error}
          </span>
        )}
      </span>
    </NodeViewWrapper>
  );
}
