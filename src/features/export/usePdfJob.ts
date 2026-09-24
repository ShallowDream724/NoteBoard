import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { exportFontCss } from './capture';
import type { ExportDocument, PdfOptions, PdfReceipt } from './model';
import { advancePdfProgress, type PdfProgress, type PdfProgressEvent } from './progress';

/** One native session per document. Serialize revisions and coalesce newer
 * settings while printing; never create overlapping full-document WebViews. */
export function usePdfJob(document: ExportDocument | null, options: PdfOptions, enabled: boolean, initialStartedAt: number) {
  const [receipt, setReceipt] = useState<PdfReceipt | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<PdfProgress | null>(null);
  const latest = useRef(options); latest.current = options;
  const request = useRef<((options: PdfOptions) => void) | null>(null);
  const settle = useRef<((receipt: PdfReceipt, error?: string) => void) | null>(null);
  const previewSettled = useCallback((receipt: PdfReceipt, error?: string) => settle.current?.(receipt, error), []);
  useEffect(() => {
    if (!document || !enabled) { setReceipt(null); setBusy(false); setError(''); setProgress(null); return; }
    let id = crypto.randomUUID();
    setReceipt(null); setError(''); setProgress(null);
    let alive = true, created = false, running = false;
    let firstRun = true;
    let revision = -1;
    let pendingRevision: number | null = null;
    let displayedRevision: number | null = null;
    let queued: PdfOptions | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Subscribe before requesting work so even fast native phases are observed.
    const listening = listen<PdfProgressEvent>('pdf-progress', ({ payload }) => {
      if (alive) setProgress(current => advancePdfProgress(current, payload));
    }).catch(() => () => {}); // Progress delivery is not a prerequisite for PDF generation.
    const drain = async () => {
      if (running || !alive || pendingRevision !== null) return;
      running = true;
      try {
        await listening;
        while (queued && alive && pendingRevision === null) {
          const current = queued; queued = null;
          revision++;
          setProgress({ id, revision, phase: 'starting', startedAt: firstRun ? initialStartedAt : performance.now() });
          firstRun = false;
          const result = created
            ? await invoke<PdfReceipt>('update_pdf', { id, options: current, keepRevision: displayedRevision })
            : await invoke<PdfReceipt>('create_pdf', { id, payload: { title: document.title, html: document.html, options: current, fontCss: exportFontCss() } });
          created = true;
          // A receipt is not yet a reader handoff. The previous PDF can still
          // request native ranges until PDF.js has loaded and replaced it.
          if (alive && current === latest.current) {
            pendingRevision = result.revision; setReceipt(result); setError('');
            setProgress(value => value ? { ...value, phase: 'loading' } : value);
          }
        }
      } catch (error) {
        if (alive) {
          void invoke('release_pdf', { id }).catch(() => {});
          id = crypto.randomUUID(); created = false; displayedRevision = null; revision = -1;
          setProgress(null);
          setReceipt(null); setError(String(error)); queued = null;
        }
      } finally { running = false; if (alive && !timer && !queued && pendingRevision === null) { setBusy(false); setProgress(null); } }
    };
    settle.current = (result, error) => {
      if (!alive || result.id !== id || result.revision !== pendingRevision) return;
      pendingRevision = null;
      if (error) {
        void invoke('release_pdf', { id }).catch(() => {});
        id = crypto.randomUUID(); created = false; displayedRevision = null; queued = null; revision = -1;
        clearTimeout(timer); timer = undefined; setReceipt(null); setError(error); setBusy(false); setProgress(null);
      } else {
        displayedRevision = result.revision;
        if (queued) void drain();
        else if (!timer) { setBusy(false); setProgress(null); }
      }
    };
    const schedule = (options: PdfOptions) => {
      setBusy(true); setError(''); clearTimeout(timer);
      if (!running && pendingRevision === null) setProgress({ id, revision: revision + 1, phase: 'queued', startedAt: firstRun ? initialStartedAt : performance.now() });
      timer = setTimeout(() => { timer = undefined; queued = options; void drain(); }, created ? 250 : 0);
    };
    request.current = schedule; schedule(latest.current);
    return () => {
      alive = false; clearTimeout(timer); request.current = null; settle.current = null;
      void listening.then(unlisten => unlisten()).catch(() => {});
      void invoke('release_pdf', { id }).catch(() => {});
    };
  }, [document, enabled, initialStartedAt]);
  useEffect(() => { request.current?.(options); }, [options]);
  return { receipt, busy, error, progress, previewSettled };
}
