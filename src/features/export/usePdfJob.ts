import { useEffect, useRef, useState } from 'react';
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
  useEffect(() => {
    if (!document || !enabled) return;
    let id = crypto.randomUUID();
    setReceipt(null); setError('');
    let alive = true, created = false, running = false;
    let displayedRevision: number | null = null;
    let queued: PdfOptions | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const drain = async () => {
      if (running || !alive) return;
      running = true;
      try {
        while (queued && alive) {
          const current = queued; queued = null;
          const result = created
            ? await invoke<PdfReceipt>('update_pdf', { id, options: current, keepRevision: displayedRevision })
            : await invoke<PdfReceipt>('create_pdf', { id, payload: { title: document.title, html: document.html, options: current, fontCss: exportFontCss() } });
          created = true;
          if (alive && current === latest.current) { displayedRevision = result.revision; setReceipt(result); setError(''); }
        }
      } catch (error) {
        if (alive) {
          void invoke('release_pdf', { id }).catch(() => {});
          id = crypto.randomUUID(); created = false; displayedRevision = null;
          setReceipt(null); setError(String(error)); queued = null;
        }
      } finally { running = false; if (alive && !timer && !queued) setBusy(false); }
    };
    const schedule = (options: PdfOptions) => {
      setBusy(true); setError(''); clearTimeout(timer);
      timer = setTimeout(() => { timer = undefined; queued = options; void drain(); }, created ? 250 : 0);
    };
    request.current = schedule; schedule(latest.current);
    return () => {
      alive = false; clearTimeout(timer); request.current = null;
      void invoke('release_pdf', { id }).catch(() => {});
    };
  }, [document, enabled]);
  useEffect(() => { request.current?.(options); }, [options]);
  return { receipt, busy, error };
}
