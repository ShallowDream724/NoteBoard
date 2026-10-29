import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDocumentSourceCounter } from '../../src/features/document-statistics/documentSourceCounter';

afterEach(() => vi.unstubAllGlobals());
describe('source statistics worker ownership', () => {
  it('allocates lazily, correlates asynchronous responses and releases pending requests on disposal', async () => {
    const instances: FakeWorker[] = [];
    class FakeWorker {
      sent: Array<{ id: number; content: string }> = [];
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      terminate = vi.fn();
      constructor() { instances.push(this); }
      postMessage(message: { id: number; content: string }) { this.sent.push(message); }
      respond(id: number) { this.onmessage?.({ data: { id, value: { characters: 2, words: 1 } } } as MessageEvent); }
    }
    vi.stubGlobal('Worker', FakeWorker);
    const counter = createDocumentSourceCounter(); expect(instances).toHaveLength(0);
    const first = counter.count('hi', 'code'), superseded = counter.count('old content', 'code'), second = counter.count('new content', 'code');
    expect(instances).toHaveLength(1);
    const worker = instances[0]; expect(worker.sent.map(message => message.content)).toEqual(['hi']);
    expect(await superseded).toBeNull();
    worker.respond(worker.sent[0].id); expect(await first).toEqual({ characters: 2, words: 1 });
    expect(worker.sent.map(message => message.content)).toEqual(['hi', 'new content']);
    counter.dispose(); expect(await second).toBeNull(); expect(worker.terminate).toHaveBeenCalledOnce();
    expect(await counter.count('after disposal', 'code')).toBeNull(); expect(instances).toHaveLength(1);
  });
  it('settles failed worker requests instead of leaving unhandled or never-ending work', async () => {
    let fail!: () => void;
    vi.stubGlobal('Worker', class {
      onmessage = null;
      set onerror(callback: () => void) { fail = callback; }
      postMessage() {}
      terminate() {}
    });
    const counter = createDocumentSourceCounter(), pending = counter.count('text', 'code');
    fail(); expect(await pending).toBeNull(); counter.dispose();
  });
});
