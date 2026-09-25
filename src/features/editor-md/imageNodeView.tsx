// NoteBoard Markdown 现代图片扩展与交互组件
// 支持本地相对路径动态解析、悬停工具栏、大图预览查看器、多级缩放与拖拽拉伸、居左/居中/居右对齐

import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ImageNode } from './documentNodes';
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Trash2,
  ExternalLink,
  FolderOpen,
  RotateCw,
  X,
  AlertCircle,
  RefreshCw,
  Pencil,
} from 'lucide-react';
import { convertFileSrc } from '@tauri-apps/api/core';
import * as ipc from '../../core/ipc/commands';
import { useDocumentStore } from '../../stores/documentStore';
import { on, off } from '../../core/emitter';
import { sameKey } from '../explorer/pathUtils';
import { useExplorerStore } from '../explorer/explorerStore';
import { resolveRelativeDocPath } from './linkHandler';
import { openDocument } from '../editor-code/orchestration/openDocument';
import { Tooltip } from '../../components/Tooltip';
import { useImageVisibility } from './rich-content/imageVisibility';
import { runWithDocumentCapability, useNativeFeatureVisibility } from '../document-format/featureGate';
import { useImageWheelGesture } from '../image-viewer/imageWheelGesture';
import { requestImageDescription } from './rich-content/imageDescriptionDialog';
import { dispatchDiscreteEdit } from './discreteEdit';
import type { Transaction } from '@tiptap/pm/state';

/** 大图预览 Lightbox 模态框组件 */
export function ImageLightboxModal({
  src,
  alt,
  onClose,
  onOpenInTab,
  onRevealInDir,
}: {
  src: string;
  alt?: string;
  onClose: () => void;
  onOpenInTab?: () => void;
  onRevealInDir?: () => void;
}) {
  const [scale, setScale] = useState(1);
  const [rotate, setRotate] = useState(0);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const viewport = useRef<HTMLDivElement>(null);
  const gesturing = useImageWheelGesture(viewport, { scale, ...translate }, next => { setScale(next.scale); setTranslate({ x: next.x, y: next.y }); }, { min: .2, max: 4, normalWheel: 'pan' });
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    viewport.current?.focus({ preventScroll: true });
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);

  // 监听 Esc 键快速关闭
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return createPortal(
    <div
      ref={viewport} role="dialog" aria-label="图片预览" aria-modal="true" tabIndex={-1} data-image-lightbox="" data-shortcuts-suspended
      onPointerDown={event => event.stopPropagation()}
      onContextMenu={event => { event.preventDefault(); event.stopPropagation(); }}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 9999,
        background: 'rgba(0, 0, 0, 0.82)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        userSelect: 'none',
      }}
      onClick={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* 顶部悬浮控制栏 */}
      <div
        style={{
          position: 'absolute',
          top: 16,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          background: 'rgba(30, 41, 59, 0.85)',
          padding: '6px 14px',
          borderRadius: 24,
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)',
          color: '#ffffff',
          zIndex: 10000,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <Tooltip content="缩小 (Zoom Out)" side="bottom" sideOffset={6}>
          <button
            type="button"
            aria-label="缩小"
            onClick={() => setScale((s) => Math.max(0.2, s - 0.2))}
            style={modalBtnStyle}
          >
            <ZoomOut size={16} />
          </button>
        </Tooltip>
        <span style={{ fontSize: 12, minWidth: 44, textAlign: 'center' }}>
          {Math.round(scale * 100)}%
        </span>
        <Tooltip content="放大 (Zoom In)" side="bottom" sideOffset={6}>
          <button
            type="button"
            aria-label="放大"
            onClick={() => setScale((s) => Math.min(4, s + 0.2))}
            style={modalBtnStyle}
          >
            <ZoomIn size={16} />
          </button>
        </Tooltip>
        <Tooltip content="顺时针旋转 90°" side="bottom" sideOffset={6}>
          <button
            type="button"
            aria-label="顺时针旋转 90°"
            onClick={() => setRotate((r) => (r + 90) % 360)}
            style={modalBtnStyle}
          >
            <RotateCw size={16} />
          </button>
        </Tooltip>
        <Tooltip content="还原 100%" side="bottom" sideOffset={6}>
          <button
            type="button"
            aria-label="还原 100%"
            onClick={() => {
            setScale(1);
            setRotate(0);
            setTranslate({ x: 0, y: 0 });
          }}
            style={modalBtnStyle}
          >
            <Maximize2 size={16} />
          </button>
        </Tooltip>

        {onOpenInTab && (
          <Tooltip content="在独立图片标签页中打开" side="bottom" sideOffset={6}>
            <button
              type="button"
              aria-label="在独立图片标签页中打开"
              onClick={onOpenInTab}
              style={modalBtnStyle}
            >
              <ExternalLink size={16} />
            </button>
          </Tooltip>
        )}

        {onRevealInDir && (
          <Tooltip content="在文件夹中显示原图" side="bottom" sideOffset={6}>
            <button
              type="button"
              aria-label="在文件夹中显示原图"
              onClick={onRevealInDir}
              style={modalBtnStyle}
            >
              <FolderOpen size={16} />
            </button>
          </Tooltip>
        )}

        <Tooltip content="关闭 (Esc)" side="bottom" sideOffset={6}>
          <button
            type="button"
            aria-label="关闭预览"
            onClick={onClose}
            style={{ ...modalBtnStyle, color: '#f87171' }}
          >
            <X size={18} />
          </button>
        </Tooltip>
      </div>

      {/* 图片主视图 */}
      <div
        data-image-preview-transform=""
        style={{
          maxWidth: '90vw',
          maxHeight: '85vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          transition: gesturing ? 'none' : 'transform 120ms ease',
          transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale}) rotate(${rotate}deg)`,
        }}
      >
        {/* 禁用 Referer 携带，防止防盗链拦截 */}
        <img
          src={src}
          alt={alt || 'Image Preview'}
          referrerPolicy="no-referrer"
          style={{
            maxWidth: '100%',
            maxHeight: '85vh',
            objectFit: 'contain',
            borderRadius: 4,
            boxShadow: '0 12px 36px rgba(0, 0, 0, 0.5)',
          }}
        />
      </div>

    </div>, document.body
  );
}

const modalBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: '#ffffff',
  cursor: 'pointer',
  padding: '4px 6px',
  borderRadius: 4,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'background 120ms ease',
};

/** TipTap 图片 NodeView 组件 */
export function ImageComponent({ node, extension, editor, getPos, deleteNode }: NodeViewProps) {
  const nativeFeaturesVisible = useNativeFeatureVisibility();
  const [resizePreview, setResizePreview] = useState<string | null>(null);
  const resizeCleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => { resizeCleanup.current?.(); }, []);
  const editDescription = async () => {
    let pos = getPos(); if (typeof pos !== 'number') return;
    const originalSrc = node.attrs.src;
    const map = ({ transaction }: { transaction: Transaction }) => {
      if (pos === undefined) return;
      const mapped = transaction.mapping.mapResult(pos, 1); pos = mapped.deletedAcross ? undefined : mapped.pos;
    };
    editor.on('transaction', map);
    try {
      const value = await requestImageDescription(node.attrs.alt ?? '');
      if (value === null || editor.isDestroyed || pos === undefined) return;
      const current = editor.state.doc.nodeAt(pos);
      if (current?.type.name !== 'image' || current.attrs.src !== originalSrc || current.attrs.alt === value) return;
      dispatchDiscreteEdit(editor.view, editor.state.tr.setNodeAttribute(pos, 'alt', value));
    } finally { editor.off('transaction', map); }
  };
  const updatePresentation = (attrs: { align?: string; width?: string }) => {
    const pos = getPos(); if (typeof pos !== 'number') return;
    runWithDocumentCapability(editor, 'imageLayout', next => {
      const image = next.state.doc.nodeAt(pos); if (image?.type.name !== 'image') return false;
      next.view.dispatch(next.state.tr.setNodeMarkup(pos, undefined, { ...image.attrs, ...attrs })); return true;
    });
  };
  const visibility = useImageVisibility();
  const [hovered, setHovered] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [resolvedDisplaySrc, setResolvedDisplaySrc] = useState<string>('');
  const [resolvedAbsPath, setResolvedAbsPath] = useState<string | null>(null);

  const rawSrc: string = node.attrs.src || '';
  const ownerKey = String(extension.options.docKey ?? '');
  const alt: string = node.attrs.alt || '';
  const align: 'left' | 'center' | 'right' = node.attrs.align || 'center';
  const width: string = node.attrs.width || '100%';

  // 动态解析图片真实 URL
  useEffect(() => {
    setLoadError(false);
    if (!rawSrc) {
      setResolvedDisplaySrc('');
      setResolvedAbsPath(null);
      return;
    }

    // 1. 网络 URL 或 Base64
    if (
      rawSrc.startsWith('http://') ||
      rawSrc.startsWith('https://') ||
      rawSrc.startsWith('data:') ||
      rawSrc.startsWith('asset:')
    ) {
      setResolvedDisplaySrc(rawSrc);
      setResolvedAbsPath(null);
      return;
    }

    // 2. 本地相对路径或绝对路径
    const currentDoc = ownerKey ? useDocumentStore.getState().getDocument(ownerKey) : null;
    const baseDir = currentDoc?.dirPath || useExplorerStore.getState().root;

    if (baseDir) {
      const absPath = resolveRelativeDocPath(baseDir, rawSrc);
      setResolvedAbsPath(absPath);
      try {
        setResolvedDisplaySrc(convertFileSrc(absPath));
      } catch {
        setResolvedDisplaySrc(rawSrc);
      }
    } else if (/^[a-zA-Z]:[\\/]/.test(rawSrc)) {
      setResolvedAbsPath(rawSrc);
      try {
        setResolvedDisplaySrc(convertFileSrc(rawSrc));
      } catch {
        setResolvedDisplaySrc(rawSrc);
      }
    } else {
      setResolvedDisplaySrc(rawSrc);
      setResolvedAbsPath(null);
    }
  }, [rawSrc, ownerKey]);

  useEffect(() => {
    const restored = ({ path }: { path: string }) => {
      if (!sameKey(path, resolvedAbsPath)) return;
      setLoadError(false);
      setResolvedDisplaySrc(convertFileSrc(path) + '?restored=' + Date.now());
    };
    on('image-file-restored', restored);
    return () => off('image-file-restored', restored);
  }, [resolvedAbsPath]);

  // 处理对齐样式
  const alignContainerStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent:
      align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center',
    margin: '16px 0',
    width: '100%',
    position: 'relative',
    userSelect: 'none',
  };

  // 拖拽调整宽度
  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const initialWidth = parseInt(width, 10) || 100;
    let finalWidth = initialWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const diff = moveEvent.clientX - startX;
      const step = Math.round(diff / 5);
      const newWidth = Math.max(20, Math.min(100, initialWidth + step));
      finalWidth = newWidth;
      setResizePreview(`${newWidth}%`);
    };

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      resizeCleanup.current = null;
      setResizePreview(null);
      if (finalWidth !== initialWidth) updatePresentation({ width: `${finalWidth}%` });
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    resizeCleanup.current = () => { window.removeEventListener('mousemove', handleMouseMove); window.removeEventListener('mouseup', handleMouseUp); };
  };

  // 在 NoteBoard 独立标签页中打开大图
  const handleOpenInTab = async () => {
    setLightboxOpen(false);
    if (resolvedAbsPath) {
      await openDocument(resolvedAbsPath);
    }
  };

  // 在系统文件夹中显示
  const handleRevealInDir = async () => {
    if (resolvedAbsPath) {
      await ipc.revealInExplorer(resolvedAbsPath);
    }
  };

  return (
    <NodeViewWrapper className="nb-image" style={alignContainerStyle}>
      <div
        ref={visibility.ref}
        style={{
          position: 'relative',
          display: 'inline-block',
          width: resizePreview ?? width,
          maxWidth: '100%',
          borderRadius: 8,
          transition: 'width 150ms ease',
          minHeight: visibility.visible ? undefined : visibility.placeholderHeight,
        }}
        data-image-frame=""
        onClick={event => {
          // The small-image toolbar may cover the pointer between its buttons.
          // Its empty surface has the same preview action as the image beneath it.
          if (!loadError && event.currentTarget.closest('.nb-image-slot') && !(event.target as Element).closest('button, input, textarea, [data-image-resize]')) {
            event.stopPropagation(); setLightboxOpen(true);
          }
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/* 悬停浮层快捷操作工具栏 */}
        {hovered && (
          <div
            data-image-toolbar=""
            style={{
              position: 'absolute',
              top: 8,
              right: 8,
              zIndex: 30,
              background: 'var(--editor-surface, rgba(255, 255, 255, 0.95))',
              border: '1px solid var(--editor-border)',
              borderRadius: 8,
              padding: '3px 6px',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              boxShadow: 'var(--shadow-md)',
              backdropFilter: 'blur(8px)',
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {/* 查看大图 */}
            <Tooltip content="查看大图 / 放大预览" side="top" sideOffset={4}>
              <button
                type="button"
                aria-label="查看大图 / 放大预览"
                onClick={() => setLightboxOpen(true)}
                style={actionBtnStyle}
              >
                <Maximize2 size={14} color="var(--accent-strong)" />
              </button>
            </Tooltip>

            <div style={{ width: 1, height: 14, background: 'var(--editor-border)' }} />

            {nativeFeaturesVisible && <>
            {/* 对齐方式 */}
            <Tooltip content="居左对齐" side="top" sideOffset={4}>
              <button
                type="button"
                aria-label="居左对齐"
                onClick={() => updatePresentation({ align: 'left' })}
                style={{
                  ...actionBtnStyle,
                  background: align === 'left' ? 'var(--toolbar-active)' : 'transparent',
                }}
              >
                <AlignLeft size={14} />
              </button>
            </Tooltip>
            <Tooltip content="居中对齐" side="top" sideOffset={4}>
              <button
                type="button"
                aria-label="居中对齐"
                onClick={() => updatePresentation({ align: 'center' })}
                style={{
                  ...actionBtnStyle,
                  background: align === 'center' ? 'var(--toolbar-active)' : 'transparent',
                }}
              >
                <AlignCenter size={14} />
              </button>
            </Tooltip>
            <Tooltip content="居右对齐" side="top" sideOffset={4}>
              <button
                type="button"
                aria-label="居右对齐"
                onClick={() => updatePresentation({ align: 'right' })}
                style={{
                  ...actionBtnStyle,
                  background: align === 'right' ? 'var(--toolbar-active)' : 'transparent',
                }}
              >
                <AlignRight size={14} />
              </button>
            </Tooltip>

            <div style={{ width: 1, height: 14, background: 'var(--editor-border)' }} />

            {/* 快速缩放预设 */}
            <Tooltip content="缩放为 50%" side="top" sideOffset={4}>
              <button
                type="button"
                aria-label="缩放为 50%"
                onClick={() => updatePresentation({ width: '50%' })}
                style={{
                  ...actionBtnStyle,
                  fontSize: 11,
                  fontWeight: 600,
                  color: width === '50%' ? 'var(--accent-strong)' : 'inherit',
                  background: width === '50%' ? 'var(--toolbar-active)' : 'transparent',
                }}
              >
                50%
              </button>
            </Tooltip>
            <Tooltip content="缩放为 75%" side="top" sideOffset={4}>
              <button
                type="button"
                aria-label="缩放为 75%"
                onClick={() => updatePresentation({ width: '75%' })}
                style={{
                  ...actionBtnStyle,
                  fontSize: 11,
                  fontWeight: 600,
                  color: width === '75%' ? 'var(--accent-strong)' : 'inherit',
                  background: width === '75%' ? 'var(--toolbar-active)' : 'transparent',
                }}
              >
                75%
              </button>
            </Tooltip>
            <Tooltip content="缩放为 100%" side="top" sideOffset={4}>
              <button
                type="button"
                aria-label="缩放为 100%"
                onClick={() => updatePresentation({ width: '100%' })}
                style={{
                  ...actionBtnStyle,
                  fontSize: 11,
                  fontWeight: 600,
                  color: width === '100%' ? 'var(--accent-strong)' : 'inherit',
                  background: width === '100%' ? 'var(--toolbar-active)' : 'transparent',
                }}
              >
                100%
              </button>
            </Tooltip>

            <div style={{ width: 1, height: 14, background: 'var(--editor-border)' }} />

            </>}
            <Tooltip content="编辑图片描述" side="top" sideOffset={4}><button type="button" data-image-description="" aria-label="编辑图片描述" onClick={() => { void editDescription(); }} style={actionBtnStyle}><Pencil size={14}/></button></Tooltip>
            {/* 删除图片 */}
            <Tooltip content="删除图片" side="top" sideOffset={4}>
              <button
                type="button"
                aria-label="删除图片"
                onClick={deleteNode}
                style={{ ...actionBtnStyle, color: '#ef4444' }}
              >
                <Trash2 size={14} />
              </button>
            </Tooltip>
          </div>
        )}

        {/* 错误提示态 */}
        {loadError ? (
          <div
            style={{
              padding: '24px 16px',
              border: '1px dashed var(--error-500, #ef4444)',
              borderRadius: 8,
              background: 'rgba(239, 68, 68, 0.05)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              color: 'var(--editor-text)',
              fontSize: 13,
            }}
          >
            <AlertCircle size={24} color="#ef4444" />
            <div style={{ fontWeight: 500 }}>图片加载失败</div>
            <div style={{ fontSize: 11, color: 'var(--editor-text-muted)', wordBreak: 'break-all' }}>
              {rawSrc}
            </div>
            <button
              type="button"
              onClick={() => {
                setLoadError(false);
                setResolvedDisplaySrc((s) => `${s}?r=${Date.now()}`);
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '4px 10px',
                border: '1px solid var(--editor-border)',
                borderRadius: 4,
                background: 'var(--editor-surface)',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              <RefreshCw size={12} />
              <span>重新加载</span>
            </button>
          </div>
        ) : (
          /* 禁用 Referer 携带，防止防盗链拦截并支持跨域图片原生渲染 */
          <img
            src={visibility.visible && resolvedDisplaySrc ? resolvedDisplaySrc : undefined}
            alt={alt}
            loading={visibility.visible ? 'eager' : 'lazy'}
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setLoadError(true)}
            onDoubleClick={() => setLightboxOpen(true)}
            style={{
              width: '100%',
              height: 'auto',
              display: 'block',
              borderRadius: 8,
              cursor: 'zoom-in',
              boxShadow: hovered
                ? '0 4px 16px rgba(0, 0, 0, 0.12)'
                : '0 1px 3px rgba(0, 0, 0, 0.05)',
              border: hovered
                ? '1px solid var(--editor-border-focus)'
                : '1px solid var(--editor-border)',
              transition: 'box-shadow 150ms ease, border-color 150ms ease',
            }}
          />
        )}

        {/* 拖拽缩放手柄（右下角） */}
        {nativeFeaturesVisible && hovered && !loadError && (
          <Tooltip content="拖拽拉伸调节图片尺寸" side="left" sideOffset={6}>
            <div
              data-image-resize=""
              onMouseDown={handleResizeStart}
              aria-label="拖拽拉伸调节图片尺寸"
              style={{
                position: 'absolute',
                bottom: 4,
                right: 4,
                width: 14,
                height: 14,
                background: 'var(--accent-strong, #3b82f6)',
                borderRadius: '50%',
                cursor: 'ew-resize',
                border: '2px solid #ffffff',
                boxShadow: '0 2px 4px rgba(0, 0, 0, 0.25)',
                zIndex: 20,
              }}
            />
          </Tooltip>
        )}

      </div>

      {/* 大图预览 Lightbox 模态框 */}
      {lightboxOpen && resolvedDisplaySrc && (
        <ImageLightboxModal
          src={resolvedDisplaySrc}
          alt={alt}
          onClose={() => setLightboxOpen(false)}
          onOpenInTab={resolvedAbsPath ? handleOpenInTab : undefined}
          onRevealInDir={resolvedAbsPath ? handleRevealInDir : undefined}
        />
      )}
    </NodeViewWrapper>
  );
}

const actionBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  padding: '4px 6px',
  borderRadius: 4,
  cursor: 'pointer',
  color: 'var(--editor-text)',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'background var(--transition-fast)',
};

/** TipTap 增强版 Image 扩展定义 */
export const EnhancedImageBlock = ImageNode.extend({
  addNodeView() {
    return ReactNodeViewRenderer(ImageComponent);
  },

  addCommands() {
    return {
      setImage:
        (options: { src: string; alt?: string; title?: string; width?: string; align?: string }) =>
        ({ commands }: { commands: { insertContent: (content: unknown) => boolean } }) => {
          return commands.insertContent({
            type: 'image',
            attrs: options,
          });
        },
    } as never;
  },
});

