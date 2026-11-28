import { invoke } from '@tauri-apps/api/core';
import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
import { PdfRangeTransport } from '../../core/pdf/pdfRangeTransport';
import { getDocument } from '../../core/pdf/pdfRuntime';
import { confirmLargeFile, getLargeFileThresholdBytes } from '../../core/files/largeFilePolicy';
import { useDocumentStore } from '../../stores/documentStore';

interface PdfSnapshot {
  size: number;
  version: string;
}

type LoadResult = { pdf: PDFDocumentProxy; error?: never } | { pdf?: never; error: string };

function explain(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'PasswordException') return '此 PDF 需要密码，请使用默认应用打开。';
    if (error.name === 'InvalidPDFException') return 'PDF 内容无法解析，文件可能已损坏。';
    return error.message;
  }
  return typeof error === 'string' ? error : '无法读取 PDF 文件。';
}

export function useLocalPdf(filePath: string, fileName: string, active: boolean, attempt: number): LoadResult | null {
  const [result, setResult] = useState<(LoadResult & { attempt: number }) | null>(null);
  const acceptedSize = useRef(0);
  useEffect(() => {
    if (!active) {
      setResult(null);
      return;
    }
    let disposed = false;
    let range: PdfRangeTransport | undefined;
    let task: PDFDocumentLoadingTask | undefined;
    function stop() {
      range?.abort();
      const previous = task;
      task = undefined;
      void previous?.destroy().catch(error => console.warn('释放 PDF 任务失败:', error));
    }
    function fail(error: unknown) {
      if (disposed || !task) return;
      setResult({ attempt, error: explain(error) });
      stop();
    }
    void (async () => {
      try {
        const expected = await invoke<PdfSnapshot>('local_pdf_metadata', { key: filePath });
        if (disposed) return;
        if (!Number.isSafeInteger(expected.size) || expected.size <= 0) throw new Error('PDF 文件为空或超出可读取范围。');
        // The open flow already checked its observed size. Recheck only if this version grew.
        const preparedSize = useDocumentStore.getState().getDocument(filePath)?.size ?? 0;
        if (expected.size > Math.max(preparedSize, acceptedSize.current, getLargeFileThresholdBytes())) {
          if (!await confirmLargeFile(fileName, expected.size)) throw new Error('已取消加载此大文件。');
          if (disposed) return;
          acceptedSize.current = expected.size;
        }
        range = new PdfRangeTransport(
          expected.size,
          (offset, length) => invoke<ArrayBuffer>('read_local_pdf_range', { key: filePath, expected, offset, length }),
          fail,
        );
        task = getDocument({ range, rangeChunkSize: 65536, disableAutoFetch: true, disableStream: true, useSystemFonts: true });
        const pdf = await task.promise;
        if (!disposed && task) setResult({ attempt, pdf });
      } catch (error) {
        if (disposed) return;
        // A failed range may already have destroyed this task and reported its I/O error.
        setResult(previous => previous?.attempt === attempt && previous.error ? previous : { attempt, error: explain(error) });
        stop();
      }
    })();
    return () => {
      disposed = true;
      stop();
    };
  }, [filePath, fileName, active, attempt]);
  return active && result?.attempt === attempt ? result : null;
}
