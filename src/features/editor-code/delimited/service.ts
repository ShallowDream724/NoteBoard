import { DELIMITED_LIMITS } from './parser';
import type { DelimitedCellValue, DelimitedSummary, DelimitedWindowRequest, DelimitedWindowRow, Delimiter } from './parser';
import type { DelimitedRequest, DelimitedResponse } from './protocol';

export interface DelimitedSession {
  ready: Promise<DelimitedSummary>;
  readWindow(range: DelimitedWindowRequest): Promise<DelimitedWindowRow[]>;
  readCell(row: number, column: number): Promise<DelimitedCellValue>;
  dispose(): void;
}

interface Deferred<T> { resolve(value: T): void; reject(reason: unknown): void }
type WorkerFactory = () => Worker;
const cancelled = () => new DOMException('表格视图已关闭', 'AbortError');
const defaultWorker: WorkerFactory = () => new Worker(new URL('./delimited.worker.ts', import.meta.url), { type: 'module' });

/** Each mounted preview owns one worker. Only one viewport request and its latest
 * replacement are retained, so scroll bursts cannot enqueue unbounded work. */
export function openDelimitedPreview(text: string, delimiter: Delimiter, createWorker: WorkerFactory = defaultWorker): DelimitedSession {
  if (text.length > DELIMITED_LIMITS.sourceUnits) throw new Error('文本过大，无法打开表格视图。请查看源码。');
  const worker = createWorker();
  let nextId = 0, disposed = false;
  const pending = new Map<number, Deferred<DelimitedResponse>>();
  const send = (request: Omit<Extract<DelimitedRequest, { type: 'load' }>, 'id'> | Omit<Extract<DelimitedRequest, { type: 'window' }>, 'id'> | Omit<Extract<DelimitedRequest, { type: 'cell' }>, 'id'>) => new Promise<DelimitedResponse>((resolve, reject) => {
    if (disposed) { reject(cancelled()); return; }
    const id = ++nextId; pending.set(id, { resolve, reject });
    try { worker.postMessage({ ...request, id }); }
    catch (error) { pending.delete(id); reject(error); }
  });
  const failPending = (error: unknown) => { for (const item of pending.values()) item.reject(error); pending.clear(); };
  worker.onmessage = (event: MessageEvent<DelimitedResponse>) => {
    if (disposed) return;
    const response = event.data, item = pending.get(response.id);
    if (!item) return;
    pending.delete(response.id);
    if (response.type === 'error') item.reject(new Error(response.message));
    else item.resolve(response);
  };
  worker.onerror = () => {
    failPending(new Error('无法打开表格视图，请查看源码。'));
    dispose();
  };
  let windowActive = false;
  let queuedWindow: { range: DelimitedWindowRequest; deferred: Deferred<DelimitedWindowRow[]> } | undefined;
  const runWindow = (range: DelimitedWindowRequest, deferred: Deferred<DelimitedWindowRow[]>) => {
    windowActive = true;
    void send({ type: 'window', range }).then(response => {
      if (response.type !== 'window') throw new Error('表格读取失败');
      deferred.resolve(response.rows);
    }).catch(deferred.reject).finally(() => {
      windowActive = false;
      const next = queuedWindow; queuedWindow = undefined;
      if (next) { if (disposed) next.deferred.reject(cancelled()); else runWindow(next.range, next.deferred); }
    });
  };
  let cellActive = false;
  let queuedCell: { row: number; column: number; deferred: Deferred<DelimitedCellValue> } | undefined;
  const runCell = (row: number, column: number, deferred: Deferred<DelimitedCellValue>) => {
    cellActive = true;
    void send({ type: 'cell', row, column }).then(response => {
      if (response.type !== 'cell') throw new Error('单元格读取失败');
      deferred.resolve(response.cell);
    }).catch(deferred.reject).finally(() => {
      cellActive = false;
      const next = queuedCell; queuedCell = undefined;
      if (next) { if (disposed) next.deferred.reject(cancelled()); else runCell(next.row, next.column, next.deferred); }
    });
  };
  function dispose() {
    if (disposed) return;
    disposed = true; worker.onmessage = null; worker.onerror = null; worker.terminate(); failPending(cancelled());
    queuedWindow?.deferred.reject(cancelled()); queuedWindow = undefined;
    queuedCell?.deferred.reject(cancelled()); queuedCell = undefined;
  }
  return {
    ready: send({ type: 'load', text, delimiter }).then(response => {
      if (response.type !== 'ready') throw new Error('无法打开表格视图');
      return response.summary;
    }),
    readWindow: range => new Promise((resolve, reject) => {
      if (disposed) { reject(cancelled()); return; }
      const deferred = { resolve, reject };
      if (windowActive) { queuedWindow?.deferred.reject(cancelled()); queuedWindow = { range, deferred }; }
      else runWindow(range, deferred);
    }),
    readCell: (row, column) => new Promise((resolve, reject) => {
      if (disposed) { reject(cancelled()); return; }
      const deferred = { resolve, reject };
      if (cellActive) { queuedCell?.deferred.reject(cancelled()); queuedCell = { row, column, deferred }; }
      else runCell(row, column, deferred);
    }),
    dispose,
  };
}
