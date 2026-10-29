import type { DocumentStatistics } from './documentStatistics';
import type { StatisticsSourceKind } from './documentSourceStatistics';

/** One lazily allocated worker per active consumer; disposal releases both requests and the source document. */
export function createDocumentSourceCounter() {
  let worker: Worker | undefined, nextId = 0, disposed = false;
  type Request = { id: number; content: string; kind: StatisticsSourceKind; resolve: (value: DocumentStatistics | null) => void };
  let active: Request | undefined, queued: Request | undefined;
  const settlePending = () => { active?.resolve(null); queued?.resolve(null); active = queued = undefined; };
  const send = (request: Request) => {
    active = request;
    try { worker!.postMessage({ id: request.id, content: request.content, kind: request.kind }); }
    catch { active = undefined; request.resolve(null); }
  };
  return {
    async count(content: string, kind: StatisticsSourceKind): Promise<DocumentStatistics | null> {
      if (disposed) return null;
      if (typeof Worker === 'undefined') {
        try { return await (await import('./documentSourceStatistics')).countDocumentSource(content, kind); }
        catch { return null; }
      }
      if (!worker) {
        try { worker = new Worker(new URL('./documentStatistics.worker.ts', import.meta.url), { type: 'module' }); }
        catch { return null; }
        worker.onmessage = (event: MessageEvent<{ id: number; value: DocumentStatistics | null }>) => {
          if (event.data.id !== active?.id) return;
          active.resolve(event.data.value); active = undefined;
          if (queued) { const next = queued; queued = undefined; send(next); }
        };
        worker.onerror = () => { settlePending(); worker?.terminate(); worker = undefined; };
      }
      const id = ++nextId;
      return new Promise(resolve => {
        const request = { id, content, kind, resolve };
        // Keep at most one running parse and the newest snapshot. Slow source
        // parsing must not accumulate copies of every intermediate document.
        if (active) { queued?.resolve(null); queued = request; }
        else send(request);
      });
    },
    dispose() { disposed = true; worker?.terminate(); worker = undefined; settlePending(); },
  };
}
