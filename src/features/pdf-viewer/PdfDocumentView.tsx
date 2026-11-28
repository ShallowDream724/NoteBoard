import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, RefObject } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { Minus, Plus } from 'lucide-react';
import type { ReadingState } from '../../core/ipc/types';
import { PdfDrawQueue, PdfPage } from './PdfPage';
import { clamp, createPdfPageLayout, MAX_ZOOM, MIN_ZOOM, PAGE_MARGIN, validPageSize } from './pdfPageLayout';
import type { PdfPageSize } from './pdfPageLayout';

export type PdfReadingState = Extract<ReadingState, { kind: 'pdf' }>;

const MAX_OVERSCAN = 360;
const VIEWPORT_PIXEL_BUDGET = 12 * 1024 * 1024;
// Leave room below the browser's maximum scrollable element height.
const MAX_STAGE_HEIGHT = 24 * 1024 * 1024;

type ZoomAnchor = { page: number; fractionX: number; fractionY: number; x: number; y: number };
type VisibleRange = { first: number; last: number; current: number; offset: number };

export function PdfDocumentView({ pdf, viewport, position }: {
  pdf: PDFDocumentProxy;
  viewport: RefObject<HTMLDivElement | null>;
  position: RefObject<PdfReadingState>;
}) {
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [sizes, setSizes] = useState<ReadonlyMap<number, PdfPageSize>>(() => new Map());
  const [zoom, setZoom] = useState(position.current.zoom);
  const [input, setInput] = useState<string | null>(null);
  const [visible, setVisible] = useState<VisibleRange | null>(null);
  const current = useRef(position.current.page);
  const queue = useMemo(() => new PdfDrawQueue(() => current.current), []);
  const anchor = useRef<ZoomAnchor | null>(null);
  const requestedZoom = useRef(zoom);
  const layout = useMemo(() => createPdfPageLayout(pdf.numPages, sizes, box.width, zoom), [pdf, sizes, box.width, zoom]);
  const restoring = useRef<PdfReadingState | null>(position.current);
  const restoredOffset = useRef({ top: 0, left: 0 });
  const overscan = Math.min(MAX_OVERSCAN, box.height / 2);
  const stageHeight = Math.min(layout.height, MAX_STAGE_HEIGHT);
  // For exceptionally long PDFs, compress the scroll track, preserving full-size page geometry in the window.
  const scrollScale = layout.height > stageHeight ? (layout.height - box.height) / (stageHeight - box.height) : 1;

  const measured = useCallback((page: number, size: PdfPageSize) => {
    setSizes(previous => {
      const known = previous.get(page);
      if (known?.width === size.width && known.height === size.height) return previous;
      return new Map(previous).set(page, size);
    });
  }, []);

  useEffect(() => {
    let disposed = false;
    // Seed estimates with the first page even when resuming far into the document.
    void pdf.getPage(1).then(first => {
      if (disposed) return;
      const { width, height } = first.getViewport({ scale: 1 });
      if (validPageSize({ width, height })) measured(1, { width, height });
    }).catch(() => {});
    return () => { disposed = true; };
  }, [measured, pdf]);

  useLayoutEffect(() => {
    const element = viewport.current!;
    const measure = () => {
      const width = element.clientWidth;
      const height = element.clientHeight;
      if (width > 0 && height > 0) {
        setBox(previous => previous.width === width && previous.height === height ? previous : { width, height });
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [viewport]);

  const reportViewport = useCallback((element: HTMLDivElement, preservePosition = false) => {
    const { clientHeight, clientWidth, scrollHeight, scrollWidth, scrollLeft, scrollTop } = element;
    const logicalTop = scrollTop * scrollScale;
    const offset = scrollTop - logicalTop;
    const last = layout.pageAt(logicalTop + clientHeight + overscan);
    const first = layout.pageAt(logicalTop - overscan);
    const pageNumber = scrollTop <= 1 ? 1
      : scrollTop + clientHeight >= scrollHeight - 1 ? pdf.numPages
      : layout.pageAt(logicalTop + clientHeight / 2);
    current.current = pageNumber;
    setVisible(previous => previous?.first === first && previous.last === last
      && previous.current === pageNumber && previous.offset === offset ? previous : { first, last, current: pageNumber, offset });
    if (preservePosition) return;

    // Save the top reading point independently from the page counter at the viewport center.
    const page = layout.pageAt(logicalTop + PAGE_MARGIN);
    const rect = layout.pageRect(page);
    const localTop = Math.max(0, logicalTop + PAGE_MARGIN - rect.top);
    position.current = { kind: 'pdf', page, zoom, scrollLeft, scrollTop: localTop,
      verticalRatio: localTop / rect.height,
      horizontalRatio: scrollWidth > clientWidth ? scrollLeft / (scrollWidth - clientWidth) : 0 };
  }, [layout, overscan, pdf, position, scrollScale, zoom]);

  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element || !box.width) return;
    const pointer = anchor.current;
    anchor.current = null;
    const saved = restoring.current ?? position.current;
    const page = pointer?.page ?? clamp(saved.page, 1, pdf.numPages);
    const rect = layout.pageRect(page);
    const maxLeft = Math.max(0, element.scrollWidth - element.clientWidth);
    if (pointer) {
      element.scrollLeft = rect.left + rect.width * pointer.fractionX - pointer.x;
      element.scrollTop = (rect.top + rect.height * pointer.fractionY - pointer.y) / scrollScale;
    } else {
      element.scrollLeft = saved.horizontalRatio === undefined ? saved.scrollLeft : maxLeft * saved.horizontalRatio;
      const localTop = saved.verticalRatio === undefined ? saved.scrollTop : rect.height * saved.verticalRatio;
      element.scrollTop = (rect.top - PAGE_MARGIN + localTop) / scrollScale;
    }
    if (sizes.has(page)) restoring.current = null;
    restoredOffset.current = { top: element.scrollTop, left: element.scrollLeft };
    reportViewport(element, restoring.current !== null);
  }, [box.width, layout, pdf, position, reportViewport, scrollScale, sizes, viewport]);

  const scaleAt = useCallback((next: number, x: number, y: number) => {
    const element = viewport.current;
    const target = clamp(next, MIN_ZOOM, MAX_ZOOM);
    if (!element || !box.width || target === requestedZoom.current) return;
    if (target === zoom) {
      anchor.current = null;
    } else {
      const logicalTop = element.scrollTop * scrollScale;
      const page = layout.pageAt(logicalTop + y);
      const rect = layout.pageRect(page);
      const fractionX = clamp((element.scrollLeft + x - rect.left) / rect.width, 0, 1);
      const fractionY = clamp((logicalTop + y - rect.top) / rect.height, 0, 1);
      anchor.current = {
        page, fractionX, fractionY,
        x: rect.left + rect.width * fractionX - element.scrollLeft,
        y: rect.top + rect.height * fractionY - logicalTop,
      };
    }
    restoring.current = null;
    requestedZoom.current = target;
    setZoom(target);
  }, [box.width, layout, scrollScale, viewport, zoom]);

  useEffect(() => {
    const element = viewport.current!;
    function onWheel(event: WheelEvent) {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = element.getBoundingClientRect();
      const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1);
      scaleAt(requestedZoom.current * Math.exp(-pixels * 0.004), event.clientX - rect.left, event.clientY - rect.top);
    }
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [scaleAt, viewport]);

  function zoomTo(value: number) {
    const element = viewport.current;
    if (element) scaleAt(value, element.clientWidth / 2, element.clientHeight / 2);
  }

  function jump(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = viewport.current;
    const page = input?.trim() ? Number(input) : NaN;
    setInput(null);
    if (!element || !Number.isSafeInteger(page)) return;
    element.scrollTop = (layout.pageRect(clamp(page, 1, pdf.numPages)).top - PAGE_MARGIN) / scrollScale;
    restoring.current = null;
    reportViewport(element);
    element.focus({ preventScroll: true });
  }

  const pixelRatioLimit = Math.min(2, Math.sqrt(VIEWPORT_PIXEL_BUDGET / (layout.width * Math.max(1, box.height + overscan * 2))));
  const pageNumbers = [];
  if (visible) for (let number = visible.first; number <= visible.last; number++) pageNumbers.push(number);

  return <>
    <div className="nb-pdf-viewport" ref={viewport} tabIndex={0} role="region" aria-label="PDF 页面"
      onScroll={event => {
        const element = event.currentTarget;
        if (restoring.current && element.scrollTop === restoredOffset.current.top && element.scrollLeft === restoredOffset.current.left) return;
        restoring.current = null;
        reportViewport(element);
      }}>
      {box.width > 0 && <div className="nb-pdf-stage" style={{ width: layout.width, height: stageHeight }}>
        {pageNumbers.map(number => {
          const rect = layout.pageRect(number);
          rect.top += visible?.offset ?? 0;
          return <PdfPage key={number} pdf={pdf} number={number} rect={rect}
            pixelRatioLimit={pixelRatioLimit} queue={queue} measured={measured} />;
        })}
      </div>}
    </div>
    <div className="nb-pdf-toolbar" role="group" aria-label="页面导航与缩放">
      <form onSubmit={jump}>
        <input aria-label="页码" inputMode="numeric" value={input ?? (visible?.current ?? position.current.page)}
          onChange={event => setInput(event.target.value)} onBlur={() => setInput(null)} />
        <span aria-label={`共 ${pdf.numPages} 页`}>/ {pdf.numPages}</span>
      </form>
      <div className="nb-pdf-zoom" role="group" aria-label="缩放">
        <button type="button" title="缩小" aria-label="缩小" disabled={zoom <= MIN_ZOOM}
          onClick={() => zoomTo(zoom / 1.2)}><Minus size={16} /></button>
        <button type="button" title="适合宽度" aria-label="适合宽度" onClick={() => zoomTo(1)}>
          {Math.round(zoom * 100)}%
        </button>
        <button type="button" title="放大" aria-label="放大" disabled={zoom >= MAX_ZOOM}
          onClick={() => zoomTo(zoom * 1.2)}><Plus size={16} /></button>
      </div>
    </div>
  </>;
}
