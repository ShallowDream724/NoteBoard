import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent, RefObject } from 'react';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import { ChevronLeft, ChevronRight, Minus, Plus } from 'lucide-react';
import { openWithDefaultApp } from '../../core/ipc/commands';
import { registerEditorCapabilities } from '../../core/editor/editorRegistry';
import { TextLayer } from '../../core/pdf/pdfRuntime';
import { takeViewState } from '../session/editorSuspension';
import { useLocalPdf } from './useLocalPdf';
import './pdfViewer.css';

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 5;
const PAGE_MARGIN = 16;
const MAX_CANVAS_AREA = 8 * 1024 * 1024;
const MAX_CANVAS_SIDE = 8192;

type PageResult = { page: PDFPageProxy; width: number; height: number } | { error: string };
type ZoomAnchor = { x: number; y: number; horizontalFraction: number; verticalFraction: number };
type PdfViewState = { kind: 'pdf'; page: number; zoom: number; scrollLeft: number; scrollTop: number };

interface PdfViewerProps {
  filePath: string;
  fileName: string;
  active?: boolean;
  /** Only the host tab owns persistent editor view state; other reading panes stay independent. */
  docKey?: string;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function PDFPage({ pdf, pageNumber, zoom, availableWidth, sheet, restoreScroll }: {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  zoom: number;
  availableWidth: number;
  sheet: RefObject<HTMLDivElement | null>;
  restoreScroll: () => void;
}) {
  const [result, setResult] = useState<PageResult | null>(null);
  const [drawError, setDrawError] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const text = useRef<HTMLDivElement>(null);
  const page = result && 'page' in result ? result.page : null;
  const scale = result && 'page' in result ? Math.min(availableWidth / result.width, 32768 / result.height) * zoom : 0;

  useEffect(() => {
    let cancelled = false;
    void pdf.getPage(pageNumber).then(page => {
      if (cancelled) return;
      const { width, height } = page.getViewport({ scale: 1 });
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        throw new Error('页面尺寸无效。');
      }
      setResult({ page, width, height });
    }).catch(() => {
      if (!cancelled) setResult({ error: '无法读取此页面。' });
    });
    return () => { cancelled = true; };
  }, [pdf, pageNumber]);

  useLayoutEffect(() => {
    if (page) restoreScroll();
  }, [page, restoreScroll]);

  useEffect(() => {
    if (!page || !canvas.current || scale <= 0) return;
    const currentPage = page;
    const target = canvas.current;
    let task: RenderTask | undefined;
    let disposed = false;
    async function draw() {
      const view = currentPage.getViewport({ scale });
      if (!Number.isFinite(view.height) || view.height <= 0) throw new Error('页面尺寸无效。');
      const ratio = Math.min(window.devicePixelRatio || 1, 2,
        Math.sqrt(MAX_CANVAS_AREA / (view.width * view.height)),
        MAX_CANVAS_SIDE / Math.max(view.width, view.height));
      const viewport = currentPage.getViewport({ scale: scale * ratio });
      target.width = Math.max(1, Math.floor(viewport.width));
      target.height = Math.max(1, Math.floor(viewport.height));
      task = currentPage.render({ canvas: target, viewport });
      await task.promise;
      if (!disposed) setDrawError(false);
    }
    // CSS resizes the visible page immediately while consecutive zoom events settle.
    const timer = window.setTimeout(() => {
      void draw().catch(() => {
        if (!disposed) setDrawError(true);
      });
    }, 70);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      task?.cancel();
      currentPage.cleanup();
    };
  }, [page, scale]);

  useEffect(() => {
    if (!page || !text.current || scale <= 0) return;
    const host = text.current;
    const content = document.createElement('div');
    content.className = 'nb-pdf-text-layer';
    const currentPage = page;
    let layer: TextLayer | undefined;
    async function renderText() {
      const viewport = currentPage.getViewport({ scale });
      content.style.setProperty('--total-scale-factor', String(viewport.scale * viewport.userUnit));
      layer = new TextLayer({ textContentSource: currentPage.streamTextContent(), container: content, viewport });
      host.append(content);
      await layer.render();
    }
    const timer = window.setTimeout(() => {
      void renderText().catch(() => content.remove());
    }, 90);
    return () => {
      window.clearTimeout(timer);
      content.remove();
      layer?.cancel();
    };
  }, [page, scale]);

  return <>
    {!result && <div className="nb-pdf-status" role="status">正在加载页面…</div>}
    {result && 'error' in result && <div className="nb-pdf-status" role="alert">{result.error}</div>}
    {result && 'page' in result && <div ref={sheet} className="nb-pdf-sheet"
      style={{ width: result.width * scale, height: result.height * scale }}>
      <canvas ref={canvas} role="img" aria-label={'第 ' + pageNumber + ' 页'} />
      <div ref={text} />
      {drawError && <div className="nb-pdf-page-error" role="alert">无法显示此页面。</div>}
    </div>}
  </>;
}

function LocalPdfReader({ filePath, fileName, active = true, docKey }: PdfViewerProps) {
  const [attempt, setAttempt] = useState(0);
  const [requestedPage, setRequestedPage] = useState(1);
  const [pageInput, setPageInput] = useState<string | null>(null);
  const [width, setWidth] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [externalError, setExternalError] = useState('');
  const viewport = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const anchor = useRef<ZoomAnchor | null>(null);
  const viewPosition = useRef({ left: 0, top: 0 });
  const pageAndZoom = useRef({ page: 1, zoom: 1 });
  const instanceId = useId();
  const result = useLocalPdf(filePath, fileName, active, attempt);
  const totalPages = result?.pdf?.numPages ?? 0;
  const pageNumber = clamp(requestedPage, 1, totalPages || 1);

  useLayoutEffect(() => {
    pageAndZoom.current = { page: totalPages ? pageNumber : requestedPage, zoom };
  }, [pageNumber, requestedPage, totalPages, zoom]);

  useLayoutEffect(() => {
    if (!docKey) return;
    const restored = takeViewState(docKey) as PdfViewState | null;
    if (restored?.kind === 'pdf') {
      if (Number.isSafeInteger(restored.page) && restored.page > 0) setRequestedPage(restored.page);
      if (Number.isFinite(restored.zoom)) setZoom(clamp(restored.zoom, MIN_ZOOM, MAX_ZOOM));
      viewPosition.current = {
        left: Number.isFinite(restored.scrollLeft) ? Math.max(0, restored.scrollLeft) : 0,
        top: Number.isFinite(restored.scrollTop) ? Math.max(0, restored.scrollTop) : 0,
      };
    }
    return registerEditorCapabilities({
      docKey,
      instanceId,
      getRevision: () => 0,
      flush: async () => ({ docKey, instanceId, revision: 0, content: null, readonly: true }),
      focus: () => viewport.current?.focus(),
      getSelectedText: () => {
        const selection = window.getSelection();
        if (!selection || !sheet.current?.contains(selection.anchorNode) || !sheet.current.contains(selection.focusNode)) return '';
        return selection.toString();
      },
      canSuspend: () => true,
      captureViewState: (): PdfViewState => ({
        kind: 'pdf',
        ...pageAndZoom.current,
        scrollLeft: viewPosition.current.left,
        scrollTop: viewPosition.current.top,
      }),
    });
  }, [docKey, instanceId]);

  useLayoutEffect(() => {
    const element = viewport.current!;
    const measure = () => setWidth(Math.max(1, element.clientWidth - PAGE_MARGIN * 2));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = viewport.current!;
    function onWheel(event: WheelEvent) {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      event.stopPropagation();
      if (!sheet.current) return;
      const rect = sheet.current.getBoundingClientRect();
      const horizontalFraction = clamp((event.clientX - rect.left) / rect.width, 0, 1);
      const verticalFraction = clamp((event.clientY - rect.top) / rect.height, 0, 1);
      anchor.current = {
        x: rect.left + rect.width * horizontalFraction,
        y: rect.top + rect.height * verticalFraction,
        horizontalFraction,
        verticalFraction,
      };
      const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1);
      setZoom(current => clamp(current * Math.exp(-pixels * 0.008), MIN_ZOOM, MAX_ZOOM));
    }
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, []);

  useLayoutEffect(() => {
    const target = anchor.current;
    anchor.current = null;
    if (!target || !viewport.current || !sheet.current) return;
    const rect = sheet.current.getBoundingClientRect();
    viewport.current.scrollLeft += rect.left + rect.width * target.horizontalFraction - target.x;
    viewport.current.scrollTop += rect.top + rect.height * target.verticalFraction - target.y;
  }, [zoom]);

  const restoreScroll = useCallback(() => viewport.current?.scrollTo(viewPosition.current), []);
  function resetScroll() {
    viewPosition.current = { left: 0, top: 0 };
    restoreScroll();
  }
  function setPage(number: number) {
    setPageInput(null);
    if (!Number.isSafeInteger(number)) return;
    const next = clamp(number, 1, totalPages);
    if (next !== pageNumber) resetScroll();
    setRequestedPage(next);
  }

  function submitPage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(pageInput?.trim() ? Number(pageInput) : pageNumber);
  }

  function zoomBy(factor: number) {
    anchor.current = null;
    setZoom(current => clamp(current * factor, MIN_ZOOM, MAX_ZOOM));
  }

  return <section className="nb-pdf-reader" aria-label={'PDF 预览：' + fileName}>
    {totalPages > 0 && <div className="nb-pdf-toolbar" role="group" aria-label="页面导航与缩放">
      <button type="button" title="上一页" aria-label="上一页" disabled={pageNumber <= 1}
        onClick={() => setPage(pageNumber - 1)}><ChevronLeft size={16} /></button>
      <form onSubmit={submitPage}>
        <input aria-label="页码" inputMode="numeric" value={pageInput ?? pageNumber}
          onChange={event => setPageInput(event.target.value)} onBlur={() => setPageInput(null)} />
        <span aria-label={'共 ' + totalPages + ' 页'}>/ {totalPages}</span>
      </form>
      <button type="button" title="下一页" aria-label="下一页" disabled={pageNumber >= totalPages}
        onClick={() => setPage(pageNumber + 1)}><ChevronRight size={16} /></button>
      <div className="nb-pdf-zoom" role="group" aria-label="缩放">
        <button type="button" title="缩小" aria-label="缩小" disabled={zoom <= MIN_ZOOM}
          onClick={() => zoomBy(1 / 1.2)}><Minus size={16} /></button>
        <button type="button" title="适合宽度" aria-label="适合宽度" onClick={() => { anchor.current = null; setZoom(1); resetScroll(); }}>
          {Math.round(zoom * 100)}%
        </button>
        <button type="button" title="放大" aria-label="放大" disabled={zoom >= MAX_ZOOM}
          onClick={() => zoomBy(1.2)}><Plus size={16} /></button>
      </div>
    </div>}
    <div className="nb-pdf-viewport" ref={viewport} tabIndex={0} role="region" aria-label="PDF 页面"
      onScroll={event => {
        if (active && result?.pdf && sheet.current) {
          const { scrollLeft, scrollTop } = event.currentTarget;
          viewPosition.current = { left: scrollLeft, top: scrollTop };
        }
      }}>
      {active && !result && <div className="nb-pdf-status" role="status">正在打开 PDF…</div>}
      {result?.error && <div className="nb-pdf-status">
        <p role="alert">{result.error}</p>
        <div className="nb-pdf-status-actions">
          <button type="button" className="nb-btn-secondary" onClick={() => { setExternalError(''); setAttempt(value => value + 1); }}>重试</button>
          <button type="button" className="nb-btn-secondary" onClick={() => {
            setExternalError('');
            void openWithDefaultApp(filePath).catch(() => setExternalError('无法使用默认应用打开此 PDF。'));
          }}>使用默认应用打开</button>
        </div>
        {externalError && <p role="alert">{externalError}</p>}
      </div>}
      {result?.pdf && <div className="nb-pdf-stage">
        <PDFPage key={pageNumber} pdf={result.pdf} pageNumber={pageNumber} availableWidth={width} zoom={zoom}
          sheet={sheet} restoreScroll={restoreScroll} />
      </div>}
    </div>
  </section>;
}

export function PdfViewer(props: PdfViewerProps) {
  return <LocalPdfReader key={props.filePath} {...props} />;
}
