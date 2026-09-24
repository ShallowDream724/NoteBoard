export type TooltipSide = 'top' | 'bottom' | 'left' | 'right';

/** Cursor tips use their measured size, not a guessed half-width. */
export function placeCursorTooltip(point: { x: number; y: number }, size: { width: number; height: number },
  viewport: { width: number; height: number }, side: TooltipSide, align: 'start' | 'center' | 'end', gap: number) {
  const margin = 8;
  const offset = (length: number) => align === 'start' ? 0 : align === 'end' ? length : length / 2;
  const candidate = (side: TooltipSide) => ({
    x: side === 'left' ? point.x - gap - size.width : side === 'right' ? point.x + gap : point.x - offset(size.width),
    y: side === 'top' ? point.y - gap - size.height : side === 'bottom' ? point.y + gap : point.y - offset(size.height),
  });
  const opposite = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' } as const;
  const overflow = ({ x, y }: { x: number; y: number }) => Math.max(0, margin - x) + Math.max(0, margin - y)
    + Math.max(0, x + size.width + margin - viewport.width) + Math.max(0, y + size.height + margin - viewport.height);
  const first = candidate(side), flipped = candidate(opposite[side]);
  const best = overflow(flipped) < overflow(first) ? flipped : first;
  return { x: Math.max(margin, Math.min(best.x, viewport.width - size.width - margin)),
    y: Math.max(margin, Math.min(best.y, viewport.height - size.height - margin)) };
}
