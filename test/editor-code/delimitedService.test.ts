import { expect, it, vi } from 'vitest';
import { openDelimitedPreview } from '../../src/features/editor-code/delimited/service';
import type { DelimitedRequest, DelimitedResponse } from '../../src/features/editor-code/delimited/protocol';

class TestWorker {
  onmessage: ((event: MessageEvent<DelimitedResponse>) => void) | null = null;
  onerror: (() => void) | null = null;
  messages: DelimitedRequest[] = [];
  terminate = vi.fn();
  postMessage(message: DelimitedRequest) { this.messages.push(message); }
  emit(response: DelimitedResponse) { this.onmessage?.({ data: response } as MessageEvent<DelimitedResponse>); }
}
const summary = { rows: 1000, columns: 30, raggedRows: 0, sourceUnits: 10, indexBytes: 16000 };
const range = (rowStart: number) => ({ rowStart, rowEnd: rowStart + 10, columnStart: 0, columnEnd: 4 });
async function ready(worker: TestWorker) {
  const session = openDelimitedPreview('a,b', ',', () => worker as unknown as Worker);
  worker.emit({ id: worker.messages[0].id, type: 'ready', summary });
  await session.ready;
  return session;
}

it('terminates the worker on disposal, rejects pending requests and ignores late results', async () => {
  const worker = new TestWorker(), session = await ready(worker);
  const result = session.readWindow(range(0));
  const error = result.catch(reason => reason);
  const lateHandler = worker.onmessage!;
  session.dispose(); session.dispose();
  expect((await error).name).toBe('AbortError');
  expect(worker.terminate).toHaveBeenCalledTimes(1);
  expect(worker.onmessage).toBeNull();
  lateHandler(new MessageEvent<DelimitedResponse>('message', { data: { id: worker.messages[1].id, type: 'window', rows: [] } }));
  await expect(session.readCell(0, 0)).rejects.toMatchObject({ name: 'AbortError' });
});

it('coalesces scrolling to one active window and the latest replacement', async () => {
  const worker = new TestWorker(), session = await ready(worker);
  const first = session.readWindow(range(0));
  const middle = session.readWindow(range(10)).catch(reason => reason);
  const last = session.readWindow(range(20));
  expect((await middle).name).toBe('AbortError');
  expect(worker.messages).toHaveLength(2);
  worker.emit({ id: worker.messages[1].id, type: 'window', rows: [] });
  await first; await Promise.resolve(); await Promise.resolve();
  expect(worker.messages).toHaveLength(3);
  expect(worker.messages[2]).toMatchObject({ type: 'window', range: range(20) });
  worker.emit({ id: worker.messages[2].id, type: 'window', rows: [] });
  await last; session.dispose();
});

it('coalesces full cell reads and releases both active and queued reads', async () => {
  const worker = new TestWorker(), session = await ready(worker);
  const first = session.readCell(0, 0).catch(reason => reason);
  const middle = session.readCell(1, 1).catch(reason => reason);
  const last = session.readCell(2, 2).catch(reason => reason);
  expect((await middle).name).toBe('AbortError');
  expect(worker.messages).toHaveLength(2);
  session.dispose();
  expect((await first).name).toBe('AbortError');
  expect((await last).name).toBe('AbortError');
});

it('reports parse and worker failures instead of retaining incomplete data', async () => {
  const worker = new TestWorker();
  const session = openDelimitedPreview('"bad', ',', () => worker as unknown as Worker);
  const failed = session.ready.catch(reason => reason);
  worker.emit({ id: worker.messages[0].id, type: 'error', message: '第 1 行的引号未闭合。请查看源码。' });
  expect((await failed).message).toContain('引号未闭合');
  session.dispose();
  const other = new TestWorker(), opened = await ready(other);
  const result = opened.readWindow(range(0)).catch(reason => reason);
  other.onerror!();
  expect((await result).message).toContain('请查看源码');
  expect(other.terminate).toHaveBeenCalledOnce();
});
