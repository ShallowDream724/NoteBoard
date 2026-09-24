import { useLayoutEffect, type RefObject } from 'react';
import { trailingTabEdge } from './tabEdge';

/** Geometry reads precede writes; visual trimming never changes the scroll viewport. */
export function useTabOverflow(viewportRef: RefObject<HTMLElement | null>, trackRef: RefObject<HTMLElement | null>,
  layoutVersion: unknown, dragging: boolean) {
  useLayoutEffect(() => {
    const viewport = viewportRef.current, track = trackRef.current;
    // The DOM ancestor is present before its React ref attaches in the parent layout phase.
    const layout = viewport?.closest<HTMLElement>('.titlebar-tab-group');
    if (!viewport || !track || !layout) return;
    const tabs = Array.from(track.querySelectorAll<HTMLElement>(':scope > .nb-tab'));
    let hidden: HTMLElement | undefined, last: HTMLElement | undefined;
    let previousTrim = -1;
    let frame = 0;
    const update = () => {
      frame = 0;
      const maxScroll = viewport.scrollWidth - viewport.clientWidth;
      const start = String(viewport.scrollLeft > 1);
      const end = String(maxScroll - viewport.scrollLeft > 1);
      const edge = dragging ? { hidden: -1, last: -1, trim: 0 } : trailingTabEdge(tabs.length,
        index => { const tab = tabs[index], start = tab.offsetLeft; return { start, end: start + tab.offsetWidth }; },
        viewport.scrollLeft, viewport.clientWidth);
      const nextHidden = tabs[edge.hidden], nextLast = tabs[edge.last];
      const trimmed = String(edge.hidden >= 0);
      if (viewport.dataset.trimmedEnd !== trimmed) viewport.dataset.trimmedEnd = trimmed;
      if (hidden !== nextHidden) {
        hidden?.removeAttribute('data-edge-hidden');
        nextHidden?.setAttribute('data-edge-hidden', 'true'); hidden = nextHidden;
      }
      if (last !== nextLast) {
        last?.removeAttribute('data-edge-last');
        nextLast?.setAttribute('data-edge-last', 'true'); last = nextLast;
      }
      if (edge.trim !== previousTrim) {
        layout.style.setProperty('--tab-trim-end', `${edge.trim}px`); previousTrim = edge.trim;
      }
      if (viewport.dataset.overflowStart !== start) viewport.dataset.overflowStart = start;
      if (viewport.dataset.overflowEnd !== end) viewport.dataset.overflowEnd = end;
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    const focus = (event: FocusEvent) => {
      const tab = event.target instanceof Element ? event.target.closest<HTMLElement>('.nb-tab') : null;
      if (tab && track.contains(tab)) {
        tab.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
        schedule();
      }
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(viewport); observer.observe(track);
    viewport.addEventListener('scroll', schedule, { passive: true });
    viewport.addEventListener('focusin', focus);
    update();
    return () => {
      observer.disconnect(); viewport.removeEventListener('scroll', schedule); viewport.removeEventListener('focusin', focus);
      cancelAnimationFrame(frame); hidden?.removeAttribute('data-edge-hidden'); last?.removeAttribute('data-edge-last');
      layout.style.removeProperty('--tab-trim-end');
    };
  }, [viewportRef, trackRef, layoutVersion, dragging]);
}
