import { ANALYSIS_LIMIT_MESSAGE, AUTO_ANALYSIS_MAX_CHARS, MANUAL_ANALYSIS_MAX_CHARS, type TextAnalysisRequest, type TextAnalysisResult } from './textAnalysis';

export class AnalysisCancelled extends Error {
  constructor() { super('本次操作已取消，请重试'); this.name = 'AnalysisCancelled'; }
}

export interface AnalysisWorker {
  onmessage: ((event: MessageEvent<{ id: number; result: TextAnalysisResult }>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: { id: number; request: TextAnalysisRequest }): void;
  terminate(): void;
}
interface PendingAnalysis {
  id: number;
  owner: object;
  priority: 'manual' | 'automatic';
  request: TextAnalysisRequest | null;
  resolve: (result: TextAnalysisResult) => void;
  reject: (error: Error) => void;
}

/** One process-wide worker, at most one active message and one latest request. */
export class TextAnalysisService {
  private worker: AnalysisWorker | null = null;
  private active: PendingAnalysis | null = null;
  private latest: PendingAnalysis | null = null;
  private timeout: ReturnType<typeof setTimeout> | null = null;
  private nextId = 0;
  constructor(private readonly createWorker: () => AnalysisWorker) {}

  request(owner: object, request: TextAnalysisRequest, priority: 'manual' | 'automatic' = 'manual'): Promise<TextAnalysisResult> {
    const maximum = priority === 'automatic' ? AUTO_ANALYSIS_MAX_CHARS : MANUAL_ANALYSIS_MAX_CHARS;
    if (request.text.length > maximum) return Promise.reject(new Error(ANALYSIS_LIMIT_MESSAGE));
    this.cancelOwner(owner);
    return new Promise((resolve, reject) => {
      const pending = { id: ++this.nextId, owner, priority, request, resolve, reject };
      if (priority === 'automatic' && this.latest?.priority === 'manual') {
        reject(new AnalysisCancelled());
        return;
      }
      if (priority === 'manual' && this.active?.priority === 'automatic') {
        this.active.reject(new AnalysisCancelled());
        this.latest?.reject(new AnalysisCancelled());
        this.active = this.latest = null;
        this.releaseWorker();
      }
      if (this.active) {
        this.latest?.reject(new AnalysisCancelled());
        this.latest = pending;
      } else this.start(pending);
    });
  }

  cancelOwner(owner: object): void {
    if (this.latest?.owner === owner) {
      this.latest.reject(new AnalysisCancelled());
      this.latest = null;
    }
    if (this.active?.owner === owner) {
      const active = this.active;
      this.active = null;
      this.releaseWorker();
      active.reject(new AnalysisCancelled());
      this.startLatest();
    }
  }

  dispose(): void {
    this.active?.reject(new AnalysisCancelled());
    this.latest?.reject(new AnalysisCancelled());
    this.active = this.latest = null;
    this.releaseWorker();
  }

  private start(pending: PendingAnalysis): void {
    this.active = pending;
    try {
      this.worker ??= this.createWorker();
      const worker = this.worker;
      this.worker.onmessage = (event) => {
        if (this.worker !== worker || this.active?.id !== event.data.id) return;
        this.clearTimeout();
        const completed = this.active;
        this.active = null;
        completed.resolve(event.data.result);
        this.startLatest();
      };
      this.worker.onerror = () => {
        if (this.worker !== worker) return;
        this.active?.reject(new Error('后台处理失败，请重试或选择较小片段'));
        this.active = null;
        this.releaseWorker();
        this.startLatest();
      };
      this.worker.postMessage({ id: pending.id, request: pending.request! });
      // The worker owns the cloned source. No full-text cache on the service.
      pending.request = null;
      this.timeout = setTimeout(() => {
        if (this.active?.id !== pending.id) return;
        this.active.reject(new Error('后台处理超时，请选择较小片段或使用外部工具'));
        this.active = null;
        this.releaseWorker();
        this.startLatest();
      }, pending.priority === 'automatic' ? 10000 : 30000);
    } catch (error) {
      this.active = null;
      pending.reject(error instanceof Error ? error : new Error(String(error)));
      this.releaseWorker();
      this.startLatest();
    }
  }

  private startLatest(): void {
    const pending = this.latest;
    this.latest = null;
    if (pending) this.start(pending);
    else this.releaseWorker();
  }
  private releaseWorker(): void {
    this.clearTimeout();
    if (this.worker) {
      this.worker.onmessage = this.worker.onerror = null;
      this.worker.terminate();
      this.worker = null;
    }
  }
  private clearTimeout(): void {
    if (this.timeout !== null) clearTimeout(this.timeout);
    this.timeout = null;
  }
}

export const textAnalysisService = new TextAnalysisService(() => {
  if (typeof Worker === 'undefined') throw new Error('当前环境无法后台处理，请选择较小片段');
  return new Worker(new URL('./textAnalysis.worker.ts', import.meta.url), { type: 'module' });
});
