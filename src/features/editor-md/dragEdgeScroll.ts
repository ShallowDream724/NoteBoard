/** Edge scrolling shared by editor drag gestures. Geometry and target lookup stay
 * with each gesture; this loop only moves the requested scroll containers. */
export interface DragScrollAxis {
  element: HTMLElement;
  direction: 'x' | 'y';
  /** The visible, clipped interval in client coordinates. */
  bounds: () => { start: number; end: number };
  edge: number;
  maxSpeed: number; // CSS pixels per second
  /** Restrict a movement to gesture content, such as the current table. */
  limitDelta?: (delta: number) => number;
}

export interface DragEdgeScroller {
  update(clientX: number, clientY: number): void;
  stop(): void;
}

function desiredSpeed(point: number, bounds: { start: number; end: number }, edge: number, maxSpeed: number): number {
  if (bounds.end <= bounds.start) return 0;
  const zone = Math.min(edge, (bounds.end - bounds.start) / 2);
  if (zone <= 0) return 0;
  const upper = Math.max(0, Math.min(1, (bounds.start + zone - point) / zone));
  const lower = Math.max(0, Math.min(1, (point - bounds.end + zone) / zone));
  const proximity = lower - upper;
  return Math.sign(proximity) * maxSpeed * (0.15 * Math.abs(proximity) + 0.85 * proximity * proximity);
}

export function createDragEdgeScroller(axes: DragScrollAxis[], onFrame: () => void): DragEdgeScroller {
  let frame = 0, lastTime = 0, x = 0, y = 0, generation = 0;
  const speeds = axes.map(() => 0);
  const tick = (time: number) => {
    frame = 0;
    const currentGeneration = generation;
    const elapsed = lastTime ? Math.max(1, Math.min(32, time - lastTime)) : 16;
    lastTime = time;
    let moved = false;
    for (let i = 0; i < axes.length; i++) {
      const axis = axes[i], point = axis.direction === 'x' ? x : y;
      const target = desiredSpeed(point, axis.bounds(), axis.edge, axis.maxSpeed);
      // Leaving the edge stops immediately. Entering it accelerates over several frames.
      if (!target || Math.sign(target) !== Math.sign(speeds[i])) speeds[i] = 0;
      if (!target) continue;
      speeds[i] += (target - speeds[i]) * (1 - Math.exp(-elapsed / 90));
      const property = axis.direction === 'x' ? 'scrollLeft' : 'scrollTop';
      const before = axis.element[property];
      const delta = axis.limitDelta?.(speeds[i] * elapsed / 1000) ?? speeds[i] * elapsed / 1000;
      axis.element[property] = before + delta;
      if (axis.element[property] !== before) moved = true;
    }
    // Also refresh on a pointer update that did not scroll. While scrolling,
    // the stationary pointer must keep resolving the target beneath it.
    onFrame();
    if (moved && currentGeneration === generation) {
      if (!frame) frame = requestAnimationFrame(tick);
    }
    else lastTime = 0;
  };
  return {
    update(clientX, clientY) {
      x = clientX; y = clientY;
      if (!frame) frame = requestAnimationFrame(tick);
    },
    stop() {
      generation++;
      if (frame) cancelAnimationFrame(frame);
      frame = 0; lastTime = 0;
      speeds.fill(0);
    },
  };
}
