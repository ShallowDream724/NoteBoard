import { useEffect, useId, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { columnLabel, parseCellAddress } from './delimited/parser';
import type { DelimitedCellValue, DelimitedSummary, DelimitedWindowRow, Delimiter } from './delimited/parser';
import { openDelimitedPreview } from './delimited/service';
import type { DelimitedSession } from './delimited/service';
import './DelimitedPreview.css';

interface DelimitedPreviewProps {
  text: string;
  title: string;
  delimiter: Delimiter;
  onShowSource?: () => void;
}

type PreviewState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; session: DelimitedSession; summary: DelimitedSummary };
const ROW_HEIGHT = 30, COLUMN_WIDTH = 180, GUTTER_WIDTH = 64;
const isCancelled = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

export function DelimitedPreview({ text, title, delimiter, onShowSource }: DelimitedPreviewProps) {
  const [state, setState] = useState<PreviewState>({ status: 'loading' });
  useEffect(() => {
    let active = true, session: DelimitedSession | undefined;
    setState({ status: 'loading' });
    try {
      session = openDelimitedPreview(text, delimiter);
      const opened = session;
      void opened.ready.then(summary => {
        if (active) setState({ status: 'ready', session: opened, summary });
      }).catch(error => {
        opened.dispose();
        if (active && !isCancelled(error)) setState({ status: 'error', message: error instanceof Error ? error.message : '无法打开表格视图，请查看源码。' });
      });
    } catch (error) {
      setState({ status: 'error', message: error instanceof Error ? error.message : '此设备无法打开表格视图，请查看源码。' });
    }
    return () => { active = false; session?.dispose(); };
  }, [text, delimiter]);
  if (state.status !== 'ready') return <section className="nb-delimited-preview nb-delimited-message" aria-label={`${title} 表格视图`}>
    <p role={state.status === 'error' ? 'alert' : 'status'}>{state.status === 'error' ? state.message : '正在打开表格…'}</p>
    {state.status === 'error' && onShowSource && <button type="button" className="nb-delimited-button" onClick={onShowSource}>查看源码</button>}
  </section>;
  return <DelimitedTable key={delimiter} session={state.session} summary={state.summary} title={title} onShowSource={onShowSource} />;
}

function DelimitedTable({ session, summary, title, onShowSource }: { session: DelimitedSession; summary: DelimitedSummary; title: string; onShowSource?: () => void }) {
  const scroll = useRef<HTMLDivElement>(null);
  const [rows, setRows] = useState<DelimitedWindowRow[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [address, setAddress] = useState('');
  const [selected, setSelected] = useState<{ row: number; column: number } | null>(null);
  const [cell, setCell] = useState<DelimitedCellValue | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const currentCell = useRef(cell);
  currentCell.current = cell;
  useEffect(() => () => { currentCell.current = null; }, []);
  const id = useId();
  const vertical = useVirtualizer({ count: summary.rows, getScrollElement: () => scroll.current, estimateSize: () => ROW_HEIGHT, overscan: 6, paddingStart: ROW_HEIGHT, initialRect: { width: 800, height: 480 } });
  const horizontal = useVirtualizer({ count: summary.columns, getScrollElement: () => scroll.current, estimateSize: () => COLUMN_WIDTH, horizontal: true, overscan: 2, paddingStart: GUTTER_WIDTH, initialRect: { width: 800, height: 480 } });
  const virtualRows = vertical.getVirtualItems(), virtualColumns = horizontal.getVirtualItems();
  const rowStart = virtualRows[0]?.index ?? 0, rowEnd = (virtualRows.at(-1)?.index ?? -1) + 1;
  const columnStart = virtualColumns[0]?.index ?? 0, columnEnd = (virtualColumns.at(-1)?.index ?? -1) + 1;
  useEffect(() => {
    let active = true;
    if (!rowEnd || !columnEnd) { setRows([]); return; }
    setBusy(true);
    void session.readWindow({ rowStart, rowEnd, columnStart, columnEnd }).then(result => {
      if (active) { setRows(result); setError(''); }
    }).catch(reason => {
      if (active && !isCancelled(reason)) setError(reason instanceof Error ? reason.message : '表格读取失败，请查看源码。');
    }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [session, rowStart, rowEnd, columnStart, columnEnd]);
  useEffect(() => {
    let active = true;
    setCell(null); setCopyState('idle');
    if (selected) void session.readCell(selected.row, selected.column).then(value => {
      if (active) setCell(value);
    }).catch(reason => {
      if (active && !isCancelled(reason)) setError(reason instanceof Error ? reason.message : '单元格读取失败');
    });
    return () => { active = false; };
  }, [session, selected]);
  const select = (row: number, column: number) => {
    const position = { row: Math.max(0, Math.min(summary.rows - 1, row)), column: Math.max(0, Math.min(summary.columns - 1, column)) };
    setSelected(position); setAddress(`${columnLabel(position.column)}${position.row + 1}`); setError('');
    vertical.scrollToIndex(position.row, { align: 'auto' }); horizontal.scrollToIndex(position.column, { align: 'auto' });
    scroll.current?.focus({ preventScroll: true });
  };
  const visible = new Map(rows.map(row => [row.row, row]));
  const selectedId = selected && selected.row >= rowStart && selected.row < rowEnd && selected.column >= columnStart && selected.column < columnEnd ? `${id}-r${selected.row}-c${selected.column}` : undefined;
  return <section className="nb-delimited-preview" aria-label={`${title} 表格视图`} onKeyDown={event => {
    if (event.key === 'Escape' && selected) { event.preventDefault(); setSelected(null); scroll.current?.focus({ preventScroll: true }); }
  }}>
    <div className="nb-delimited-tools">
      <span className="nb-delimited-count" role="status">{summary.rows.toLocaleString()} 行 · {summary.columns.toLocaleString()} 列</span>
      {summary.raggedRows > 0 && <span className="nb-delimited-ragged">各行列数不同</span>}
      {summary.rows > 0 && <form onSubmit={event => {
        event.preventDefault();
        const position = parseCellAddress(address);
        if (!position) setError('请输入 A1 这样的单元格位置。');
        else if (position.row >= summary.rows || position.column >= summary.columns) setError('位置超出表格范围。');
        else select(position.row, position.column);
      }}>
        <input aria-label="单元格位置" placeholder="A1" autoComplete="off" spellCheck={false} value={address} onChange={event => setAddress(event.target.value)} />
        <button type="submit" className="nb-delimited-button">定位</button>
      </form>}
    </div>
    {error && <div className="nb-delimited-error" role="alert">{error}{onShowSource && <button type="button" className="nb-delimited-button" onClick={onShowSource}>查看源码</button>}</div>}
    {summary.rows === 0 ? <p className="nb-delimited-empty">文件为空</p> : <div ref={scroll} className="nb-delimited-grid" role="grid" aria-label={`${title} 数据`} aria-rowcount={summary.rows + 1} aria-colcount={summary.columns + 1} aria-busy={busy} aria-activedescendant={selectedId} tabIndex={0} onKeyDown={event => {
      const directions: Record<string, [number, number]> = { ArrowDown: [1, 0], ArrowUp: [-1, 0], ArrowRight: [0, 1], ArrowLeft: [0, -1] };
      if (directions[event.key]) {
        event.preventDefault(); const [row, column] = directions[event.key]; select((selected?.row ?? 0) + row, (selected?.column ?? 0) + column);
      } else if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault(); select(event.ctrlKey || event.metaKey ? (event.key === 'Home' ? 0 : summary.rows - 1) : (selected?.row ?? 0), event.key === 'Home' ? 0 : summary.columns - 1);
      } else if (event.key === 'Enter' && !selected) { event.preventDefault(); select(rowStart, columnStart); }
    }}>
      <div className="nb-delimited-canvas" style={{ height: vertical.getTotalSize(), width: horizontal.getTotalSize() }}>
        <div className="nb-delimited-heading" role="row" aria-rowindex={1}>
          <div className="nb-delimited-corner" role="columnheader" aria-colindex={1} title="源码中的起始行号">行</div>
          {virtualColumns.map(column => <div key={column.index} role="columnheader" aria-colindex={column.index + 2} className="nb-delimited-column" style={{ left: column.start, width: column.size }}>{columnLabel(column.index)}</div>)}
        </div>
        {virtualRows.map(row => {
          const data = visible.get(row.index);
          return <div key={row.index} role="row" aria-rowindex={row.index + 2} className="nb-delimited-row" style={{ top: row.start, height: row.size }}>
            <div role="rowheader" aria-colindex={1} className="nb-delimited-row-number" title={data ? `源码第 ${data.sourceLine} 行 · 第 ${row.index + 1} 条记录` : undefined}>{data?.sourceLine ?? ''}</div>
            {virtualColumns.map(column => {
              const value = data?.cells.find(candidate => candidate.column === column.index);
              const current = selected?.row === row.index && selected?.column === column.index;
              return <div key={column.index} role="gridcell" aria-colindex={column.index + 2} aria-selected={current} id={`${id}-r${row.index}-c${column.index}`} className={`nb-delimited-cell${value?.missing ? ' nb-delimited-cell-missing' : ''}`} style={{ left: column.start, width: column.size }} onClick={() => select(row.index, column.index)} title={value?.missing ? '此行没有该列' : '查看完整内容'}>
                <span>{value?.value ?? ''}{value?.truncated ? '…' : ''}</span>
              </div>;
            })}
          </div>;
        })}
      </div>
    </div>}
    {selected && <div className="nb-delimited-detail">
      <div className="nb-delimited-detail-heading"><strong>{columnLabel(selected.column)}{selected.row + 1}</strong><span>{cell ? `源码第 ${cell.sourceLine} 行` : '正在读取…'}</span><div className="nb-delimited-detail-actions">
        <button type="button" className="nb-delimited-button" disabled={!cell || cell.missing} aria-label="复制单元格完整内容" onClick={() => {
          if (!cell || cell.missing) return;
          const snapshot = cell;
          void Promise.resolve().then(() => navigator.clipboard.writeText(snapshot.value)).then(() => { if (currentCell.current === snapshot) setCopyState('copied'); }).catch(() => { if (currentCell.current === snapshot) setCopyState('failed'); });
        }}>{copyState === 'copied' ? '已复制' : copyState === 'failed' ? '复制失败' : '复制'}</button>
        <button type="button" className="nb-delimited-button" onClick={() => { setSelected(null); scroll.current?.focus({ preventScroll: true }); }} aria-label="关闭单元格详情">关闭</button>
      </div></div>
      {cell?.missing ? <p>此行没有该列</p> : <pre tabIndex={0} aria-label="单元格完整内容" onKeyDown={event => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
          event.preventDefault(); const range = document.createRange(); range.selectNodeContents(event.currentTarget); const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
        }
      }}>{cell?.value ?? ''}</pre>}
    </div>}
    {!selected && summary.rows > 0 && <div className="nb-delimited-hint">点击单元格查看完整内容</div>}
  </section>;
}
