import { useDocumentStatusSlot, useDocumentStatusTarget } from '../../components/statusbar/documentStatusTarget';

export type PdfPane = 'primary' | 'reference';

export function usePdfStatusTarget(pane: PdfPane, documentKey?: string) {
  return useDocumentStatusTarget(`pdf-${pane}`, documentKey);
}

export function PdfStatusSlot({ pane, documentKey, className }: {
  pane: PdfPane;
  documentKey: string;
  className?: string;
}) {
  const register = useDocumentStatusSlot(`pdf-${pane}`, documentKey);

  return <div ref={register} className={className ? `nb-pdf-status-slot ${className}` : 'nb-pdf-status-slot'} />;
}
