import { useEffect, useState } from 'react';
import { PDF_PHASES, type PdfProgress } from './progress';

/** The clock updates only this small component, never the PDF canvas or modal.
 * Rotation stays in CSS; time is elapsed wall time, not a simulated percentage. */
export function ExportProgress({ progress, compact = false }: { progress: PdfProgress; compact?: boolean }) {
  const [clock, setClock] = useState(() => performance.now());
  useEffect(() => {
    const timer = window.setInterval(() => setClock(performance.now()), 1000);
    return () => window.clearInterval(timer);
  }, [progress.startedAt]);
  const seconds = Math.max(0, Math.floor((clock - progress.startedAt) / 1000));
  const label = PDF_PHASES[progress.phase];
  return <div className={compact ? 'export-progress export-progress-compact' : 'export-progress'}>
    <div className="export-progress-ring">
      <svg viewBox="0 0 100 100" aria-hidden="true" className="export-progress-track"><circle cx="50" cy="50" r="46"/></svg>
      <svg viewBox="0 0 100 100" aria-hidden="true" className="export-progress-spin"><circle cx="50" cy="50" r="46"/></svg>
      {!compact && <span className="export-progress-label" role="status" aria-live="polite" aria-atomic="true">{label}</span>}
    </div>
    {compact && <span role="status" aria-live="polite" aria-atomic="true">{label}</span>}
    <span className="export-progress-time" aria-live="off">已用 {seconds} 秒</span>
  </div>;
}
