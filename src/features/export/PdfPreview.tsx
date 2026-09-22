import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { invoke } from '@tauri-apps/api/core';
import { getDocument, GlobalWorkerOptions, PDFDataRangeTransport, type PDFDocumentProxy, type PDFDocumentLoadingTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { ItemLocation, PdfReceipt } from './model';
GlobalWorkerOptions.workerSrc = workerUrl;

class NativePdfRange extends PDFDataRangeTransport {
  private stopped = false;
  constructor(private receipt: PdfReceipt, private fail: (error: unknown) => void) { super(receipt.size, null, true); }
  requestDataRange(begin: number, end: number) {
    // PDF.js may request adjacent chunks together. Keep every IPC transfer bounded.
    void (async () => {
      for (let from = begin; from < end && !this.stopped; from += 1024 * 1024) {
        const data = await invoke<ArrayBuffer>('read_pdf', { id: this.receipt.id, revision: this.receipt.revision, offset: from, length: Math.min(1024 * 1024, end - from) });
        if (!this.stopped) this.onDataRange(from, new Uint8Array(data));
      }
    })().catch(error => { if (!this.stopped) this.fail(error); });
  }
  abort() { this.stopped = true; }
}

function Page({ pdf, index, width, locations, selected, onSelect, issues }: {
  pdf: PDFDocumentProxy; index: number; width: number; locations: ItemLocation[]; selected?: string; onSelect?: (id: string) => void; issues?: ReadonlySet<string>;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [regions, setRegions] = useState<Array<{ id: string; left: number; top: number; width: number; height: number }>>([]);
  useEffect(() => {
    let disposed = false; let cancel: (() => void) | undefined;
    void pdf.getPage(index + 1).then(page => {
      if (disposed || !canvas.current) return;
      const target = canvas.current, original = page.getViewport({ scale: 1 });
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      const view = page.getViewport({ scale: width / original.width });
      const viewport = page.getViewport({ scale: width / original.width * ratio });
      target.width = Math.ceil(viewport.width); target.height = Math.ceil(viewport.height);
      target.style.width = `${width}px`; target.style.height = `${view.height}px`;
      setRegions(locations.map(location => {
        const [x1, y1] = view.convertToViewportPoint(location.rect[0], location.rect[1]);
        const [x2, y2] = view.convertToViewportPoint(location.rect[2], location.rect[3]);
        return { id: location.id, left: Math.min(x1, x2), top: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
      }).sort((a, b) => b.width * b.height - a.width * a.height));
      const task = page.render({ canvas: target, viewport });
      cancel = () => { task.cancel(); void task.promise.catch(() => {}).then(() => page.cleanup()); };
      void task.promise.catch(() => {}).finally(() => { if (disposed) page.cleanup(); });
    }).catch(() => {});
    return () => { disposed = true; cancel?.(); };
  }, [pdf, index, width, locations]);
  return <div style={{ position: 'relative' }}>
    <canvas ref={canvas} aria-label={`第 ${index + 1} 页`} style={{ display: 'block', background: 'white', boxShadow: '0 2px 12px #0002' }}/>
    {regions.map((region, index) => <button key={`${region.id}:${index}`} className={'export-item-region' + (selected === region.id ? ' selected' : '') + (issues?.has(region.id) ? ' has-error' : '')}
      aria-label={region.id.startsWith('table') ? '调整此表格' : '调整此公式'} title="点击调整" onClick={() => onSelect?.(region.id)}
      style={{ position: 'absolute', left: region.left, top: region.top, width: region.width, height: Math.max(18, region.height) }}/>) }
  </div>;
}
const EMPTY_LOCATIONS: ItemLocation[] = [];

export function PdfPreview({ bytes, receipt, onPages, selected, navigation, onSelect, issues }: {
  bytes?: Uint8Array; receipt?: PdfReceipt; onPages: (pages: number) => void; selected?: string; navigation?: { id: string; serial: number }; onSelect?: (id: string) => void; issues?: ReadonlySet<string>;
}) {
  const [loaded, setLoaded] = useState<{ pdf: PDFDocumentProxy; width: number; height: number; key: string; receipt?: PdfReceipt; task: PDFDocumentLoadingTask } | null>(null);
  const tasks = useRef(new Set<PDFDocumentLoadingTask>());
  const [width, setWidth] = useState(600), [error, setError] = useState('');
  const scroll = useRef<HTMLDivElement>(null);
  const documentKey = receipt ? `${receipt.id}:${receipt.revision}` : 'bytes';
  useEffect(() => {
    const range = receipt ? new NativePdfRange(receipt, error => { setError(String(error)); void task.destroy(); }) : undefined;
    const task = getDocument(range ? { range, rangeChunkSize: 65536, disableAutoFetch: true, disableStream: true, useSystemFonts: true } : { data: bytes!.slice(), useSystemFonts: true });
    tasks.current.add(task);
    let disposed = false, published = false;
    void task.promise.then(async pdf => {
      const first = await pdf.getPage(1), viewport = first.getViewport({ scale: 1 });
      if (!disposed) { published = true; setLoaded({ pdf, width: viewport.width, height: viewport.height, key: documentKey, receipt, task }); onPages(pdf.numPages); setError(''); }
    }).catch(error => { if (!disposed) setError(String(error)); });
    // Keep the previous page geometry and canvas until the new PDF is ready.
    return () => { disposed = true; if (!published && tasks.current.delete(task)) { range?.abort(); void task.destroy(); } };
  }, [bytes, receipt, documentKey, onPages]);
  useEffect(() => () => { if (loaded && tasks.current.delete(loaded.task)) void loaded.task.destroy(); }, [loaded]);
  useEffect(() => { const live = tasks.current; return () => { live.forEach(task => { void task.destroy(); }); live.clear(); }; }, []);
  useEffect(() => {
    const root = scroll.current!;
    const update = () => setWidth(Math.max(180, Math.min(1000, root.clientWidth - 48)));
    update(); const observer = new ResizeObserver(update); observer.observe(root); return () => observer.disconnect();
  }, []);
  const locations = useMemo(() => {
    const pages = new Map<number, ItemLocation[]>();
    for (const location of loaded?.receipt?.locations ?? []) { const page = pages.get(location.page) ?? []; page.push(location); pages.set(location.page, page); }
    return pages;
  }, [loaded]);
  const pageHeight = width * (loaded ? loaded.height / loaded.width : 297 / 210);
  const virtual = useVirtualizer({ count: loaded?.pdf.numPages ?? 0, getScrollElement: () => scroll.current, estimateSize: () => pageHeight + 36, overscan: 1 });
  useEffect(() => { virtual.measure(); }, [pageHeight, virtual]);
  useEffect(() => {
    if (!navigation?.id || !loaded || loaded.key !== documentKey) return;
    const location = receipt?.locations.find(location => location.id === navigation.id);
    if (location) virtual.scrollToOffset(Math.max(0, (location.page - 1) * (pageHeight + 36) + (loaded.height - location.rect[3]) * width / loaded.width - 50));
  }, [navigation, receipt, loaded, documentKey, virtual, pageHeight, width]);
  return <div ref={scroll} className="export-preview" aria-label="PDF 预览">
    {error && <p role="alert">{error}</p>}
    <div style={{ height: virtual.getTotalSize(), position: 'relative', width, margin: '20px auto' }}>
      {loaded && virtual.getVirtualItems().map(item => <div key={item.key} style={{ position: 'absolute', top: item.start, left: 0 }}>
        <Page pdf={loaded.pdf} index={item.index} width={width} locations={locations.get(item.index + 1) ?? EMPTY_LOCATIONS} selected={selected} onSelect={onSelect} issues={loaded.key === documentKey ? issues : undefined}/>
        <div className="export-page-number">{item.index + 1}</div>
      </div>)}
    </div>
  </div>;
}
