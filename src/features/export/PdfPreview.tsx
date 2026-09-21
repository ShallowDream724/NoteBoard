import { useEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
GlobalWorkerOptions.workerSrc = workerUrl;

function Page({ pdf, index, width }: { pdf: PDFDocumentProxy; index: number; width: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let disposed = false; let cancel: (() => void) | undefined;
    void pdf.getPage(index + 1).then(page => {
      if (disposed || !canvas.current) return;
      const target = canvas.current;
      const original = page.getViewport({ scale: 1 });
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      const viewport = page.getViewport({ scale: width / original.width * ratio });
      target.width = Math.ceil(viewport.width); target.height = Math.ceil(viewport.height);
      target.style.width = `${width}px`; target.style.height = `${viewport.height / ratio}px`;
      const task = page.render({ canvas: target, viewport });
      cancel = () => { task.cancel(); void task.promise.catch(() => {}).then(() => page.cleanup()); };
      void task.promise.catch(() => {}).finally(() => { if (disposed) page.cleanup(); });
    }).catch(() => {});
    return () => { disposed = true; cancel?.(); };
  }, [pdf, index, width]);
  return <canvas ref={canvas} aria-label={`第 ${index + 1} 页`} style={{ display: 'block', background: 'white', boxShadow: '0 2px 12px #0002' }}/>;
}

export function PdfPreview({ bytes, onPages }: { bytes: Uint8Array; onPages: (pages: number) => void }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [ratio, setRatio] = useState(297 / 210);
  const [width, setWidth] = useState(600);
  const [error, setError] = useState('');
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const task = getDocument({ data: bytes.slice(), useSystemFonts: true });
    let disposed = false;
    void task.promise.then(async pdf => {
      const first = await pdf.getPage(1); const viewport = first.getViewport({ scale: 1 });
      if (!disposed) { setPdf(pdf); setRatio(viewport.height / viewport.width); onPages(pdf.numPages); setError(''); }
    }).catch(error => { if (!disposed) setError(String(error)); });
    return () => { disposed = true; setPdf(null); void task.destroy(); };
  }, [bytes, onPages]);
  useEffect(() => {
    const root = scroll.current!;
    const update = () => setWidth(Math.max(180, Math.min(1000, root.clientWidth - 48)));
    update(); const observer = new ResizeObserver(update); observer.observe(root); return () => observer.disconnect();
  }, []);
  const virtual = useVirtualizer({ count: pdf?.numPages ?? 0, getScrollElement: () => scroll.current, estimateSize: () => width * ratio + 36, overscan: 1 });
  useEffect(() => { virtual.measure(); }, [width, ratio, virtual]);
  return <div ref={scroll} className="export-preview" aria-label="PDF 预览">
    {error && <p role="alert">{error}</p>}
    <div style={{ height: virtual.getTotalSize(), position: 'relative', width, margin: '20px auto' }}>
      {pdf && virtual.getVirtualItems().map(item => <div key={item.key} style={{ position: 'absolute', top: item.start, left: 0 }}>
        <Page pdf={pdf} index={item.index} width={width}/><div className="export-page-number">{item.index + 1}</div>
      </div>)}
    </div>
  </div>;
}
