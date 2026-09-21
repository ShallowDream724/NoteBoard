import { useState, useEffect, useRef, type FocusEvent } from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { TextSelection } from '@tiptap/pm/state';
import { isDisplayMath, type MathDelimiter } from './mathSyntax';
import { renderMath, type MathRendering } from './mathRendering';
import { observe } from './viewportActivation';
import { cancelTask, scheduleTask } from './viewportWorkScheduler';

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
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const versionRef = useRef(0);
  const identity = useRef<string | null>(null);
  identity.current ??= 'math:' + (++nextTaskId);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    return observe(element, () => setVisible(true), { once: true });
  }, []);
  useEffect(() => { if (selected) setEditing(true); }, [selected]);
  useEffect(() => {
    if (editing) {
      const input = inputRef.current;
      input?.focus();
      if (input) input.setSelectionRange(input.value.length, input.value.length);
    }
  }, [editing]);
  useEffect(() => {
    if (!visible && !editing) return;
    const version = ++versionRef.current;
    const id = identity.current!;
    scheduleTask(id, () => {
      if (!latex.trim()) { setRendered(null); return; }
      void renderMath(latex, display).then((result) => {
        if (version === versionRef.current) setRendered(result);
      });
    });
    return () => { versionRef.current++; cancelTask(id); };
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
      onBlur={(event: FocusEvent<HTMLElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget as globalThis.Node | null)) setEditing(false);
      }}
    >
      {editing && (
        <span style={{ display: 'block', minWidth: display ? undefined : 180, maxWidth: '100%' }}>
          <textarea
            ref={inputRef} aria-label={display ? '块公式源码' : '行内公式源码'}
            value={latex} rows={display ? Math.max(2, Math.min(12, latex.split('\n').length)) : 1}
            spellCheck={false}
            onChange={(event) => updateAttributes({ latex: event.target.value })}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.keyCode === 229) return;
              if ((event.key === 'Backspace' || event.key === 'Delete') && !latex.trim()) {
                event.preventDefault(); event.stopPropagation();
                const pos = getPos();
                if (typeof pos !== 'number') return;
                editor.chain().focus().command(({ tr }) => {
                  tr.delete(pos, pos + node.nodeSize);
                  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(pos, tr.doc.content.size)), -1));
                  return true;
                }).run();
                return;
              }
              const control = event.ctrlKey || event.metaKey;
              if (control && (event.key.toLowerCase() === 'z' || event.key.toLowerCase() === 'y')) {
                event.preventDefault(); event.stopPropagation();
                // Respect the host's unified source/visual document history.
                editor.commands.keyboardShortcut(event.shiftKey || event.key.toLowerCase() === 'y' ? 'Mod-Shift-z' : 'Mod-z');
                return;
              }
              if (event.key === 'Escape' || (event.key === 'Enter' && (control || !display))) {
                event.preventDefault(); event.stopPropagation(); exit();
              }
            }}
            style={{
              display: 'block', boxSizing: 'border-box', width: '100%', padding: '8px 10px',
              fontFamily: 'var(--mono-font-family)', fontSize: 'var(--mono-font-size)', lineHeight: 1.5,
              border: '1px solid var(--editor-accent)', borderRadius: 'var(--radius-sm)',
              background: 'var(--editor-surface)', color: 'var(--editor-text)',
              resize: display ? 'vertical' : 'none', outline: 'none',
            }}
          />
          <span style={{ display: 'block', fontSize: 11, color: 'var(--editor-text-muted)', padding: '2px 0' }}>
            {display ? 'Enter 换行 · Ctrl+Enter 继续正文' : 'Enter 继续正文'}
          </span>
        </span>
      )}
      <span ref={viewportRef} title={editing ? undefined : '点击编辑公式'}
        style={{ display: display ? 'block' : 'inline', overflowWrap: 'anywhere' }}>
        {rendered?.html && latex.trim()
          ? <span className="math-preview" dangerouslySetInnerHTML={{ __html: rendered.html }} />
          : <span style={{ color: 'var(--editor-text-muted)' }}>{latex || (editing ? '输入 LaTeX 公式' : '点击输入公式')}</span>}
        {rendered?.error && latex.trim() && (
          <span role="status" style={{ display: 'block', fontSize: 12, color: 'var(--error-500)', whiteSpace: 'pre-wrap' }}>
            {rendered.error}
          </span>
        )}
      </span>
    </NodeViewWrapper>
  );
}
