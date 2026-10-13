import { invoke } from '@tauri-apps/api/core';
import { PDFDataRangeTransport } from 'pdfjs-dist';
import type { PdfReceipt } from './model';

const IPC_RANGE_LIMIT = 1024 * 1024;

/** PDF.js completes a range reader on its first response. Native IPC fragments
 * therefore belong to one request buffer, never to separate onDataRange calls. */
export class NativePdfRange extends PDFDataRangeTransport {
  private stopped = false;
  private pending = new Map<number, number[]>();

  constructor(private receipt: PdfReceipt, private fail: (error: unknown) => void) {
    super(receipt.size, null, true);
  }

  requestDataRange(begin: number, end: number) {
    if (this.stopped) return;
    if (!Number.isSafeInteger(begin) || !Number.isSafeInteger(end) || begin < 0 || end <= begin || end > this.receipt.size) {
      this.reject(new Error('PDF 读取范围无效，请重新生成预览。')); return;
    }
    // Responses identify their reader only by begin. Keep same-origin requests
    // in creation order while independent ranges may still read concurrently.
    const existing = this.pending.get(begin);
    if (existing) { existing.push(end); return; }
    const requests = [end]; this.pending.set(begin, requests);
    void this.readRequests(begin, requests).catch(error => this.reject(error));
  }

  private async readRequests(begin: number, requests: number[]) {
    try {
      for (const end of requests) {
        if (this.stopped) return;
        let response: Uint8Array | undefined = end - begin > IPC_RANGE_LIMIT ? new Uint8Array(end - begin) : undefined;
        for (let from = begin; from < end; from += IPC_RANGE_LIMIT) {
          if (this.stopped) return;
          const length = Math.min(IPC_RANGE_LIMIT, end - from);
          const data = await invoke<ArrayBuffer>('read_pdf', { id: this.receipt.id, revision: this.receipt.revision, offset: from, length });
          if (this.stopped) return;
          const chunk = new Uint8Array(data);
          if (chunk.byteLength !== length) throw new Error('PDF 数据读取不完整，请重新生成预览。');
          if (response) response.set(chunk, from - begin); else response = chunk;
        }
        this.onDataRange(begin, response!);
      }
    } finally { if (this.pending.get(begin) === requests) this.pending.delete(begin); }
  }

  private reject(error: unknown) {
    if (this.stopped) return;
    this.abort(); this.fail(error);
  }

  abort() { this.stopped = true; this.pending.clear(); }
}
