import { useId, useLayoutEffect, useRef, useState } from 'react';
import { openWithDefaultApp } from '../../core/ipc/commands';
import { registerEditorCapabilities } from '../../core/editor/editorRegistry';
import { takeViewState } from '../session/editorSuspension';
import { readingState } from '../session/readingState';
import { PdfDocumentView, type PdfReadingState } from './PdfDocumentView';
import { clamp, MAX_ZOOM, MIN_ZOOM } from './pdfPageLayout';
import { useLocalPdf } from './useLocalPdf';
import './pdfViewer.css';

interface PdfViewerProps {
  filePath: string;
  fileName: string;
  active?: boolean;
  /** Only the host tab owns persistent editor view state. */
  docKey?: string;
  referenceKey?: string;
}

const DEFAULT_POSITION: PdfReadingState = { kind: 'pdf', page: 1, zoom: 1, scrollLeft: 0, scrollTop: 0 };
const MAX_REFERENCE_POSITIONS = 24;
const referencePositions = new Map<string, PdfReadingState>();

function LocalPdfReader({ filePath, fileName, active = true, docKey, referenceKey }: PdfViewerProps) {
  const [attempt, setAttempt] = useState(0);
  const [externalError, setExternalError] = useState('');
  const viewport = useRef<HTMLDivElement>(null);
  const position = useRef(DEFAULT_POSITION);
  const instanceId = useId();
  const result = useLocalPdf(filePath, fileName, active, attempt);

  useLayoutEffect(() => {
    if (!docKey) {
      position.current = referencePositions.get(filePath) ?? DEFAULT_POSITION;
      return () => {
        referencePositions.delete(filePath);
        if (position.current !== DEFAULT_POSITION) referencePositions.set(filePath, position.current);
        if (referencePositions.size > MAX_REFERENCE_POSITIONS) referencePositions.delete(referencePositions.keys().next().value!);
      };
    }
    const restored = readingState(takeViewState(docKey));
    if (restored?.kind === 'pdf') position.current = { ...restored, zoom: clamp(restored.zoom, MIN_ZOOM, MAX_ZOOM) };
    return registerEditorCapabilities({
      docKey,
      instanceId,
      getRevision: () => 0,
      flush: async () => ({ docKey, instanceId, revision: 0, content: null, readonly: true }),
      focus: () => viewport.current?.focus(),
      getSelectedText: () => {
        const selection = window.getSelection();
        const element = viewport.current;
        if (!selection || !element?.contains(selection.anchorNode) || !element.contains(selection.focusNode)) return '';
        return selection.toString();
      },
      canSuspend: () => true,
      captureViewState: () => position.current,
    });
  }, [docKey, filePath, instanceId]);

  return <section className="nb-pdf-reader" aria-label={'PDF 预览：' + fileName}>
    {active && !result && <div className="nb-pdf-status" role="status">正在打开 PDF…</div>}
    {result?.error && <div className="nb-pdf-status">
      <p role="alert">{result.error}</p>
      <div className="nb-pdf-status-actions">
        <button type="button" className="nb-btn-secondary" onClick={() => { setExternalError(''); setAttempt(value => value + 1); }}>重试</button>
        <button type="button" className="nb-btn-secondary" onClick={() => {
          setExternalError('');
          void openWithDefaultApp(filePath).catch(() => setExternalError('无法使用默认应用打开此 PDF。'));
        }}>使用默认应用打开</button>
      </div>
      {externalError && <p role="alert">{externalError}</p>}
    </div>}
    {result?.pdf && <PdfDocumentView pdf={result.pdf} viewport={viewport} position={position} fileName={fileName}
      pane={referenceKey ? 'reference' : 'primary'} documentKey={referenceKey ?? docKey} />}
  </section>;
}

export function PdfViewer(props: PdfViewerProps) {
  return <LocalPdfReader key={props.filePath} {...props} />;
}
