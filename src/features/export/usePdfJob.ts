import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { exportFontCss } from './capture';
import type { ExportDocument, PdfOptions, PdfReceipt } from './model';

export function usePdfJob(document: ExportDocument | null, options: PdfOptions, enabled: boolean) {
  const [receipt, setReceipt] = useState<PdfReceipt | null>(null);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const retained = useRef<string | null>(null);
  const jobs = useRef(new Set<string>());
  const release = (id: string) => { jobs.current.delete(id); void invoke('release_pdf', { id }).catch(() => {}); };
  useEffect(() => () => { jobs.current.forEach(release); }, []);
  useEffect(() => {
    if (!document || !enabled) return;
    let disposed = false; let id: string | null = null;
    setBusy(true); setError('');
    const timer = setTimeout(async () => {
      id = crypto.randomUUID(); jobs.current.add(id);
      try {
        const result = await invoke<PdfReceipt>('create_pdf', { id, payload: {
          title: document.title, html: document.html, options, fontCss: exportFontCss(),
        } });
        if (disposed) { release(id); return; }
        const data = await invoke<ArrayBuffer>('read_pdf', { id });
        if (disposed) { release(id); return; }
        if (retained.current) release(retained.current);
        retained.current = id; setReceipt(result); setBytes(new Uint8Array(data)); setBusy(false);
      } catch (error) {
        if (id) release(id);
        if (!disposed) { setError(String(error)); setBusy(false); }
      }
    }, 500);
    return () => { disposed = true; clearTimeout(timer); if (id && id !== retained.current) release(id); };
  }, [document, options, enabled]);
  return { receipt, bytes, busy, error };
}
