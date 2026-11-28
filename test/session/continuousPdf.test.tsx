import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { expect, it, vi } from 'vitest';
import { PdfDocumentControls } from '../../src/features/pdf-viewer/PdfDocumentControls';
import { PdfDocumentView } from '../../src/features/pdf-viewer/PdfDocumentView';
import type { PdfReadingState } from '../../src/features/pdf-viewer/PdfDocumentView';
import { createPdfPageLayout } from '../../src/features/pdf-viewer/pdfPageLayout';
import { PdfStatusSlot } from '../../src/features/pdf-viewer/PdfStatusSlot';
import { readingState } from '../../src/features/session/readingState';

vi.mock('../../src/core/pdf/pdfRuntime', () => ({
  TextLayer: class {
    constructor(private readonly options: { container: HTMLElement }) {}
    async render() { this.options.container.textContent = 'PDF text'; }
    cancel() {}
  },
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it('preserves mixed page geometry and estimates the distance to unmeasured pages', () => {
  const layout = createPdfPageLayout(100_000, new Map([
    [1, { width: 600, height: 800 }],
    [2, { width: 800, height: 500 }],
    [3, { width: 400, height: 500 }],
  ]), 832, 1);
  expect(layout.pageRect(1)).toEqual({ left: 116, top: 16, width: 600, height: 800, scale: 1 });
  expect(layout.pageRect(2)).toEqual({ left: 16, top: 832, width: 800, height: 500, scale: 1 });
  expect(layout.pageRect(3)).toEqual({ left: 216, top: 1348, width: 400, height: 500, scale: 1 });
  expect(layout.pageAt(layout.pageRect(83_001).top + 60)).toBe(83_001);
  expect(layout.pageAt(layout.height)).toBe(100_000);
});

it('uses the saved page-local offset and replaces a scaled canvas only after the latest draw succeeds', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const pending: { cancel: ReturnType<typeof vi.fn>; resolve: () => void }[] = [];
  const pageProxy = {
    getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
    userUnit: 1,
    streamTextContent: vi.fn(),
    cleanup: vi.fn(),
    render: vi.fn(() => {
      const cancel = vi.fn();
      const promise = new Promise<void>(resolve => pending.push({ cancel, resolve }));
      return { promise, cancel };
    }),
  };
  const pdf = { numPages: 500, getPage: vi.fn(async () => pageProxy) } as unknown as PDFDocumentProxy;
  const position = { current: readingState({
    kind: 'pdf', page: 121, zoom: 1, scrollTop: 200, scrollLeft: 0,
  }) as PdfReadingState };
  const viewport = { current: null as HTMLDivElement | null };
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });
  const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(632);
  const height = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(500);
  const scrollHeight = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(500 * 816);
  try {
    await act(async () => root.render(<>
      <PdfDocumentView pdf={pdf} viewport={viewport} position={position} pane="primary" documentKey="book.pdf" />
      <footer><PdfStatusSlot pane="primary" documentKey="book.pdf" /></footer>
    </>));
    expect(viewport.current?.scrollTop).toBe(120 * 816 + 200);
    expect(pdf.getPage).toHaveBeenCalledWith(121);
    expect(pdf.getPage).not.toHaveBeenCalledWith(100);
    expect(host.querySelectorAll('.nb-pdf-sheet').length).toBeLessThan(5);
    await act(async () => pending.forEach(draw => draw.resolve()));

    const sheet = () => host.querySelector<HTMLDivElement>('[data-page-number="121"]')!;
    const layer = sheet().querySelector('.nb-pdf-text-layer');
    const original = sheet().querySelector('canvas');
    expect(original?.width).toBeGreaterThan(0);
    expect(layer?.textContent).toBe('PDF text');

    const plus = host.querySelector<HTMLButtonElement>('footer [aria-label="放大"]')!;
    const center = () => (viewport.current!.scrollTop + 250 - parseFloat(sheet().style.top)) / parseFloat(sheet().style.height);
    const originalCenter = center();
    await act(async () => plus.click());
    expect(sheet().querySelector('canvas')).toBe(original);
    expect(sheet().querySelector('.nb-pdf-text-layer')).toBe(layer);
    expect(center()).toBeCloseTo(originalCenter, 3);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    const firstZoom = pending.slice(2);
    expect(firstZoom.length).toBeGreaterThan(0);
    await act(async () => plus.click());
    expect(firstZoom.some(draw => draw.cancel.mock.calls.length > 0)).toBe(true);
    expect(sheet().querySelector('canvas')).toBe(original);
    await act(async () => firstZoom.forEach(draw => draw.resolve()));
    expect(sheet().querySelector('canvas')).toBe(original);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    await act(async () => pending.forEach(draw => draw.resolve()));
    expect(sheet().querySelector('canvas')).not.toBe(original);
    expect(original?.width).toBe(0);
    expect(sheet().querySelector('.nb-pdf-text-layer')).toBe(layer);
    expect(position.current.verticalRatio).toBeGreaterThan(0);
    expect(position.current.zoom).toBeCloseTo(1.44);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    width.mockRestore();
    height.mockRestore();
    scrollHeight.mockRestore();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
});

it('keeps the two readers independent when they show the same file and moves the controls when the status bar is hidden', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const primaryJump = vi.fn();
  const referenceJump = vi.fn();
  const zoom = vi.fn();
  function render(statusVisible: boolean, primaryKey: string) {
    return act(() => root.render(<>
      <main>
        {primaryKey === 'book.pdf' && <PdfDocumentControls pane="primary" documentKey="book.pdf" page={1} pageCount={120}
          zoom={1} onJump={primaryJump} onZoom={zoom} />}
        <PdfDocumentControls pane="reference" documentKey="book.pdf" page={42} pageCount={120}
          zoom={1.2} onJump={referenceJump} onZoom={zoom} />
      </main>
      {statusVisible && <footer>
        <PdfStatusSlot pane="primary" documentKey={primaryKey} className="primary" />
        <PdfStatusSlot pane="reference" documentKey="book.pdf" className="reference" />
      </footer>}
    </>));
  }

  try {
    await render(true, 'book.pdf');
    expect(host.querySelector('main .nb-pdf-controls')).toBeNull();
    expect(host.querySelector<HTMLInputElement>('.primary input')?.value).toBe('1');
    const input = host.querySelector<HTMLInputElement>('.reference input')!;
    expect(input.value).toBe('42');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '100');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => input.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(referenceJump).toHaveBeenCalledWith(100);
    expect(primaryJump).not.toHaveBeenCalled();

    await render(true, 'other.pdf');
    expect(host.querySelector('.primary .nb-pdf-controls')).toBeNull();
    expect(host.querySelector<HTMLInputElement>('.reference input')?.value).toBe('42');
    await render(false, 'other.pdf');
    expect(host.querySelectorAll('main .nb-pdf-controls-floating')).toHaveLength(1);
    expect(host.querySelector<HTMLInputElement>('main input')?.value).toBe('42');
    await render(true, 'book.pdf');
    expect(host.querySelector('main .nb-pdf-controls')).toBeNull();
    expect(host.querySelectorAll('footer .nb-pdf-controls')).toHaveLength(2);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
