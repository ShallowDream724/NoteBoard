import { useLayoutEffect, type RefObject } from 'react';

/** Constant-size measurements once per frame; edge changes do not rerender tabs. */
export function useTabOverflow(viewportRef: RefObject<HTMLElement | null>, trackRef: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const viewport = viewportRef.current, track = trackRef.current;
    if (!viewport || !track) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const maxScroll = viewport.scrollWidth - viewport.clientWidth;
      const start = String(viewport.scrollLeft > 1);
      const end = String(maxScroll - viewport.scrollLeft > 1);
      if (viewport.dataset.overflowStart !== start) viewport.dataset.overflowStart = start;
      if (viewport.dataset.overflowEnd !== end) viewport.dataset.overflowEnd = end;
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    const observer = new ResizeObserver(schedule);
    observer.observe(viewport); observer.observe(track);
    viewport.addEventListener('scroll', schedule, { passive: true });
    update();
    return () => { observer.disconnect(); viewport.removeEventListener('scroll', schedule); cancelAnimationFrame(frame); };
  }, [viewportRef, trackRef]);
}
