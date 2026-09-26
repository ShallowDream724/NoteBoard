import { useLayoutEffect, useRef, useState } from 'react';
import { useImageWheelGesture } from '../image-viewer/imageWheelGesture';
import { diagramSvgSize, sizeDiagramSvg } from './svgSizing';

interface FullscreenDiagramViewportProps { svg: string; zoom?: number; onZoom?: (zoom: number) => void; fullscreen: true }
type SvgDiagramViewportProps = FullscreenDiagramViewportProps | { svg: string; fullscreen?: false };

/** Inline zoom owns only this SVG's layout. A real-sized stage lets the editor
 * grow vertically and makes both horizontal edges reachable, including at <1x.
 * Wheel bursts update refs and commit once per frame, without React/doc updates. */
function InlineDiagramViewport({ svg }: { svg: string }) {
  const viewport = useRef<HTMLDivElement>(null), stage = useRef<HTMLDivElement>(null), graphic = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const container = viewport.current, frame = stage.current, content = graphic.current;
    const element = content?.querySelector('svg');
    if (!container || !frame || !content || !element) return;
    sizeDiagramSvg(element);
    const intrinsic = diagramSvgSize(element) ?? element.getBoundingClientRect();
    if (intrinsic.width <= 0 || intrinsic.height <= 0) return;
    let width = container.clientWidth, scale = 1, drawnWidth = 0;
    let pending: number | null = null;
    let drag: { pointer: number; x: number; scroll: number } | null = null;
    const draw = () => {
      pending = null;
      if (width <= 0) return;
      const baseWidth = Math.min(intrinsic.width, width), baseHeight = intrinsic.height * baseWidth / intrinsic.width;
      const nextWidth = baseWidth * scale, scroll = drawnWidth ? container.scrollLeft * nextWidth / drawnWidth : 0;
      content.style.width = `${baseWidth}px`;
      content.style.height = `${baseHeight}px`;
      content.style.transform = `scale(${scale})`;
      // Layout rounds fractional CSS pixels; reserve the outer pixel so the
      // clipping stage cannot shave a stroke from the transformed SVG edge.
      frame.style.width = `${Math.ceil(nextWidth)}px`;
      frame.style.height = `${Math.ceil(baseHeight * scale)}px`;
      container.style.cursor = nextWidth > width ? 'grab' : '';
      container.scrollLeft = scroll;
      drawnWidth = nextWidth;
    };
    const schedule = () => { if (pending === null) pending = requestAnimationFrame(draw); };
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault(); event.stopPropagation();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? container.clientHeight : 1;
      const next = Math.max(.2, Math.min(8, scale * Math.exp(-event.deltaY * unit * .008)));
      if (next !== scale) { scale = next; schedule(); }
    };
    const pointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || event.pointerType === 'touch' || drawnWidth <= width) return;
      event.preventDefault(); event.stopPropagation();
      container.setPointerCapture(event.pointerId);
      drag = { pointer: event.pointerId, x: event.clientX, scroll: container.scrollLeft };
    };
    const pointerMove = (event: PointerEvent) => {
      if (drag?.pointer === event.pointerId) container.scrollLeft = drag.scroll + drag.x - event.clientX;
    };
    const pointerUp = (event: PointerEvent) => {
      if (drag?.pointer !== event.pointerId) return;
      drag = null;
      if (container.hasPointerCapture(event.pointerId)) container.releasePointerCapture(event.pointerId);
    };
    const pointerLost = () => { drag = null; };
    const resize = new ResizeObserver(entries => {
      const nextWidth = entries[0]?.contentRect.width;
      if (nextWidth !== undefined && nextWidth !== width) { width = nextWidth; schedule(); }
    });
    draw();
    resize.observe(container);
    container.addEventListener('wheel', wheel, { passive: false });
    container.addEventListener('pointerdown', pointerDown);
    container.addEventListener('pointermove', pointerMove);
    container.addEventListener('pointerup', pointerUp);
    container.addEventListener('pointercancel', pointerUp);
    container.addEventListener('lostpointercapture', pointerLost);
    return () => {
      resize.disconnect();
      if (pending !== null) cancelAnimationFrame(pending);
      container.removeEventListener('wheel', wheel);
      container.removeEventListener('pointerdown', pointerDown);
      container.removeEventListener('pointermove', pointerMove);
      container.removeEventListener('pointerup', pointerUp);
      container.removeEventListener('pointercancel', pointerUp);
      container.removeEventListener('lostpointercapture', pointerLost);
    };
  }, [svg]);
  return <div ref={viewport} data-diagram-viewport="inline" aria-label="图表预览，Ctrl 加滚轮或双指缩放" style={{ width: '100%', minWidth: 0, overflowX: 'auto', overflowY: 'hidden', overflowAnchor: 'none' }}>
    <div ref={stage} style={{ position: 'relative', marginInline: 'auto', overflow: 'hidden' }}>
      <div ref={graphic} style={{ transformOrigin: 'top left' }} dangerouslySetInnerHTML={{ __html: svg }}/>
    </div>
  </div>;
}

/** A view-only transform: never enters document attributes, history or exports. */
function FullscreenDiagramViewport({ svg, zoom, onZoom }: FullscreenDiagramViewportProps) {
  const viewport = useRef<HTMLDivElement>(null), graphic = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 });
  const drag = useRef<{ pointer: number; x: number; y: number; originX: number; originY: number } | null>(null);
  const current = zoom !== undefined && zoom !== transform.scale ? { scale: zoom, x: 0, y: 0 } : transform;
  useImageWheelGesture(viewport, current, next => { setTransform(next); onZoom?.(next.scale); }, { min: .2, max: 8, normalWheel: 'scroll' });
  useLayoutEffect(() => {
    const element = graphic.current?.querySelector('svg');
    if (element) sizeDiagramSvg(element);
  }, [svg]);
  return <div ref={viewport} aria-label="图表预览，Ctrl 加滚轮或双指缩放" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', minWidth: 0, overflow: 'hidden', cursor: current.scale > 1 ? 'grab' : undefined, height: '100%' }}
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

export function SvgDiagramViewport(props: SvgDiagramViewportProps) {
  return props.fullscreen ? <FullscreenDiagramViewport {...props}/> : <InlineDiagramViewport svg={props.svg}/>;
}
