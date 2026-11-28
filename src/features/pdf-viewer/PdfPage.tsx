import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import { TextLayer } from '../../core/pdf/pdfRuntime';
import { validPageSize, type PdfPageLayout, type PdfPageSize } from './pdfPageLayout';

const MAX_CANVAS_AREA = 6 * 1024 * 1024;
const MAX_CANVAS_SIDE = 8192;
const MAX_PARALLEL_DRAWS = 2;
const RERENDER_DELAY = 90;

type Draw = { page: number; run: () => Promise<void> };
type PageRect = ReturnType<PdfPageLayout['pageRect']>;

export class PdfDrawQueue {
  private pending = new Set<Draw>();
  private running = 0;
  private scheduled = false;

  constructor(private readonly currentPage: () => number) {}

  enqueue(page: number, run: Draw['run']) {
    const draw = { page, run };
    this.pending.add(draw);
    this.schedule();
    return () => { this.pending.delete(draw); };
  }

  private schedule() {
    if (this.scheduled || this.running >= MAX_PARALLEL_DRAWS || !this.pending.size) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      const currentPage = this.currentPage();
      while (this.running < MAX_PARALLEL_DRAWS && this.pending.size) {
        let next: Draw | undefined;
        for (const draw of this.pending) {
          if (!next || Math.abs(draw.page - currentPage) < Math.abs(next.page - currentPage)) next = draw;
        }
        this.pending.delete(next!);
        this.running += 1;
        const settled = () => { this.running -= 1; this.schedule(); };
        void next!.run().then(settled, settled);
      }
    });
  }
}

function releaseCanvas(canvas: HTMLCanvasElement) {
  canvas.remove();
  canvas.width = canvas.height = 0;
}

function PageSurface({ page, number, scale, pixelRatioLimit, queue }: {
  page: PDFPageProxy;
  number: number;
  scale: number;
  pixelRatioLimit: number;
  queue: PdfDrawQueue;
}) {
  const pixels = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLDivElement>(null);
  const shown = useRef<HTMLCanvasElement | null>(null);
  const [drawError, setDrawError] = useState(false);

  useEffect(() => {
    // The text layer uses percentage positions and inherits the current PDF scale.
    // Its DOM survives zoom, including native selections.
    const host = text.current!;
    let layer: TextLayer | undefined;
    try {
      layer = new TextLayer({ textContentSource: page.streamTextContent(), container: host, viewport: page.getViewport({ scale: 1 }) });
      void layer.render().catch(() => {});
    } catch { /* The rendered page is still readable. */ }
    return () => { layer?.cancel(); host.replaceChildren(); };
  }, [page]);

  useEffect(() => () => {
    if (shown.current) releaseCanvas(shown.current);
    shown.current = null;
  }, []);

  useEffect(() => {
    const host = pixels.current!;
    let disposed = false;
    let task: RenderTask | undefined;
    let dequeue: (() => void) | undefined;

    async function render() {
      const target = document.createElement('canvas');
      target.setAttribute('role', 'img');
      target.setAttribute('aria-label', `第 ${number} 页`);
      try {
        const { width, height } = page.getViewport({ scale });
        const ratio = Math.min(window.devicePixelRatio || 1, pixelRatioLimit,
          Math.sqrt(MAX_CANVAS_AREA / (width * height)), MAX_CANVAS_SIDE / Math.max(width, height));
        const viewport = page.getViewport({ scale: scale * ratio });
        const rasterWidth = Math.max(1, Math.floor(viewport.width));
        const rasterHeight = Math.max(1, Math.floor(viewport.height));
        if (shown.current?.width === rasterWidth && shown.current.height === rasterHeight) return;
        target.width = rasterWidth;
        target.height = rasterHeight;
        task = page.render({ canvas: target, viewport });
        await task.promise;
        if (disposed) return;
        const previous = shown.current;
        host.replaceChildren(target);
        shown.current = target;
        if (previous) releaseCanvas(previous);
        setDrawError(false);
      } catch {
        if (!disposed && !shown.current) setDrawError(true);
      } finally {
        if (target !== shown.current) releaseCanvas(target);
      }
    }

    const request = () => { dequeue = queue.enqueue(number, render); };
    // Keep the existing surface visible at its CSS size until the next raster completes.
    const timer = shown.current ? window.setTimeout(request, RERENDER_DELAY) : undefined;
    if (timer === undefined) request();
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      dequeue?.();
      task?.cancel();
    };
  }, [number, page, pixelRatioLimit, queue, scale]);

  return <>
    <div ref={pixels} />
    <div className="nb-pdf-text-layer" ref={text} />
    {drawError && <div className="nb-pdf-page-error" role="alert">无法显示此页面。</div>}
  </>;
}

export function PdfPage({ pdf, number, rect, pixelRatioLimit, queue, measured }: {
  pdf: PDFDocumentProxy;
  number: number;
  rect: PageRect;
  pixelRatioLimit: number;
  queue: PdfDrawQueue;
  measured: (page: number, size: PdfPageSize) => void;
}) {
  const [page, setPage] = useState<PDFPageProxy | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let disposed = false;
    let current: PDFPageProxy | undefined;
    void pdf.getPage(number).then(result => {
      if (disposed) return;
      current = result;
      const { width, height } = result.getViewport({ scale: 1 });
      if (!validPageSize({ width, height })) throw new Error('页面尺寸无效。');
      measured(number, { width, height });
      setPage(result);
    }).catch(() => { if (!disposed) setFailed(true); });
    return () => {
      disposed = true;
      current?.cleanup();
    };
  }, [measured, number, pdf]);

  const style = { left: rect.left, top: rect.top, width: rect.width, height: rect.height,
    '--total-scale-factor': rect.scale * (page?.userUnit ?? 1) } as CSSProperties;

  return <div className="nb-pdf-sheet" style={style} data-page-number={number}>
    {page && <PageSurface page={page} number={number} scale={rect.scale} pixelRatioLimit={pixelRatioLimit} queue={queue} />}
    {failed && <div className="nb-pdf-page-error" role="alert">无法读取此页面。</div>}
  </div>;
}
