import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { getOperationOutputBounds, getOutputSize, sourceToOutput } from './geometry';
import type { Point } from './model';
import type { ImageCanvasInteraction } from './canvasInteraction';

export interface EraseCursorHandle { move(point: Point): void; hide(): void }

/** Pointer-only feedback has its own small render boundary; it never repaints the image. */
export const ImageEraseCursor = forwardRef<EraseCursorHandle, { controller: ImageCanvasInteraction; disabled: boolean }>(function ImageEraseCursor({ controller, disabled }, ref) {
  const [point, setPoint] = useState<Point | null>(null);
  const pending = useRef<Point | null>(null), frame = useRef<number | null>(null);
  useImperativeHandle(ref, () => ({
    move(value) {
      pending.current = value;
      if (frame.current === null) frame.current = requestAnimationFrame(() => { frame.current = null; setPoint(pending.current); });
    },
    hide() { pending.current = null; if (frame.current !== null) cancelAnimationFrame(frame.current); frame.current = null; setPoint(null); },
  }), []);
  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current); }, []);
  const radius = controller.getEraseRadius();
  if (!point || radius === null || disabled) return null;
  const recipe = controller.getRenderRecipe(), size = getOutputSize(recipe), targets = controller.getObjectEraseTargets(point);
  return <svg className="nb-ie-erase-overlay" viewBox={`0 0 ${size.width} ${size.height}`} aria-hidden="true" data-erase-radius={radius}>
    {targets.map(op => {
      if ('points' in op) return <polyline key={op.id} data-erase-target={op.id} points={op.points.map(p => { const out = sourceToOutput(p, recipe); return `${out.x},${out.y}`; }).join(' ')} fill="none" stroke="#ef4444" strokeWidth={6} vectorEffect="non-scaling-stroke" opacity={.65} strokeLinejoin="round" strokeLinecap="round"/>;
      const rect = getOperationOutputBounds(op, recipe);
      const props = { 'data-erase-target': op.id, fill: '#ef4444', fillOpacity: .14, stroke: '#ef4444', strokeWidth: 2, vectorEffect: 'non-scaling-stroke' };
      return op.type === 'ellipse' || (op.type === 'marker' && op.shape === 'circle') || (op.type === 'magnifier' && op.shape !== 'rectangle')
        ? <ellipse key={op.id} {...props} cx={rect.x + rect.width / 2} cy={rect.y + rect.height / 2} rx={rect.width / 2} ry={rect.height / 2}/>
        : <rect key={op.id} {...props} x={rect.x} y={rect.y} width={rect.width} height={rect.height}/>;
    })}
    <circle cx={point.x} cy={point.y} r={radius} fill="#ffffff" fillOpacity={.06} stroke="#111827" strokeWidth={3} vectorEffect="non-scaling-stroke"/>
    <circle cx={point.x} cy={point.y} r={radius} fill="none" stroke="#ffffff" strokeWidth={1} vectorEffect="non-scaling-stroke"/>
  </svg>;
});
