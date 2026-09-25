import { useEffect, useRef, useState, type RefObject } from 'react';
import './imageGestures.css';

export interface ImageTransform { scale: number; x: number; y: number }
export function zoomImageAt(current: ImageTransform, delta: number, point: { x: number; y: number }, min: number, max: number, sensitivity = .008): ImageTransform {
  const scale = Math.max(min, Math.min(max, current.scale * Math.exp(-delta * sensitivity)));
  const ratio = scale / current.scale;
  return { scale, x: point.x - (point.x - current.x) * ratio, y: point.y - (point.y - current.y) * ratio };
}

/** Chromium emits trackpad pinch as ctrl+wheel. A native non-passive listener
 * owns that gesture so it scales the image instead of the entire WebView. */
export function useImageWheelGesture(ref: RefObject<HTMLElement | null>, transform: ImageTransform, apply: (next: ImageTransform) => void,
  { min, max, normalWheel = 'zoom' }: { min: number; max: number; normalWheel?: 'zoom' | 'pan' | 'scroll' }) {
  const latest = useRef({ transform, apply, min, max, normalWheel });
  latest.current = { transform, apply, min, max, normalWheel };
  const [active, setActive] = useState(false);
  useEffect(() => {
    const element = ref.current; if (!element) return;
    let idle: ReturnType<typeof setTimeout> | undefined;
    const wheel = (event: WheelEvent) => {
      const state = latest.current, unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1;
      const modified = event.ctrlKey || event.metaKey;
      if (!modified && state.normalWheel === 'scroll') return;
      const zoom = modified || state.normalWheel === 'zoom';
      event.preventDefault(); event.stopPropagation();
      if (!zoom && state.transform.scale <= 1) return;
      const bounds = element.getBoundingClientRect();
      const next = zoom ? zoomImageAt(state.transform, event.deltaY * unit, {
        x: event.clientX - bounds.left - bounds.width / 2, y: event.clientY - bounds.top - bounds.height / 2,
      }, state.min, state.max, modified ? .008 : .0015)
        : { ...state.transform, x: state.transform.x - event.deltaX * unit, y: state.transform.y - event.deltaY * unit };
      state.transform = next; state.apply(next); setActive(true);
      clearTimeout(idle); idle = setTimeout(() => setActive(false), 120);
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => { clearTimeout(idle); element.removeEventListener('wheel', wheel); };
  }, [ref]);
  return active;
}
