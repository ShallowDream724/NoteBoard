import { Minus, PanelRight, Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { MAX_ZOOM, MIN_ZOOM } from './pdfPageLayout';
import { usePdfStatusTarget, type PdfPane } from './PdfStatusSlot';

export function PdfDocumentControls({ pane, documentKey, fileName, page, pageCount, zoom, onJump, onZoom }: {
  pane: PdfPane;
  documentKey?: string;
  fileName?: string;
  page: number;
  pageCount: number;
  zoom: number;
  onJump: (page: number) => void;
  onZoom: (zoom: number) => void;
}) {
  const target = usePdfStatusTarget(pane, documentKey);
  const [input, setInput] = useState<string | null>(null);
  const readerLabel = pane === 'reference' ? '右侧 PDF' : '主文档 PDF';
  const label = fileName ? `${readerLabel} · ${fileName}` : readerLabel;

  function jump(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextPage = input?.trim() ? Number(input) : NaN;
    setInput(null);
    if (Number.isSafeInteger(nextPage)) onJump(nextPage);
  }

  const controls = <div className={`nb-pdf-controls${target ? '' : ' nb-pdf-controls-floating'}`}
    role="group" aria-label={`${label} · 页面导航与缩放`}>
    {target && pane === 'reference' && <span className="nb-pdf-reference-icon" title={label} aria-hidden="true">
      <PanelRight size={13} />
    </span>}
    <form onSubmit={jump}>
      <input aria-label="页码" aria-description={`共 ${pageCount} 页，输入页码后按 Enter 跳转`} inputMode="numeric"
        title="输入页码后按 Enter 跳转" value={input ?? page}
        style={{ width: `${Math.max(2, String(pageCount).length) + 2}ch` }}
        onChange={event => setInput(event.target.value)} onBlur={() => setInput(null)} />
      <span aria-hidden="true">/ {pageCount}</span>
    </form>
    <div className="nb-pdf-zoom" role="group" aria-label="缩放">
      <button type="button" title="缩小" aria-label="缩小" disabled={zoom <= MIN_ZOOM}
        onClick={() => onZoom(zoom / 1.2)}><Minus size={13} aria-hidden="true" /></button>
      <button type="button" title="适合宽度" aria-label={`缩放 ${Math.round(zoom * 100)}%，适合宽度`} onClick={() => onZoom(1)}>
        {Math.round(zoom * 100)}%
      </button>
      <button type="button" title="放大" aria-label="放大" disabled={zoom >= MAX_ZOOM}
        onClick={() => onZoom(zoom * 1.2)}><Plus size={13} aria-hidden="true" /></button>
    </div>
  </div>;

  return target ? createPortal(controls, target) : controls;
}
