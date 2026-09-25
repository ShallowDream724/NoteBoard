import { useLayoutEffect, useRef, useState } from 'react';
import { useImageWheelGesture } from '../image-viewer/imageWheelGesture';
import { sizeDiagramSvg } from './svgSizing';

/** A view-only transform: never enters document attributes, history or exports. */
export function SvgDiagramViewport({ svg, zoom, onZoom, fullscreen = false }: { svg: string; zoom?: number; onZoom?: (zoom: number) => void; fullscreen?: boolean }) {
  const viewport = useRef<HTMLDivElement>(null), graphic = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 });
  const drag = useRef<{ pointer: number; x: number; y: number; originX: number; originY: number } | null>(null);
  const current = zoom !== undefined && zoom !== transform.scale ? { scale: zoom, x: 0, y: 0 } : transform;
  useImageWheelGesture(viewport, current, next => { setTransform(next); onZoom?.(next.scale); }, { min: .2, max: 8, normalWheel: 'scroll' });
  useLayoutEffect(() => {
    const element = graphic.current?.querySelector('svg');
    if (element) sizeDiagramSvg(element);
  }, [svg]);
  return <div ref={viewport} aria-label="图表预览，Ctrl 加滚轮或双指缩放" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', minWidth: 0, overflow: 'hidden', cursor: current.scale > 1 ? 'grab' : undefined, ...(fullscreen ? { height: '100%' } : {}) }}
    onPointerDown={event => {
      if (event.button !== 0 || current.scale <= 1) return;
      event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, originX: current.x, originY: current.y };
    }}
    onPointerMove={event => {
      const start = drag.current; if (!start || event.pointerId !== start.pointer) return;
      setTransform({ ...current, x: start.originX + event.clientX - start.x, y: start.originY + event.clientY - start.y });
    }}
    onPointerUp={event => { if (drag.current?.pointer === event.pointerId) { drag.current = null; event.currentTarget.releasePointerCapture(event.pointerId); } }}
    onLostPointerCapture={() => { drag.current = null; }}>
    <div ref={graphic} style={{ maxWidth: '100%', transform: `translate(${current.x}px, ${current.y}px) scale(${current.scale})`, transformOrigin: 'center', flexShrink: 0 }} dangerouslySetInnerHTML={{ __html: svg }}/>
  </div>;
}
