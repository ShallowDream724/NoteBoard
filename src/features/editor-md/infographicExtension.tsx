// NoteBoard Infographic TipTap 扩展
// 自研 infographicBlock 节点 + 视口门控 + 就地编辑 + 模板选择 + 全屏缩放预览
// 信息图是纯 DOM 渲染，对外只产出图片：复制/导出 SVG 矢量图或 PNG 位图

import { memo, useState, useEffect, useMemo, useRef } from 'react';
import { InfographicNode } from './documentNodes';
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import {
  Maximize2,
  Edit2,
  X,
  AlertCircle,
  Sparkles,
  ChevronDown,
} from 'lucide-react';
import { parseInfographicCode } from '../infographic/infographicParser';
import { InfographicRenderer } from '../infographic/infographicRenderer';
import { InfographicTemplateIcon } from '../infographic/infographicTemplateIcon';
import { INFOGRAPHIC_TEMPLATES } from '../infographic/infographicTemplates';
import { observe } from './viewportActivation';
import { ChartExportMenu } from '../export/ChartExportMenu';
import { buildExportFileName, type ChartImageSource } from '../export/chartExport';
import { Tooltip } from '../../components/Tooltip';
import './infographicExtension.css';

const MemoInfographicRenderer = memo(InfographicRenderer);

function InfographicComponent({ node, updateAttributes, selected }: NodeViewProps) {
  // 首次进入共享 observer 的 800px 预加载范围后保留预览，滚动不会重建图表或编辑状态。
  const [activated, setActivated] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [showTemplateDropdown, setShowTemplateDropdown] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  // 内联与全屏两套渲染节点分别登记：信息图是纯 DOM 渲染，导出时抓取对应快照。
  // 用 state 保存 DOM 节点，挂载/卸载能触发重渲染，按钮禁用态才跟得上。
  const [inlineEl, setInlineEl] = useState<HTMLDivElement | null>(null);
  const [fullscreenEl, setFullscreenEl] = useState<HTMLDivElement | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const code = node.attrs.code || '';

  // 未访问的屏外节点既不解析配置，也不挂载完整图表；交互状态变化复用已解析数据。
  const { data, error } = useMemo(
    () => activated ? parseInfographicCode(code) : { data: null, error: null },
    [activated, code],
  );

  // 导出来源：解析成功且对应渲染节点已挂载才可用
  const activeEl = fullscreen ? fullscreenEl : inlineEl;
  const exportSource: ChartImageSource | null =
    !error && data && activeEl ? { kind: 'element', element: activeEl } : null;
  const exportFileName = buildExportFileName('', 'infographic');

  // 一次性激活；无 IntersectionObserver 的环境由 observe 立即回退到渲染。
  useEffect(() => {
    if (activated) return;
    const el = containerRef.current;
    if (!el) return;

    const unobserve = observe(el, () => setActivated(true), { once: true });
    return unobserve;
  }, [activated]);

  // 点击外部自动关闭下拉模板选择面板
  useEffect(() => {
    if (!showTemplateDropdown) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as unknown as globalThis.Node)) {
        setShowTemplateDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [showTemplateDropdown]);

  if (editing) {
    return (
      <NodeViewWrapper as="div" style={{ display: 'block', margin: '14px 0' }}>
        <div
          style={{
            border: '1px solid var(--editor-accent, #3b82f6)',
            borderRadius: 'var(--radius-md, 8px)',
            background: 'var(--editor-surface, #ffffff)',
            overflow: 'visible',
            boxShadow: '0 6px 16px rgba(0, 0, 0, 0.08)',
            position: 'relative',
          }}
        >
          {/* 编辑态顶部工具栏 */}
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontWeight: 600, color: 'var(--editor-text, #1e293b)' }}>
                编辑 Infographic 信息图源码 (YAML / JSON)
              </span>

              {/* 预设模板快速填充下拉 */}
              <div ref={dropdownRef} style={{ position: 'relative' }}>
                <button
                  type="button"
                  className="nb-info-tmpl-trigger"
                  onClick={() => setShowTemplateDropdown(!showTemplateDropdown)}
                >
                  <Sparkles size={12} />
                  <span>载入预设模板</span>
                  <ChevronDown size={11} />
                </button>

                {showTemplateDropdown && (
                  <div
                    style={{
                      position: 'absolute',
                      top: '100%',
                      left: 0,
                      marginTop: 4,
                      background: 'var(--editor-surface, #ffffff)',
                      border: '1px solid var(--editor-border, #e2e8f0)',
                      borderRadius: 6,
                      boxShadow: '0 8px 20px rgba(0,0,0,0.12)',
                      zIndex: 10000,
                      width: 220,
                      overflow: 'hidden',
                    }}
                  >
                    {INFOGRAPHIC_TEMPLATES.map((tmpl) => (
                      <button
                        key={tmpl.id}
                        type="button"
                        className="nb-info-dropdown-item"
                        onClick={() => {
                          setEditValue(tmpl.code);
                          setShowTemplateDropdown(false);
                        }}
                      >
                        {/* 彩色形象图标容器 */}
                        <div
                          style={{
                            width: 24,
                            height: 24,
                            borderRadius: 5,
                            background: tmpl.iconBg,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                          }}
                        >
                          <InfographicTemplateIcon iconName={tmpl.iconName} color={tmpl.iconColor} size={14} />
                        </div>
                        {/* 纯中文模板名称（无多余英文后缀） */}
                        <span style={{ fontWeight: 600, fontSize: 12 }}>{tmpl.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                className="nb-info-btn-primary"
                onClick={() => {
                  updateAttributes({ code: editValue });
                  setEditing(false);
                }}
              >
                完成
              </button>
              <button
                type="button"
                className="nb-info-btn-secondary"
                onClick={() => setEditing(false)}
              >
                取消
              </button>
            </div>
          </div>

          <textarea
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            placeholder="输入 Infographic 结构化配置 (YAML 或 JSON)..."
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                setEditing(false);
              }
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                updateAttributes({ code: editValue });
                setEditing(false);
              }
            }}
            style={{
              width: '100%',
              minHeight: 180,
              padding: '12px 14px',
              fontFamily: 'var(--mono-font-family, monospace)',
              fontSize: 'var(--mono-font-size, 13px)',
              border: 'none',
              background: 'transparent',
              color: 'var(--editor-text, #1e293b)',
              resize: 'vertical',
              outline: 'none',
              lineHeight: 1.5,
            }}
          />
        </div>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper as="div" style={{ display: 'block', margin: '14px 0' }} selected={selected}>
      <div
        ref={containerRef}
        className="nb-infographic-container"
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
        {/* 顶部操作条 */}
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
            <span style={{ fontWeight: 600, color: 'var(--editor-accent, #3b82f6)' }}>
              Infographic 信息图
            </span>
            {data?.type && (
              <span
                style={{
                  fontSize: 10,
                  padding: '1px 6px',
                  borderRadius: 4,
                  background: 'rgba(59, 130, 246, 0.1)',
                  color: '#2563eb',
                }}
              >
                {data.type}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Tooltip content="编辑信息图源码" side="top" sideOffset={4}>
              <button
                type="button"
                className="nb-info-icon-btn"
                onClick={() => {
                  setActivated(true);
                  setEditValue(code);
                  setEditing(true);
                }}
                aria-label="编辑信息图源码"
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
            <Tooltip content="全屏放大查看" side="top" sideOffset={4}>
              <button
                type="button"
                className="nb-info-icon-btn"
                onClick={() => {
                  setActivated(true);
                  setFullscreen(true);
                }}
                aria-label="全屏放大查看"
              >
                <Maximize2 size={12} />
              </button>
            </Tooltip>
          </div>
        </div>

        {/* 内容展示区 */}
        <div
          onDoubleClick={() => {
            setActivated(true);
            setEditValue(code);
            setEditing(true);
          }}
          style={{
            padding: '14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'auto',
            minHeight: 80,
            cursor: 'default',
          }}
        >
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

          {!error && data && (
            <div ref={setInlineEl} style={{ width: '100%' }}>
              <MemoInfographicRenderer data={data} />
            </div>
          )}

          {!activated && code && (
            <span style={{ color: 'var(--editor-text-muted, #64748b)', fontSize: 13 }}>
              信息图预览
            </span>
          )}

          {!code && (
            <span style={{ color: 'var(--editor-text-muted, #64748b)', fontStyle: 'italic', fontSize: 13 }}>
              空信息图（双击或点击编辑输入结构化内容）
            </span>
          )}
        </div>
      </div>

      {/* 全屏放大模态框 */}
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
            <span style={{ fontWeight: 600, color: 'var(--editor-text, #1e293b)' }}>
              Infographic 信息图预览
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
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
              <Tooltip content="关闭预览" side="bottom" sideOffset={4}>
                <button
                  type="button"
                  className="nb-info-close-btn"
                  onClick={() => setFullscreen(false)}
                  aria-label="关闭预览"
                >
                  <X size={20} />
                </button>
              </Tooltip>
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
            onClick={(e) => e.stopPropagation()}
          >
            {data && (
              <div
                ref={setFullscreenEl}
                style={{
                  maxWidth: 900,
                  width: '100%',
                  background: 'var(--editor-surface, #ffffff)',
                  borderRadius: 12,
                  padding: 24,
                  boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
                }}
              >
                <MemoInfographicRenderer data={data} />
              </div>
            )}
          </div>
        </div>
      )}
    </NodeViewWrapper>
  );
}

/** Infographic 块节点定义 */
export const InfographicBlock = InfographicNode.extend({
  addNodeView() {
    return ReactNodeViewRenderer(InfographicComponent);
  },
  addCommands() {
    return {
      insertInfographic:
        (code: string) =>
        ({ commands }: { commands: { insertContent: (content: unknown) => boolean } }) => {
          return commands.insertContent({
            type: 'infographicBlock',
            attrs: { code },
          });
        },
    } as never;
  },
});
