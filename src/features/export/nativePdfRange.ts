import { invoke } from '@tauri-apps/api/core';
import type { PdfReceipt } from './model';
import { PdfRangeTransport } from '../../core/pdf/pdfRangeTransport';

export class NativePdfRange extends PdfRangeTransport {
  constructor(receipt: PdfReceipt, fail: (error: unknown) => void) {
    super(
      receipt.size,
      (offset, length) => invoke<ArrayBuffer>('read_pdf', { id: receipt.id, revision: receipt.revision, offset, length }),
      fail,
    );
  }
}
