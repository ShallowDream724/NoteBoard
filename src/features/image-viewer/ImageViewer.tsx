// NoteBoard 现代化图片查看器组件
// 支持常见及特殊图片格式：PNG, JPG, JPEG, SVG, BMP, GIF, WEBP, ICO 等
// 功能：平移拖拽、无级缩放（自适应/1:1/自定义）、旋转/翻转、棋盘网格背景切换、元数据展示及快捷操作

import { useState, useRef, useEffect, useCallback, useMemo, lazy, Suspense } from 'react';
// 🔴 S11：回收视图状态存取与能力注册
import { takeViewState } from '../session/editorSuspension';
import { registerEditorCapabilities } from '../../core/editor/editorRegistry';
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  RotateCw,
  RotateCcw,
  FlipHorizontal,
  FlipVertical,
  ExternalLink,
  FolderOpen,
  Copy,
  Check,
  Sparkles,
  Grid,
  Pencil,
  Code2,
  Image as ImageIcon,
} from 'lucide-react';
import { convertFileSrc } from '@tauri-apps/api/core';
import * as ipc from '../../core/ipc/commands';
import { extFromPath } from '../../core/docKind';
import { showToast } from '../../stores/toastStore';
import { Tooltip } from '../../components/Tooltip';
import { scaleImageAt, useImageWheelGesture } from './imageWheelGesture';
import { on, off } from '../../core/emitter';
import { sameKey } from '../explorer/pathUtils';
import { applyImageTransform, imageTransformCss, type ImageTransform } from '../image/sharedTransform';
import { copyImageSource } from '../image/imageClipboard';
import { getFileFormat } from '../../core/fileFormats';
import { ImageStatus, type ImageSize } from './ImageStatusSlot';
import type { SvgSourceViewerHandle } from './SvgSourceViewer';

const SvgSourceViewer = lazy(() => import('./SvgSourceViewer').then(module => ({ default: module.SvgSourceViewer })));

interface ImageViewerProps {
  docKey: string;
  filePath: string;
  fileName?: string;
}

type BgMode = 'grid' | 'dark' | 'light' | 'black';

export function ImageViewer({ docKey, filePath, fileName }: ImageViewerProps) {
  const name = fileName || filePath.split(/[\\/]/).pop() || filePath;
  const format = extFromPath(filePath).toUpperCase() || '图片';
  const isSvg = getFileFormat(filePath).preview === 'svg';
  const [sourceFilePath, setSourceFilePath] = useState<string | null>(null);
  const showSource = isSvg && sourceFilePath === filePath;
  const sourceViewerRef = useRef<SvgSourceViewerHandle | null>(null);
  useEffect(() => { setSourceFilePath(null); }, [docKey, filePath]);
  const editorOpenEpoch = useRef(0);
  useEffect(() => { editorOpenEpoch.current++; return () => { editorOpenEpoch.current++; }; }, [docKey, filePath]);

  // 将本地路径转换为 asset: / webview 协议 URL
  const fileSrc = useMemo(() => {
    try {
      return convertFileSrc(filePath);
    } catch {
      return filePath;
    }
  }, [filePath]);
  const [restoredSource, setRestoredSource] = useState<{ filePath: string; revision: number }>();
  const imgSrc = restoredSource?.filePath === filePath ? `${fileSrc}?edited=${restoredSource.revision}` : fileSrc;
  useEffect(() => {
    const restored = ({ path }: { path: string }) => {
      if (sameKey(path, filePath)) setRestoredSource({ filePath, revision: Date.now() });
    };
    on('image-file-restored', restored);
    return () => off('image-file-restored', restored);
  }, [filePath]);

  const [loadResult, setLoadResult] = useState<{ src: string; size: ImageSize | null }>();
  const currentLoad = loadResult?.src === imgSrc ? loadResult : undefined;
  const naturalSize = currentLoad?.size ?? null;
  const loadError = currentLoad?.size === null;
  const [copied, setCopied] = useState(false);
  const copyInFlightRef = useRef(false);

  // 查看器变换状态：缩放比例、平移位移 (tx, ty)、旋转角度 (0/90/180/270)、水平/垂直翻转
  const [scale, setScale] = useState<number>(1);
  const [translate, setTranslate] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [transform, setTransform] = useState<ImageTransform>({ rotation: 0, flipX: false, flipY: false });
  const [bgMode, setBgMode] = useState<BgMode>('grid');

  // 🔴 S11：查看器变换状态的 ref 镜像（回收捕获读取最新值，避开闭包过期）
  const viewStateRef = useRef({ scale: 1, translate: { x: 0, y: 0 }, transform, bgMode: 'grid' as BgMode });
  const restoredViewRef = useRef(false);
  useEffect(() => {
    viewStateRef.current = { scale, translate, transform, bgMode };
  }, [scale, translate, transform, bgMode]);

  // 🔴 S11：注册图片查看能力（只读 flush + 视图状态捕获；重挂载恢复查看状态）
  useEffect(() => {
    const restore = takeViewState(docKey) as {
      kind: 'image';
      scale: number;
      translate: { x: number; y: number };
      rotation: number;
      flipH: boolean;
      flipV?: boolean;
      bgMode: BgMode;
    } | null;
    if (restore?.kind === 'image') {
      restoredViewRef.current = true;
      setScale(restore.scale);
      setTranslate(restore.translate);
      const quarterTurns = (((restore.rotation / 90) % 4 + 4) % 4) as ImageTransform['rotation'];
      // Earlier snapshots mirrored the source X axis because CSS applied scaleX before rotate.
      const legacyOddRotation = restore.flipV === undefined && quarterTurns % 2 === 1;
      setTransform({
        rotation: quarterTurns,
        flipX: legacyOddRotation ? false : !!restore.flipH,
        flipY: legacyOddRotation ? !!restore.flipH : !!restore.flipV,
      });
      setBgMode(restore.bgMode);
    }
    const instanceId = `img-${docKey}`;
    const dispose = registerEditorCapabilities({
      docKey,
      instanceId,
      getRevision: () => 0,
      flush: async () => ({ docKey, instanceId, revision: 0, content: null, readonly: true }),
      focus: () => sourceViewerRef.current ? sourceViewerRef.current.focus() : containerRef.current?.focus({ preventScroll: true }),
      getSelectedText: () => sourceViewerRef.current?.getSelectedText() ?? '',
      canSuspend: () => true,
      captureViewState: () => ({
        kind: 'image' as const,
        scale: viewStateRef.current.scale,
        translate: viewStateRef.current.translate,
        rotation: viewStateRef.current.transform.rotation * 90,
        flipH: viewStateRef.current.transform.flipX,
        flipV: viewStateRef.current.transform.flipY,
        bgMode: viewStateRef.current.bgMode,
      }),
    });
    return dispose;
  }, [docKey]);

  // 拖拽相关
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ startX: number; startY: number; initTx: number; initTy: number }>({
    startX: 0,
    startY: 0,
    initTx: 0,
    initTy: 0,
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const wheelGesture = useImageWheelGesture(containerRef, { scale, ...translate }, next => { setScale(next.scale); setTranslate({ x: next.x, y: next.y }); }, { min: Math.min(.05, scale), max: 20 });
  const pointer = useRef<{ x: number; y: number } | null>(null);

  // 自适应窗口缩放
  const fitToWindow = useCallback(() => {
    if (!containerRef.current || !naturalSize) {
      setScale(1);
      setTranslate({ x: 0, y: 0 });
      return;
    }

    const { clientWidth: cw, clientHeight: ch } = containerRef.current;
    const padding = 48;
    const availW = Math.max(cw - padding, 100);
    const availH = Math.max(ch - padding, 100);

    // 计算旋转后的宽高
    const isRotated = transform.rotation % 2 !== 0;
    const curW = isRotated ? naturalSize.height : naturalSize.width;
    const curH = isRotated ? naturalSize.width : naturalSize.height;

    const scaleX = availW / curW;
    const scaleY = availH / curH;
    const fitScale = Math.min(scaleX, scaleY, 1); // 默认最大不超过 100%

    setScale(fitScale);
    setTranslate({ x: 0, y: 0 });
  }, [naturalSize, transform.rotation]);

  // 当图片首次加载完成时
  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth, naturalHeight } = e.currentTarget;
    setLoadResult({ src: imgSrc, size: { width: naturalWidth, height: naturalHeight } });

    // 初始自适应窗口
    if (containerRef.current && !restoredViewRef.current) {
      const { clientWidth: cw, clientHeight: ch } = containerRef.current;
      const padding = 48;
      const scaleX = (cw - padding) / naturalWidth;
      const scaleY = (ch - padding) / naturalHeight;
      const fitScale = Math.min(scaleX, scaleY, 1);
      if (fitScale > 0) setScale(fitScale);
      setTranslate({ x: 0, y: 0 });
    }
  };

  // 1:1 实际尺寸
  const resetToActual = () => {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  };

  // 缩放步进调节
  const stepZoom = (factor: number, at = { x: 0, y: 0 }) => {
    const next = scaleImageAt({ scale, ...translate }, Math.min(20, Math.max(Math.min(.05, scale), scale * factor)), at);
    setScale(next.scale);
    setTranslate({ x: next.x, y: next.y });
  };

  // 旋转
  const rotateCw = () => setTransform((prev) => applyImageTransform(prev, 'rotate-cw'));
  const rotateCcw = () => setTransform((prev) => applyImageTransform(prev, 'rotate-ccw'));

  // 水平翻转
  const toggleFlipH = () => setTransform((prev) => applyImageTransform(prev, 'flip-horizontal'));
  const toggleFlipV = () => setTransform((prev) => applyImageTransform(prev, 'flip-vertical'));

  // 拖拽平移事件处理
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0 && e.button !== 1) return; // 仅响应左键与中键拖拽
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    containerRef.current?.focus({ preventScroll: true });
    setIsDragging(true);
    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initTx: translate.x,
      initTy: translate.y,
    };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    pointer.current = { x: e.clientX, y: e.clientY };
    if (!isDragging) return;
    const dx = e.clientX - dragStartRef.current.startX;
    const dy = e.clientY - dragStartRef.current.startY;
    setTranslate({
      x: dragStartRef.current.initTx + dx,
      y: dragStartRef.current.initTy + dy,
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // 复制源图像；视图里的旋转与镜像不进入剪贴板。
  const handleCopyImage = async () => {
    if (!imgSrc || !naturalSize || copyInFlightRef.current) return;
    copyInFlightRef.current = true;
    try {
      await copyImageSource(imgSrc, naturalSize, filePath);
      setCopied(true);
      showToast('图片已复制到剪贴板', 'success');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast('复制图片失败', 'error');
    } finally {
      copyInFlightRef.current = false;
    }
  };

  // 背景风格样式
  const getBgStyle = (): React.CSSProperties => {
    switch (bgMode) {
      case 'grid':
        return {
          backgroundImage: `
            linear-gradient(45deg, rgba(128,128,128,0.12) 25%, transparent 25%),
            linear-gradient(-45deg, rgba(128,128,128,0.12) 25%, transparent 25%),
            linear-gradient(45deg, transparent 75%, rgba(128,128,128,0.12) 75%),
            linear-gradient(-45deg, transparent 75%, rgba(128,128,128,0.12) 75%)
          `,
          backgroundSize: '16px 16px',
          backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
          backgroundColor: 'var(--editor-bg)',
        };
      case 'dark':
        return { backgroundColor: '#18181b' };
      case 'light':
        return { backgroundColor: '#f4f4f5' };
      case 'black':
        return { backgroundColor: '#000000' };
    }
  };

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        overflow: 'hidden',
        userSelect: 'none',
        ...getBgStyle(),
      }}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onKeyDown={event => {
        if (showSource || !(event.ctrlKey || event.metaKey) || event.altKey) return;
        if (!['+', '=', '-', '0'].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        if (event.key === '0') { fitToWindow(); return; }
        const bounds = containerRef.current?.getBoundingClientRect(), point = pointer.current;
        stepZoom(event.key === '-' ? 1 / 1.25 : 1.25, bounds && point
          ? { x: point.x - bounds.left - bounds.width / 2, y: point.y - bounds.top - bounds.height / 2 } : undefined);
      }}
    >
      {/* 顶部悬浮控制工具栏 */}
      <div
        style={{
          position: 'absolute',
          top: 14,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 20,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '4px 8px',
          background: 'var(--editor-surface, rgba(255, 255, 255, 0.85))',
          backdropFilter: 'blur(8px)',
          border: '1px solid var(--editor-border)',
          borderRadius: 8,
          boxShadow: 'var(--shadow-md, 0 4px 6px -1px rgba(0, 0, 0, 0.1))',
          color: 'var(--editor-text)',
        }}
      >
        {!showSource && <>
        {/* 缩小 */}
        <Tooltip content="缩小 (滚轮下滑)" side="bottom" sideOffset={6}>
          <button
            type="button"
            onClick={() => stepZoom(1 / 1.25)}
            style={btnStyle}
            aria-label="缩小"
          >
            <ZoomOut size={15} />
          </button>
        </Tooltip>

        {/* 缩放百分比 / 1:1 快捷切换 */}
        <Tooltip content="点击重置为 100% 实际大小" side="bottom" sideOffset={6}>
          <button
            type="button"
            onClick={resetToActual}
            style={{
              ...btnStyle,
              minWidth: 48,
              fontSize: 12,
              fontWeight: 500,
              fontFamily: 'var(--mono-font-family, monospace)',
            }}
            aria-label="重置为 100%"
          >
            {Math.round(scale * 100)}%
          </button>
        </Tooltip>

        {/* 放大 */}
        <Tooltip content="放大 (滚轮上滑)" side="bottom" sideOffset={6}>
          <button
            type="button"
            onClick={() => stepZoom(1.25)}
            style={btnStyle}
            aria-label="放大"
          >
            <ZoomIn size={15} />
          </button>
        </Tooltip>

        {/* 自适应窗口 */}
        <Tooltip content="自适应窗口大小" side="bottom" sideOffset={6}>
          <button
            type="button"
            onClick={fitToWindow}
            style={btnStyle}
            aria-label="自适应窗口"
          >
            <Maximize2 size={15} />
          </button>
        </Tooltip>

        <div style={{ width: 1, height: 16, background: 'var(--editor-border)', margin: '0 4px' }} />

        {/* 逆时针旋转 */}
        <Tooltip content="逆时针旋转 90°" side="bottom" sideOffset={6}>
          <button
            type="button"
            onClick={rotateCcw}
            style={btnStyle}
            aria-label="逆时针旋转 90°"
          >
            <RotateCcw size={15} />
          </button>
        </Tooltip>

        {/* 顺时针旋转 */}
        <Tooltip content="顺时针旋转 90°" side="bottom" sideOffset={6}>
          <button
            type="button"
            onClick={rotateCw}
            style={btnStyle}
            aria-label="顺时针旋转 90°"
          >
            <RotateCw size={15} />
          </button>
        </Tooltip>

        {/* 水平翻转 */}
        <Tooltip content="水平翻转" side="bottom" sideOffset={6}>
          <button
            type="button"
            onClick={toggleFlipH}
            style={{
              ...btnStyle,
              background: transform.flipX ? 'var(--toolbar-hover)' : 'transparent',
            }}
            aria-label="水平翻转"
          >
            <FlipHorizontal size={15} />
          </button>
        </Tooltip>

        <Tooltip content="垂直翻转" side="bottom" sideOffset={6}>
          <button
            type="button"
            onClick={toggleFlipV}
            style={{ ...btnStyle, background: transform.flipY ? 'var(--toolbar-hover)' : 'transparent' }}
            aria-label="垂直翻转"
          >
            <FlipVertical size={15} />
          </button>
        </Tooltip>

        <div style={{ width: 1, height: 16, background: 'var(--editor-border)', margin: '0 4px' }} />

        {/* 棋盘/纯色背景切换 */}
        <Tooltip content={`切换查看背景 (当前: ${bgMode})`} side="bottom" sideOffset={6}>
          <button
            type="button"
            onClick={() => {
              const nextMode: Record<BgMode, BgMode> = {
                grid: 'dark',
                dark: 'light',
                light: 'black',
                black: 'grid',
              };
              setBgMode(nextMode[bgMode]);
            }}
            style={btnStyle}
            aria-label="切换背景"
          >
            <Grid size={15} />
          </button>
        </Tooltip>

        <div style={{ width: 1, height: 16, background: 'var(--editor-border)', margin: '0 4px' }} />

        {/* 复制图片 */}
        <Tooltip content="编辑图片" side="bottom" sideOffset={6}>
          <button type="button" aria-label="编辑图片" disabled={!imgSrc || loadError} style={btnStyle}
            onClick={async () => {
              const epoch = editorOpenEpoch.current;
              try {
                const { editImageFile } = await import('../image-editor/integration');
                if (epoch !== editorOpenEpoch.current) return;
                await editImageFile(docKey, filePath, imgSrc, name);
              } catch { showToast('图片编辑器加载失败', 'error'); }
            }}><Pencil size={15} /></button>
        </Tooltip>

        <Tooltip content="复制图片到剪贴板" side="bottom" sideOffset={6}>
          <button
            type="button"
            onClick={handleCopyImage}
            style={btnStyle}
            aria-label="复制图片"
          >
            {copied ? <Check size={15} color="var(--success-600)" /> : <Copy size={15} />}
          </button>
        </Tooltip>
        </>}

        {isSvg && (
          <Tooltip content={showSource ? '返回图片预览' : '查看 SVG 源码'} side="bottom" sideOffset={6}>
            <button
              type="button"
              onClick={() => { setIsDragging(false); setSourceFilePath(showSource ? null : filePath); }}
              style={btnStyle}
              aria-label={showSource ? '查看图片' : '查看 SVG 源码'}
              aria-pressed={showSource}
            >
              {showSource ? <ImageIcon size={15} /> : <Code2 size={15} />}
            </button>
          </Tooltip>
        )}

        {/* 在文件管理器中定位 */}
        <Tooltip content="在文件管理器中定位" side="bottom" sideOffset={6}>
          <button
            type="button"
            onClick={() => ipc.revealInExplorer(filePath)}
            style={btnStyle}
            aria-label="在文件管理器中定位"
          >
            <FolderOpen size={15} />
          </button>
        </Tooltip>

        {/* 用系统默认应用打开 */}
        <Tooltip content="用系统默认程序打开" side="bottom" sideOffset={6}>
          <button
            type="button"
            onClick={() => ipc.openWithDefaultApp(filePath)}
            style={btnStyle}
            aria-label="用系统默认程序打开"
          >
            <ExternalLink size={15} />
          </button>
        </Tooltip>
      </div>

      {/* 图片主视口渲染画布 */}
      <div
        ref={containerRef}
        tabIndex={showSource ? -1 : 0}
        aria-label={`图片预览：${name}`}
        onMouseLeave={() => { pointer.current = null; }}
        style={{
          flex: 1,
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          cursor: isDragging ? 'grabbing' : 'grab',
          position: 'relative',
          visibility: showSource ? 'hidden' : 'visible',
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onDoubleClick={fitToWindow}
      >
        {loadError ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 12,
              color: 'var(--editor-text-muted)',
              textAlign: 'center',
            }}
          >
            <Sparkles size={32} />
            <div>无法预览图片，文件可能已损坏或路径不可访问</div>
            <button
              type="button"
              onClick={() => ipc.openWithDefaultApp(filePath)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                borderRadius: 6,
                border: '1px solid var(--editor-border)',
                background: 'var(--editor-surface)',
                color: 'var(--editor-text)',
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              <ExternalLink size={13} />
              <span>用系统默认程序打开</span>
            </button>
          </div>
        ) : (
          /* 禁用 Referer 携带，防止外部或远程图片被防盗链拦截 */
          <img
            key={imgSrc}
            data-image-preview-transform=""
            src={imgSrc || undefined}
            alt={name}
            referrerPolicy="no-referrer"
            onLoad={handleImageLoad}
            onError={() => setLoadResult({ src: imgSrc, size: null })}
            draggable={false}
            style={{
              transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale}) ${imageTransformCss(transform)}`,
              transformOrigin: 'center center',
              transition: isDragging || wheelGesture ? 'none' : 'transform 0.08s ease-out',
              maxWidth: 'none',
              maxHeight: 'none',
              boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
              borderRadius: 2,
              pointerEvents: 'none', // 确保鼠标事件穿透由容器捕获处理
            }}
          />
        )}
      </div>

      {showSource && (
        <div style={{ position: 'absolute', inset: 0, paddingTop: 56, background: 'var(--editor-bg)', zIndex: 15 }}>
          <Suspense fallback={<div role="status" style={{ padding: 20, color: 'var(--editor-text-muted)' }}>正在加载 SVG 源码…</div>}>
            <SvgSourceViewer filePath={filePath} viewerRef={sourceViewerRef} />
          </Suspense>
        </div>
      )}

      <ImageStatus documentKey={docKey} size={naturalSize} scale={scale} format={format} />
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 28,
  height: 28,
  padding: 0,
  border: 'none',
  borderRadius: 4,
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
  transition: 'background var(--transition-fast)',
};
