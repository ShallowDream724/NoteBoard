import { afterEach, describe, expect, it, vi } from 'vitest';
import { disposeCodeHighlighting, highlightCode, requestCodeHighlight, type CodeToken } from '../../src/features/editor-md/codeHighlighting';

class FakeWorker {
  static instances: FakeWorker[] = [];
  requests: { id: number; code: string; language: string }[] = [];
  onmessage?: (event: { data: { id: number; tokens: CodeToken[]; unavailable?: boolean } }) => void;
  onerror?: () => void;
  terminated = false;
  constructor() { FakeWorker.instances.push(this); }
  postMessage(request: { id: number; code: string; language: string }) { this.requests.push(request); }
  terminate() { this.terminated = true; }
  reply(tokens: CodeToken[] = []) { this.onmessage?.({ data: { id: this.requests.at(-1)!.id, tokens } }); }
}
const install = () => { vi.stubGlobal('Worker', FakeWorker); return FakeWorker.instances; };
afterEach(() => { disposeCodeHighlighting(); FakeWorker.instances = []; vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('code worker queue', () => {
  it('shares in-flight work, keeps consumer cancellation separate, and caches results across visibility', async () => {
    const workers = install();
    const controller = new AbortController();
    const first = highlightCode('const x = 1', 'js', { signal: controller.signal });
    const second = highlightCode('const x = 1', 'javascript');
    expect(workers).toHaveLength(1); expect(workers[0].requests).toHaveLength(1);
    controller.abort(); expect(await first).toEqual([]); expect(workers[0].terminated).toBe(false);
    const tokens = [{ from: 0, to: 5, className: 'hljs-keyword' }];
    workers[0].reply(tokens); expect(await second).toEqual(tokens);
    expect(await highlightCode('const x = 1', 'js')).toEqual(tokens);
    expect(workers[0].requests).toHaveLength(1);
  });

  it('cancels queued work before tokenization and terminates stale active CPU work', async () => {
    const workers = install();
    const firstController = new AbortController(), secondController = new AbortController();
    const first = highlightCode('first', 'js', { signal: firstController.signal });
    const second = highlightCode('second', 'js', { signal: secondController.signal });
    const third = highlightCode('third', 'js');
    secondController.abort(); firstController.abort();
    expect(await first).toEqual([]); expect(await second).toEqual([]);
    expect(workers[0].terminated).toBe(true); expect(workers).toHaveLength(2);
    expect(workers[1].requests[0].code).toBe('third');
    workers[0].reply([{ from: 0, to: 1, className: 'stale' }]);
    workers[1].reply(); expect(await third).toEqual([]);
  });

  it('bounds pending requests and disposes promises and parser resources', async () => {
    const workers = install();
    const pending = Array.from({ length: 64 }, (_, index) => highlightCode(String(index), 'js'));
    expect(await highlightCode('overflow', 'js')).toEqual([]);
    expect(workers[0].requests).toHaveLength(1);
    disposeCodeHighlighting();
    expect(workers[0].terminated).toBe(true);
    expect((await Promise.all(pending)).every(tokens => !tokens.length)).toBe(true);
  });

  it('recovers from a grammar timeout and releases an idle worker', async () => {
    vi.useFakeTimers(); const workers = install();
    const failed = highlightCode('slow', 'js');
    const next = highlightCode('next', 'js');
    await vi.advanceTimersByTimeAsync(5000);
    expect(await failed).toEqual([]); expect(workers[0].terminated).toBe(true);
    workers[1].reply(); await next;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(workers[1].terminated).toBe(true);
  });

  it('does not cache a failed grammar load as an empty successful result', async () => {
    const workers = install();
    const first = requestCodeHighlight('def greet(): pass', 'python');
    workers[0].onmessage?.({ data: { id: workers[0].requests[0].id, tokens: [], unavailable: true } });
    expect((await first).status).toBe('unavailable');
    expect(workers[0].terminated).toBe(true);
    const retry = requestCodeHighlight('def greet(): pass', 'python');
    expect(workers).toHaveLength(2);
    const tokens = [{ from: 0, to: 3, className: 'hljs-keyword' }];
    workers[1].reply(tokens);
    expect(await retry).toEqual({ tokens, status: 'ready' });
    expect(await requestCodeHighlight('def greet(): pass', 'py')).toEqual({ tokens, status: 'ready' });
  });
});
