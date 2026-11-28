import { PDFDataRangeTransport } from 'pdfjs-dist';

const IPC_RANGE_LIMIT = 1024 * 1024;

/** PDF.js consumes one response per range. Group bounded native reads before posting it. */
export class PdfRangeTransport extends PDFDataRangeTransport {
  private stopped = false;
  private pending = new Map<number, number[]>();

  constructor(
    private size: number,
    private readRange: (offset: number, length: number) => Promise<ArrayBuffer>,
    private fail: (error: unknown) => void,
  ) {
    super(size, null, true);
  }

  requestDataRange(begin: number, end: number) {
    if (this.stopped) return;
    if (!Number.isSafeInteger(begin) || !Number.isSafeInteger(end) || begin < 0 || end <= begin || end > this.size) {
      this.reject(new Error('PDF 读取范围无效。'));
      return;
    }
    // Responses identify their reader by begin. Same-origin requests retain creation order.
    const existing = this.pending.get(begin);
    if (existing) {
      existing.push(end);
      return;
    }
    const requests = [end];
    this.pending.set(begin, requests);
    void this.readRequests(begin, requests).catch(error => this.reject(error));
  }

  private async readRequests(begin: number, requests: number[]) {
    try {
      for (const end of requests) {
        if (this.stopped) return;
        let response = end - begin > IPC_RANGE_LIMIT ? new Uint8Array(end - begin) : undefined;
        for (let from = begin; from < end; from += IPC_RANGE_LIMIT) {
          if (this.stopped) return;
          const length = Math.min(IPC_RANGE_LIMIT, end - from);
          const data = await this.readRange(from, length);
          if (this.stopped) return;
          const chunk = new Uint8Array(data);
          if (chunk.byteLength !== length) throw new Error('PDF 数据读取不完整。');
          if (response) response.set(chunk, from - begin);
          else response = chunk;
        }
        this.onDataRange(begin, response!);
      }
    } finally {
      if (this.pending.get(begin) === requests) this.pending.delete(begin);
    }
  }

  private reject(error: unknown) {
    if (this.stopped) return;
    this.abort();
    this.fail(error);
  }

  abort() {
    this.stopped = true;
    this.pending.clear();
  }
}
