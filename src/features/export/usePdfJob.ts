import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { exportFontCss } from './capture';
import type { ExportDocument, PdfOptions, PdfReceipt } from './model';

/** One native session per document. Serialize revisions and coalesce newer
 * settings while printing; never create overlapping full-document WebViews. */
export function usePdfJob(document: ExportDocument | null, options: PdfOptions, enabled: boolean) {
  const [receipt, setReceipt] = useState<PdfReceipt | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const latest = useRef(options); latest.current = options;
  const request = useRef<((options: PdfOptions) => void) | null>(null);
  const settle = useRef<((receipt: PdfReceipt, error?: string) => void) | null>(null);
  const previewSettled = useCallback((receipt: PdfReceipt, error?: string) => settle.current?.(receipt, error), []);
  useEffect(() => {
    if (!document || !enabled) return;
    let id = crypto.randomUUID();
    setReceipt(null); setError('');
    let alive = true, created = false, running = false;
    let pendingRevision: number | null = null;
    let displayedRevision: number | null = null;
    let queued: PdfOptions | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const drain = async () => {
      if (running || !alive || pendingRevision !== null) return;
      running = true;
      try {
        while (queued && alive && pendingRevision === null) {
          const current = queued; queued = null;
          const result = created
            ? await invoke<PdfReceipt>('update_pdf', { id, options: current, keepRevision: displayedRevision })
            : await invoke<PdfReceipt>('create_pdf', { id, payload: { title: document.title, html: document.html, options: current, fontCss: exportFontCss() } });
          created = true;
          // A receipt is not yet a reader handoff. The previous PDF can still
          // request native ranges until PDF.js has loaded and replaced it.
          if (alive && current === latest.current) { pendingRevision = result.revision; setReceipt(result); setError(''); }
        }
      } catch (error) {
        if (alive) {
          void invoke('release_pdf', { id }).catch(() => {});
          id = crypto.randomUUID(); created = false; displayedRevision = null;
          setReceipt(null); setError(String(error)); queued = null;
        }
      } finally { running = false; if (alive && !timer && !queued && pendingRevision === null) setBusy(false); }
    };
    settle.current = (result, error) => {
      if (!alive || result.id !== id || result.revision !== pendingRevision) return;
      pendingRevision = null;
      if (error) {
        void invoke('release_pdf', { id }).catch(() => {});
        id = crypto.randomUUID(); created = false; displayedRevision = null; queued = null;
        clearTimeout(timer); timer = undefined; setReceipt(null); setError(error); setBusy(false);
      } else {
        displayedRevision = result.revision;
        if (queued) void drain();
        else if (!timer) setBusy(false);
      }
    };
    const schedule = (options: PdfOptions) => {
      setBusy(true); setError(''); clearTimeout(timer);
      timer = setTimeout(() => { timer = undefined; queued = options; void drain(); }, created ? 250 : 0);
    };
    request.current = schedule; schedule(latest.current);
    return () => {
      alive = false; clearTimeout(timer); request.current = null; settle.current = null;
      void invoke('release_pdf', { id }).catch(() => {});
    };
  }, [document, enabled]);
  useEffect(() => { request.current?.(options); }, [options]);
  return { receipt, busy, error, previewSettled };
}
