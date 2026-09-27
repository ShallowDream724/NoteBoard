import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { getOutputSize, getSourceTransform, type ResizeHandle } from './geometry';
import type { ImageEditRecipe, Point, Rect } from './model';
import type { ImageResource } from './resources';
import { renderImageEdit } from './renderer';
import type { ImageCanvasInteraction } from './canvasInteraction';
import { measureTextLayout } from './textMetrics';
import './imageCanvasStage.css';

interface Props {
  controller: ImageCanvasInteraction;
  resource: ImageResource;
  zoom: number;
  onZoom(factor: number): void;
  disabled: boolean;
  onScale?(displayScale: number): void;
}

const HANDLE_NAMES: Record<ResizeHandle, string> = {
  nw: '左上', n: '上方', ne: '右上', e: '右侧', se: '右下', s: '下方', sw: '左下', w: '左侧',
};
const HANDLE_CURSORS: Record<ResizeHandle, string> = {
  nw: 'nwse-resize', n: 'ns-resize', ne: 'nesw-resize', e: 'ew-resize',
  se: 'nwse-resize', s: 'ns-resize', sw: 'nesw-resize', w: 'ew-resize',
};

function positionedRect(rect: Rect, scale: number): CSSProperties {
  return { left: rect.x * scale, top: rect.y * scale, width: rect.width * scale, height: rect.height * scale };
}
function outputPoint(event: { clientX: number; clientY: number }, surface: HTMLElement, recipe: ImageEditRecipe): Point {
  const box = surface.getBoundingClientRect(), size = getOutputSize(recipe);
  return { x: (event.clientX - box.left) / box.width * size.width, y: (event.clientY - box.top) / box.height * size.height };
}

export function ImageCanvasStage({ controller, resource, zoom, onZoom, disabled, onScale }: Props) {
  const stageRef = useRef<HTMLDivElement>(null), surfaceRef = useRef<HTMLDivElement>(null), canvasRef = useRef<HTMLCanvasElement>(null), textRef = useRef<HTMLTextAreaElement>(null);
  const activePointer = useRef<number | null>(null), keepTextOnBlur = useRef(false), lastScale = useRef<number | null>(null);
  const touches = useRef(new Map<number, Point>()), pinchDistance = useRef<number | null>(null), suppressTouch = useRef(false);
  const onZoomRef = useRef(onZoom), disabledRef = useRef(disabled);
  onZoomRef.current = onZoom; disabledRef.current = disabled;
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const subscribe = useCallback((notify: () => void) => controller.subscribe(notify), [controller]);
  const getVersion = useCallback(() => controller.getVersion(), [controller]);
  const version = useSyncExternalStore(subscribe, getVersion, getVersion);
  const recipe = controller.getRenderRecipe();
  const output = getOutputSize(recipe);
  const fit = Math.max(.001, Math.min(1, (viewport.width - 48) / output.width, (viewport.height - 48) / output.height));
  const scale = fit * zoom;
  const displayWidth = Math.max(1, output.width * scale), displayHeight = Math.max(1, output.height * scale);
  const cropBounds = controller.crop ? controller.getCropBounds() : null;
  const selectionBounds = controller.getSelectionBounds();
  const handles = controller.getHandles();
  const textOperation = controller.text?.operation;

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => {
      const width = stage.clientWidth, height = stage.clientHeight;
      setViewport(previous => previous.width === width && previous.height === height ? previous : { width, height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!viewport.width || !viewport.height) return;
    if (lastScale.current !== scale) { lastScale.current = scale; onScale?.(scale); }
  }, [scale, onScale, viewport.width, viewport.height]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || resource.disposed) return;
    const frame = requestAnimationFrame(() => {
      if (resource.disposed) return;
      const density = Math.min(window.devicePixelRatio || 1, 4096 / Math.max(displayWidth, displayHeight));
      const width = Math.max(1, Math.round(displayWidth * density)), height = Math.max(1, Math.round(displayHeight * density));
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      const context = canvas.getContext('2d');
      if (context) renderImageEdit(context, resource, controller.getRenderRecipe());
    });
    return () => cancelAnimationFrame(frame);
  }, [controller, resource, version, displayWidth, displayHeight]);
  useEffect(() => {
    const canvas = canvasRef.current;
    return () => { if (canvas) { canvas.width = 0; canvas.height = 0; } };
  }, []);
  useEffect(() => {
    if (!textOperation) return;
    const frame = requestAnimationFrame(() => textRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [textOperation?.id]);
  useEffect(() => {
    if (!textOperation) return;
    const notePointerTarget = (event: PointerEvent) => {
      keepTextOnBlur.current = event.target instanceof Element && !!event.target.closest('.nb-ie-properties');
    };
    document.addEventListener('pointerdown', notePointerTarget, true);
    return () => document.removeEventListener('pointerdown', notePointerTarget, true);
  }, [textOperation?.id]);
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const wheel = (event: WheelEvent) => {
      if (disabledRef.current) return;
      const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? stageRef.current?.clientHeight || 800 : 1);
      const factor = Math.exp(-Math.max(-200, Math.min(200, pixels)) * .002);
      if (controller.selectedOperation()) {
        if (controller.scaleSelected(factor)) event.preventDefault();
      } else if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        onZoomRef.current(factor);
      }
    };
    surface.addEventListener('wheel', wheel, { passive: false });
    return () => { surface.removeEventListener('wheel', wheel); controller.endWheel(); };
  }, [controller]);

  const location = (event: { clientX: number; clientY: number }) => outputPoint(event, surfaceRef.current!, controller.getRenderRecipe());
  const tolerance = 6 / Math.max(scale, .001);
  const touchDistance = () => {
    const pair = [...touches.current.values()].slice(0, 2);
    return pair.length === 2 ? Math.hypot(pair[1].x - pair[0].x, pair[1].y - pair[0].y) : null;
  };
  const release = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const finishTouch = (event: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const wasPinching = pinchDistance.current !== null || suppressTouch.current;
    touches.current.delete(event.pointerId);
    release(event);
    if (wasPinching) {
      activePointer.current = null;
      if (touches.current.size < 2) { pinchDistance.current = null; controller.endWheel(); }
      else pinchDistance.current = touchDistance();
      suppressTouch.current = touches.current.size > 0;
      return;
    }
    if (activePointer.current === event.pointerId) {
      activePointer.current = null;
      if (cancelled || disabled) controller.cancelGesture();
      else controller.pointerUp();
    }
  };
  const pointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || event.button !== 0) return;
    if (event.pointerType === 'touch') {
      touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      event.currentTarget.setPointerCapture(event.pointerId);
      if (touches.current.size >= 2) {
        event.preventDefault();
        if (touches.current.size === 2) { controller.cancelGesture(); activePointer.current = null; }
        pinchDistance.current = touchDistance(); suppressTouch.current = true;
        return;
      }
      if (suppressTouch.current) return;
    }
    if (activePointer.current !== null) return;
    event.preventDefault();
    canvasRef.current?.focus({ preventScroll: true });
    const handle = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-handle]')?.dataset.handle as ResizeHandle | undefined : undefined;
    controller.pointerDown(location(event), { tolerance, alt: event.altKey, handle });
    activePointer.current = event.pointerId;
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.setPointerCapture(event.pointerId);
  };
  const pointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (event.pointerType === 'touch' && touches.current.has(event.pointerId)) {
      touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pinchDistance.current !== null && touches.current.size >= 2) {
        const distance = touchDistance();
        if (distance !== null) {
          if (pinchDistance.current > 0 && distance > 0) {
            const factor = Math.max(.5, Math.min(2, distance / pinchDistance.current));
            if (controller.selectedOperation()) controller.scaleSelected(factor);
            else onZoomRef.current(factor);
          }
          pinchDistance.current = distance;
        }
        event.preventDefault(); return;
      }
      if (suppressTouch.current) return;
    }
    const point = location(event);
    // Polyline previews keep following the pointer after each click releases capture.
    if (activePointer.current === null || activePointer.current === event.pointerId) controller.pointerMove(point, tolerance);
    event.currentTarget.style.cursor = controller.cursor(point, tolerance, event.altKey);
  };
  const pointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch' && touches.current.has(event.pointerId)) { finishTouch(event, false); return; }
    if (activePointer.current !== event.pointerId) return;
    release(event);
    activePointer.current = null;
    if (disabled) controller.cancelGesture();
    else controller.pointerUp();
    event.currentTarget.style.cursor = controller.cursor(location(event), tolerance, event.altKey);
  };
  const pointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch' && touches.current.has(event.pointerId)) { finishTouch(event, true); return; }
    if (activePointer.current !== event.pointerId) return;
    release(event);
    activePointer.current = null; controller.cancelGesture();
  };

  const sourceMatrix = getSourceTransform(recipe);
  const textLayout = textOperation ? measureTextLayout(textOperation) : null;
  const textWidth = textLayout ? Math.max(160, textLayout.width + 24) : 0;
  const textHeight = textLayout ? Math.max(textLayout.lineHeight * 2, textLayout.height) + 8 : 0;
  const textStyle: CSSProperties | undefined = textOperation ? {
    width: textWidth, height: textHeight, left: 0, top: 0,
    transform: `matrix(${sourceMatrix[0] * scale}, ${sourceMatrix[1] * scale}, ${sourceMatrix[2] * scale}, ${sourceMatrix[3] * scale}, ${(sourceMatrix[0] * textOperation.position.x + sourceMatrix[2] * textOperation.position.y + sourceMatrix[4]) * scale}, ${(sourceMatrix[1] * textOperation.position.x + sourceMatrix[3] * textOperation.position.y + sourceMatrix[5]) * scale})`,
    fontSize: textOperation.fontSize, fontFamily: textOperation.fontFamily ?? 'sans-serif',
    fontWeight: textOperation.bold ? 700 : 400, fontStyle: textOperation.italic ? 'italic' : 'normal', color: textOperation.color,
  } : undefined;
  return <div ref={stageRef} className="nb-ie-stage" onPointerDown={event => { if (!disabled && event.target === event.currentTarget) controller.outside(); }}
    onContextMenu={event => { if (event.target instanceof Element && event.target.closest('textarea')) return; event.preventDefault(); if (disabled) return; if (event.target === event.currentTarget) controller.outside(); else controller.finishPolyline(); }}>
    <div ref={surfaceRef} className="nb-ie-canvas-wrap nb-ie-interactive-surface" style={{ width: displayWidth, height: displayHeight }}
      onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerCancel}
      onDoubleClick={event => { if (!disabled && !(event.target instanceof Element && event.target.closest('textarea,[data-handle]'))) controller.doubleClick(location(event), tolerance); }}>
      <canvas ref={canvasRef} tabIndex={0} aria-label="图片编辑画布" style={{ width: displayWidth, height: displayHeight }}/>
      {cropBounds && <div className="nb-ie-crop-overlay" aria-hidden="true">
        <div className="nb-ie-crop-shade" style={{ left: 0, top: 0, width: displayWidth, height: Math.max(0, cropBounds.y * scale) }}/>
        <div className="nb-ie-crop-shade" style={{ left: 0, top: cropBounds.y * scale, width: Math.max(0, cropBounds.x * scale), height: cropBounds.height * scale }}/>
        <div className="nb-ie-crop-shade" style={{ left: (cropBounds.x + cropBounds.width) * scale, top: cropBounds.y * scale, width: Math.max(0, displayWidth - (cropBounds.x + cropBounds.width) * scale), height: cropBounds.height * scale }}/>
        <div className="nb-ie-crop-shade" style={{ left: 0, top: (cropBounds.y + cropBounds.height) * scale, width: displayWidth, height: Math.max(0, displayHeight - (cropBounds.y + cropBounds.height) * scale) }}/>
        <div className="nb-ie-crop-frame" style={positionedRect(cropBounds, scale)}><span/><span/><span/><span/></div>
      </div>}
      {!cropBounds && selectionBounds && <div className="nb-ie-selection-frame" style={positionedRect(selectionBounds, scale)} aria-hidden="true"/>}
      {handles.map(({ handle, x, y }) => <button key={handle} type="button" data-handle={handle} className="nb-ie-resize-handle"
        aria-label={`缩放标注 ${handle}`} title={`拖动${HANDLE_NAMES[handle]}控制点缩放`}
        style={{ left: x * scale, top: y * scale, cursor: HANDLE_CURSORS[handle] }} disabled={disabled}
        onKeyDown={event => {
          const step = (event.shiftKey ? 10 : 1) / Math.max(scale, .001);
          const delta = event.key === 'ArrowLeft' ? { x: -step, y: 0 } : event.key === 'ArrowRight' ? { x: step, y: 0 } : event.key === 'ArrowUp' ? { x: 0, y: -step } : event.key === 'ArrowDown' ? { x: 0, y: step } : null;
          if (!delta || disabled) return;
          event.preventDefault(); event.stopPropagation();
          controller.pointerDown({ x, y }, { tolerance, handle });
          controller.pointerMove({ x: x + delta.x, y: y + delta.y }, tolerance);
          controller.pointerUp();
        }}/>)}
      {textOperation && <textarea ref={textRef} className="nb-ie-canvas-text" aria-label="画布文字" value={textOperation.text} placeholder="输入文字" wrap="off" spellCheck={false}
        style={textStyle} onChange={event => controller.updateText(event.target.value)}
        onPointerDown={event => event.stopPropagation()} onPointerMove={event => event.stopPropagation()}
        onBlur={event => {
          const intoProperties = event.relatedTarget instanceof Element && !!event.relatedTarget.closest('.nb-ie-properties');
          if (!intoProperties && !keepTextOnBlur.current) controller.finishText();
          keepTextOnBlur.current = false;
        }}
        onKeyDown={event => {
          event.stopPropagation();
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Escape' || (event.key === 'Enter' && (event.ctrlKey || event.metaKey))) {
            event.preventDefault(); controller.finishText();
          }
        }}/>}
    </div>
  </div>;
}
