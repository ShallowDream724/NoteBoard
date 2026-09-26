import { useCallback, useEffect, useRef } from 'react';
import type { PanelImperativeHandle, PanelSize } from 'react-resizable-panels';

/** The panel ref precedes the library's layout registration. Only onResize
 * establishes readiness; applying a preference never queries an unready panel. */
export function useRememberedPanelSize(width: number, enabled: boolean) {
  const desired = useRef({ width, enabled }); desired.current = { width, enabled };
  const panel = useRef<PanelImperativeHandle | null>(null);
  const measured = useRef<number | null>(null);
  const frame = useRef(0);
  const cancel = useCallback(() => { cancelAnimationFrame(frame.current); frame.current = 0; }, []);
  const sync = useCallback(() => {
    cancel();
    if (!panel.current || measured.current === null || !desired.current.enabled) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      if (panel.current && measured.current !== null && desired.current.enabled
        && Math.abs(measured.current - desired.current.width) >= 1) panel.current.resize(desired.current.width);
    });
  }, [cancel]);
  const panelRef = useCallback((value: PanelImperativeHandle | null) => {
    cancel(); panel.current = value; measured.current = null;
  }, [cancel]);
  const onResize = useCallback((size: PanelSize, _id: string | number | undefined, previous: PanelSize | undefined) => {
    if (!(size.inPixels > 0) || !(size.asPercentage > 0)) {
      measured.current = null; cancel(); return;
    }
    const firstMeasurement = measured.current === null;
    measured.current = size.inPixels;
    // A narrow window can constrain the preferred width. Reapply it when the
    // group changes size, while letting ordinary handle drags run unopposed.
    const groupWidth = size.inPixels * 100 / size.asPercentage;
    const previousGroupWidth = previous && previous.asPercentage > 0
      ? previous.inPixels * 100 / previous.asPercentage : groupWidth;
    // offsetWidth rounds each pane independently, so one pixel can be rounding.
    if (firstMeasurement || !previous || Math.abs(groupWidth - previousGroupWidth) >= 2) sync();
  }, [sync, cancel]);
  useEffect(() => { sync(); return cancel; }, [width, enabled, sync, cancel]);
  return { panelRef, onResize };
}
