// NoteBoard Mermaid 图表扩展
// 自研节点 + 懒加载 + securityLevel: strict + 全局串行渲染队列 + 陈旧守卫 + 视口门控
// 详见 docs/09-开发路线图.md 8.5
//
// 设计：
// 1. 自研 mermaidBlock 节点
// 2. import('mermaid') 懒加载
// 3. securityLevel: 'strict', startOnLoad: false
// 4. 全局串行渲染队列（避免并发污染）
// 5. 陈旧守卫：渲染完成后检查内容是否已变
// 6. Skeleton 占位
// 7. 主题切换时重渲染

import { useState, useEffect, useLayoutEffect, useRef, useCallback, type KeyboardEvent } from 'react';
import { dispatchEditorShortcut } from './dispatchEditorShortcut';
import { useNativeSourceInput } from './useNativeSourceInput';
import { MermaidNode } from './documentNodes';
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { NodeSelection, Plugin, PluginKey } from '@tiptap/pm/state';
import { MERMAID_CREATION_META, markMermaidCreation } from './mermaidCreation';
import { BLOCK_MOVE_META, type BlockMove } from './headingFolding';
import { observe } from './viewportActivation';
import { scheduleTask, cancelTask } from './viewportWorkScheduler';
import { useEditorActive } from '../../core/editor/EditorActivityContext';
import { useSettingsStore } from '../../stores/settingsStore';
import { SvgDiagramViewport } from '../diagram-preview/SvgDiagramViewport';
import { AnnotationMarker } from './annotations/AnnotationMarker';

interface SourceRequest { position: number; token: object }
const sourceRequestKey = new PluginKey<SourceRequest | null>('mermaid-source-request');
const consumedSourceRequests = new WeakSet<object>();
interface SourceSession { position: number; initialCode: string }
const sourceSessionKey = new PluginKey<SourceSession | null>('mermaid-source-session');

function mermaidSourceSessionPlugin() {
  return new Plugin<SourceSession | null>({
    key: sourceSessionKey,
    state: {
      init: () => null,
      apply(tr, previous) {
        const requested = tr.getMeta(sourceSessionKey) as SourceSession | null | undefined;
        if (requested !== undefined) return requested;
        if (!previous || !tr.docChanged) return previous;
        if (tr.getMeta('noteboard-document-replacement')) return null;
        const move = tr.getMeta(BLOCK_MOVE_META) as BlockMove | undefined;
        const position = move && previous.position >= move.from && previous.position < move.to
          ? move.inserted + previous.position - move.from
          : tr.mapping.mapResult(previous.position, 1).pos;
        return tr.doc.nodeAt(position)?.type.name === 'mermaidBlock' ? { ...previous, position } : null;
      },
    },
  });
}

/** Only an explicit creation opens source; relocation of the same template does not. */
function mermaidSourceRequestPlugin() {
  return new Plugin<SourceRequest | null>({
    key: sourceRequestKey,
    state: {
      init: () => null,
      apply(tr, previous) {
        const requested = tr.getMeta(sourceRequestKey) as SourceRequest | undefined;
        if (requested) return requested;
        if (!previous || consumedSourceRequests.has(previous.token)) return null;
        const position = tr.mapping.map(previous.position);
        return tr.doc.nodeAt(position)?.type.name === 'mermaidBlock' ? { ...previous, position } : null;
      },
    },
    appendTransaction(transactions, _oldState, newState) {
      let position: number | null = null;
      transactions.forEach((tr, transactionIndex) => {
        if (!tr.docChanged || !tr.getMeta(MERMAID_CREATION_META) || tr.getMeta(BLOCK_MOVE_META)) return;
        tr.steps.forEach((step, stepIndex) => {
          const before = tr.docs[stepIndex], after = tr.docs[stepIndex + 1] ?? tr.doc;
          step.getMap().forEach((from, to, changedFrom, changedTo) => {
            if (position != null || changedFrom === changedTo) return;
            after.nodesBetween(changedFrom, changedTo, (candidate, candidatePos) => {
              if (position != null) return false;
              if (candidate.type.name !== 'mermaidBlock') return true;
              if (from !== to && before.nodeAt(from)?.type.name === 'mermaidBlock') return false;
              let mapped = tr.mapping.slice(stepIndex + 1).map(candidatePos);
              for (let index = transactionIndex + 1; index < transactions.length; index++) mapped = transactions[index].mapping.map(mapped);
              if (newState.doc.nodeAt(mapped)?.type.name === 'mermaidBlock') position = mapped;
              return false;
            });
          });
        });
      });
      if (position == null) return null;
      return newState.tr.setSelection(NodeSelection.create(newState.doc, position))
        .setMeta(sourceRequestKey, { position, token: {} } satisfies SourceRequest)
        .setMeta('addToHistory', false);
    },
  });
}

/** 🔴 S14：任务身份 = editor 实例（文档）+ 节点位置——不同节点互不覆盖 */
const editorTaskIds = new WeakMap<object, number>();
let nextEditorTaskId = 0;
function editorTaskId(editor: object): number {
  let id = editorTaskIds.get(editor);
  if (id === undefined) {
    id = (nextEditorTaskId += 1);
    editorTaskIds.set(editor, id);
  }
  return id;
}
import { Tooltip } from '../../components/Tooltip';

import { renderMermaidSvg, resetMermaidRenderer } from '../diagram-preview/mermaidRenderer';

// ── 获取当前主题 ──

function getCurrentMermaidTheme(): 'default' | 'dark' | 'forest' {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  return isDark ? 'dark' : 'default';
}

import { Maximize2, Edit2, X, AlertCircle } from 'lucide-react';
import { ChartExportMenu } from '../export/ChartExportMenu';
import { buildExportFileName, type ChartImageSource } from '../export/chartExport';

// ── React NodeView ──

function MermaidSourceField({ value, onChange, onKeyDown, autoFocus = true, readOnly = false, inline = false }: {
  value: string;
  onChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  autoFocus?: boolean;
  readOnly?: boolean;
  inline?: boolean;
}) {
  const { input, composing, inputProps } = useNativeSourceInput({ value, onChange });
  useEffect(() => {
    if (!autoFocus) return;
    // TipTap's insertion focus runs in the next frame; focus after it.
    const frame = requestAnimationFrame(() => input.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [autoFocus, input]);
  return <textarea
    {...inputProps}
    aria-label="Mermaid 图表源码"
    data-shortcuts-suspended
    readOnly={readOnly}
    placeholder="输入 Mermaid 语法，例如:&#10;graph TD&#10;    A[开始] --> B[结束]"
    onKeyDown={event => { if (!composing.current && !event.nativeEvent.isComposing && event.keyCode !== 229) onKeyDown(event); }}
    style={{
      width: '100%', minHeight: 140, padding: '10px 14px',
      fontFamily: 'var(--mono-font-family, monospace)', fontSize: 'var(--mono-font-size, 13px)',
      border: 0, background: inline ? 'var(--editor-surface)' : 'transparent', color: 'var(--editor-text, #1e293b)',
      resize: 'vertical', outline: 'none', lineHeight: 1.5,
      display: inline ? 'block' : undefined, boxSizing: 'border-box',
    }}
  />;
}

function MermaidComponent({ node, updateAttributes, selected, editor, getPos, decorations }: NodeViewProps) {
  const active = useEditorActive();
  const enabled = useSettingsStore(state => state.settings.editor.enableMermaid);
  // 保留已渲染图形；重新激活且正文/主题未变时不重复运行 Mermaid。
  const renderedSignatureRef = useRef<string | null>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const session = sourceSessionKey.getState(editor.state);
  const [editing, setEditing] = useState(() => !!session && session.position === getPos());
  const initialCodeRef = useRef(session && session.position === getPos() ? session.initialCode : '');
  const [inViewport, setInViewport] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [zoomReset, setZoomReset] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const renderTokenRef = useRef<number>(0);

  const code = node.attrs.code || '';

  const beginEditing = useCallback(() => {
    initialCodeRef.current = code;
    const position = getPos();
    if (position !== undefined) editor.view.dispatch(editor.state.tr.setMeta(sourceSessionKey, { position, initialCode: code } satisfies SourceSession).setMeta('addToHistory', false));
    setEditing(true);
  }, [code, editor, getPos]);
  const finishEditing = useCallback(() => {
    editor.view.dispatch(editor.state.tr.setMeta(sourceSessionKey, null).setMeta('addToHistory', false));
    setEditing(false);
  }, [editor]);
  const cancelEditing = useCallback(() => {
    if (code !== initialCodeRef.current) updateAttributes({ code: initialCodeRef.current });
    finishEditing();
  }, [code, updateAttributes, finishEditing]);
  useLayoutEffect(() => {
    const request = sourceRequestKey.getState(editor.state);
    if (!request || request.position !== getPos() || consumedSourceRequests.has(request.token)) return;
    consumedSourceRequests.add(request.token);
    beginEditing();
  });

  const doRender = useCallback(async (currentCode: string, signal: AbortSignal) => {
    if (signal.aborted) return;
    if (!currentCode.trim()) {
      setSvg(null);
      setError(null);
      setLoading(false);
      renderedSignatureRef.current = null;
      return;
    }

    const theme = getCurrentMermaidTheme();
    const signature = `${theme}:${currentCode}`;
    if (renderedSignatureRef.current === signature) return;
    const token = ++renderTokenRef.current;
    setLoading(true);
    setError(null);

    try {
      const result = await renderMermaidSvg(currentCode, theme, signal);
      // 陈旧守卫：检查内容是否已变
      if (signal.aborted || token !== renderTokenRef.current) return;
      setSvg(result);
      renderedSignatureRef.current = signature;
    } catch (e) {
      if (signal.aborted || token !== renderTokenRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!signal.aborted && token === renderTokenRef.current) {
        setLoading(false);
      }
    }
  }, []);

  // 视口门控
  useEffect(() => {
    if (!enabled) return;
    const el = containerRef.current;
    if (!el) return;

    const unobserve = observe(el, () => {
      setInViewport(true);
    }, { once: true });

    return unobserve;
  }, [enabled, editing]);

  // 只在视口内时渲染
  useEffect(() => {
    if (!enabled) { setSvg(null); setError(null); setLoading(false); renderedSignatureRef.current = null; return; }
    if (!active || !inViewport || editing) return;
    const controller = new AbortController();
    const identity = `mermaid:${editorTaskId(editor)}:${getPos()}`;
    scheduleTask(identity, () => doRender(code, controller.signal));
    // 切走时取消尚未执行的展示任务；正文/保存链不受影响。
    return () => { cancelTask(identity); controller.abort(); renderTokenRef.current++; };
  }, [enabled, active, inViewport, editing, code, doRender, editor, getPos]);

  // 主题切换时重渲染
  useEffect(() => {
    if (!enabled || !active || !inViewport || editing || !code) return;
    const controller = new AbortController();
    const identity = `mermaid:${editorTaskId(editor)}:${getPos()}`;
    const observer = new MutationObserver(() => {
      scheduleTask(identity, () => doRender(code, controller.signal));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => { observer.disconnect(); cancelTask(identity); controller.abort(); renderTokenRef.current++; };
  }, [enabled, active, inViewport, editing, code, doRender, editor, getPos]);

  // 导出来源：渲染出 SVG 后复制/导出才可用
  const exportSource: ChartImageSource | null = svg ? { kind: 'svg', svg } : null;
  const exportFileName = buildExportFileName('', 'mermaid');

  if (!enabled && !editing) return <NodeViewWrapper as="div" data-editor-control="true" contentEditable={false} style={{ margin: '12px 0' }}>
    <div ref={containerRef} style={{ border: '1px solid var(--editor-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 12px', fontSize: 12, color: 'var(--editor-text-muted)' }}><span>Mermaid</span><AnnotationMarker decorations={decorations}/></div>
      <MermaidSourceField value={code} onChange={value => updateAttributes({ code: value })} autoFocus={false} inline readOnly={!editor.isEditable}
        onKeyDown={event => {
          if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
            event.preventDefault(); event.stopPropagation();
            dispatchEditorShortcut(editor.view, event.shiftKey || event.key.toLowerCase() === 'y' ? 'Ctrl+Shift+Z' : 'Ctrl+Z');
          }
        }}
      />
    </div>
  </NodeViewWrapper>;

  if (editing) {
    return (
      <NodeViewWrapper as="div" data-editor-control="true" contentEditable={false} style={{ display: 'block', margin: '12px 0' }}>
        <div
          style={{
            border: '1px solid var(--editor-accent, #3b82f6)',
            borderRadius: 'var(--radius-md, 8px)',
            background: 'var(--editor-surface, #ffffff)',
            overflow: 'hidden',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.08)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '6px 12px',
              background: 'var(--editor-bg, #f8fafc)',
              borderBottom: '1px solid var(--editor-border, #e2e8f0)',
              fontSize: 12,
              fontWeight: 500,
              color: 'var(--editor-text-muted, #64748b)',
            }}
          >
            <span>编辑 Mermaid 图表源码</span>
            <div className="nb-annotation-toolbar-actions">
              <AnnotationMarker decorations={decorations}/>
              <button
                type="button"
                onClick={finishEditing}
                style={{
                  padding: '3px 10px',
                  borderRadius: 4,
                  background: 'var(--editor-accent, #3b82f6)',
                  color: '#ffffff',
                  border: 'none',
                  fontSize: 12,
                  cursor: 'pointer',
                  fontWeight: 500,
                }}
              >
                完成
              </button>
              <button
                type="button"
                onClick={cancelEditing}
                style={{
                  padding: '3px 8px',
                  borderRadius: 4,
                  background: 'transparent',
                  color: 'var(--editor-text-muted, #64748b)',
                  border: '1px solid var(--editor-border, #e2e8f0)',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                取消
              </button>
            </div>
          </div>
          <MermaidSourceField
            value={code}
            onChange={value => updateAttributes({ code: value })}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                cancelEditing();
              }
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                finishEditing();
              }
              if ((e.ctrlKey || e.metaKey) && ['z', 'y'].includes(e.key.toLowerCase())) {
                e.preventDefault(); e.stopPropagation();
                if (code === initialCodeRef.current && e.key.toLowerCase() === 'z' && !e.shiftKey) {
                  finishEditing();
                  editor.view.focus();
                  return;
                }
                dispatchEditorShortcut(editor.view, e.shiftKey || e.key.toLowerCase() === 'y' ? 'Ctrl+Shift+Z' : 'Ctrl+Z');
              }
            }}
          />
        </div>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper as="div" style={{ display: 'block', margin: '12px 0' }} selected={selected}>
      <div
        ref={containerRef}
        className="nb-diagram-container"
        style={{
          position: 'relative',
          minHeight: 60,
          border: '1px solid var(--editor-border, #e2e8f0)',
          borderRadius: 'var(--radius-md, 8px)',
          background: 'var(--editor-surface, #ffffff)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
        contentEditable={false}
      >
        {/* 顶部轻量浮动操作栏 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '4px 10px',
            borderBottom: '1px solid var(--editor-border, #e2e8f0)',
            background: 'var(--editor-bg, #f8fafc)',
            fontSize: 11,
            color: 'var(--editor-text-muted, #64748b)',
            userSelect: 'none',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontWeight: 600, color: 'var(--editor-accent, #3b82f6)' }}>Mermaid</span>
            {loading && <span>渲染中</span>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <AnnotationMarker decorations={decorations}/>
            {/* 编辑图表源码 */}
            <Tooltip content="编辑图表源码" side="top" sideOffset={4}>
              <button
                type="button"
                className="nb-diagram-action-btn"
                onClick={beginEditing}
                aria-label="编辑图表源码"
              >
                <Edit2 size={12} />
                <span>编辑</span>
              </button>
            </Tooltip>
            <ChartExportMenu
              action="copy"
              variant="ghost"
              source={exportSource}
              fileName={exportFileName}
            />
            <ChartExportMenu
              action="download"
              variant="ghost"
              source={exportSource}
              fileName={exportFileName}
            />
            {svg && (
              <Tooltip content="全屏放大查看" side="top" sideOffset={4}>
                <button
                  type="button"
                  className="nb-diagram-action-btn"
                  onClick={() => setFullscreen(true)}
                  aria-label="全屏放大查看"
                >
                  <Maximize2 size={12} />
                </button>
              </Tooltip>
            )}
          </div>
        </div>

        {/* 内容展示区 */}
        <div
          onDoubleClick={beginEditing}
          style={{
            padding: '16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'auto',
            cursor: 'pointer',
            minHeight: 80,
          }}
        >
          {!inViewport && code && (
            <div style={{ color: 'var(--editor-text-muted, #64748b)', fontSize: 13 }}>
              <span>📊 Mermaid 图表（滚动到视口时渲染）</span>
            </div>
          )}

          {inViewport && loading && !svg && (
            <div style={{ color: 'var(--editor-text-muted, #64748b)', fontSize: 13 }}>
              <span>渲染中</span>
            </div>
          )}

          {error && (
            <div style={{ fontSize: 12, color: '#ef4444', textAlign: 'center', width: '100%' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 8 }}>
                <AlertCircle size={15} />
                <span>{error}</span>
              </div>
              <pre
                style={{
                  padding: 8,
                  background: 'var(--editor-bg, #f1f5f9)',
                  borderRadius: 4,
                  overflow: 'auto',
                  fontSize: 11,
                  color: 'var(--editor-text-muted, #64748b)',
                  textAlign: 'left',
                }}
              >
                {code}
              </pre>
            </div>
          )}

          {svg && <SvgDiagramViewport svg={svg}/>}

          {!code && (
            <span style={{ color: 'var(--editor-text-muted, #64748b)', fontStyle: 'italic', fontSize: 13 }}>
              空 Mermaid 图表（双击或点击编辑输入内容）
            </span>
          )}
        </div>
      </div>

      {/* 全屏模态弹窗 */}
      {fullscreen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 99999,
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            flexDirection: 'column',
          }}
          onClick={() => setFullscreen(false)}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 20px',
              background: 'var(--editor-surface, #ffffff)',
              borderBottom: '1px solid var(--editor-border, #e2e8f0)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <span style={{ fontWeight: 600, color: 'var(--editor-text, #1e293b)' }}>Mermaid 图表预览</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button
                  type="button"
                  className="nb-editor-icon-btn"
                  onClick={() => setZoom((z) => Math.max(0.2, z - 0.2))}
                  style={{ minWidth: 28, height: 28 }}
                  aria-label="缩小"
                >
                  -
                </button>
                <span style={{ fontSize: 12, minWidth: 44, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
                <button
                  type="button"
                  className="nb-editor-icon-btn"
                  onClick={() => setZoom((z) => Math.min(8, z + 0.2))}
                  style={{ minWidth: 28, height: 28 }}
                  aria-label="放大"
                >
                  +
                </button>
                <button
                  type="button"
                  className="nb-editor-toolbar-btn"
                  onClick={() => { setZoom(1); setZoomReset(value => value + 1); }}
                  style={{ padding: '3px 8px', fontSize: 12 }}
                  aria-label="重置"
                >
                  重置
                </button>
              </div>
              <ChartExportMenu
                action="copy"
                variant="outline"
                source={exportSource}
                fileName={exportFileName}
              />
              <ChartExportMenu
                action="download"
                variant="primary"
                source={exportSource}
                fileName={exportFileName}
              />
              <button
                type="button"
                className="nb-diagram-action-btn"
                onClick={() => setFullscreen(false)}
                aria-label="关闭预览"
                style={{ padding: 4 }}
              >
                <X size={20} />
              </button>
            </div>
          </div>
          <div
            style={{
              flex: 1,
              overflow: 'auto',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 40,
            }}
            onClick={(e) => {
              e.stopPropagation();
              // The viewport fills this area; its empty space is still backdrop.
              if (!(e.target instanceof Element) || !e.target.closest('svg')) setFullscreen(false);
            }}
          >
            {svg && <SvgDiagramViewport key={zoomReset} svg={svg} zoom={zoom} onZoom={setZoom} fullscreen/>}
          </div>
        </div>
      )}
    </NodeViewWrapper>
  );
}

// ── TipTap 节点定义 ──

/** Mermaid 块节点 */
export const MermaidBlock = MermaidNode.extend({
  addOptions() { return { ...this.parent?.(), ownsAnnotationMarker: true }; },
  addProseMirrorPlugins() { return [...(this.parent?.() ?? []), mermaidSourceRequestPlugin(), mermaidSourceSessionPlugin()]; },
  addNodeView() {
    return ReactNodeViewRenderer(MermaidComponent);
  },
  addCommands() {
    return {
      insertMermaid:
        (code: string) =>
        ({ commands, tr }: { commands: { insertContent: (content: unknown) => boolean }; tr: import('@tiptap/pm/state').Transaction }) => {
          markMermaidCreation(tr);
          return commands.insertContent({
            type: 'mermaidBlock',
            attrs: { code },
          });
        },
    } as never;
  },
});

/** 清除 Mermaid 模块（主题切换时重置初始化） */
export function resetMermaid(): void {
  resetMermaidRenderer();
}
