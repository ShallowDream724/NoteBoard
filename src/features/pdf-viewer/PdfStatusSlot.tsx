import { useCallback } from 'react';
import { create } from 'zustand';

export type PdfPane = 'primary' | 'reference';

type StatusSlot = { documentKey: string; element: HTMLDivElement };
const usePdfStatusSlots = create<Record<PdfPane, StatusSlot | null>>(() => ({ primary: null, reference: null }));

export function usePdfStatusTarget(pane: PdfPane, documentKey?: string) {
  return usePdfStatusSlots(slots => {
    const slot = slots[pane];
    return slot && slot.documentKey === documentKey ? slot.element : null;
  });
}

export function PdfStatusSlot({ pane, documentKey, className }: {
  pane: PdfPane;
  documentKey: string;
  className?: string;
}) {
  const register = useCallback((element: HTMLDivElement | null) => {
    if (!element) return;
    const slot = { documentKey, element };
    usePdfStatusSlots.setState({ [pane]: slot });
    return () => usePdfStatusSlots.setState(slots => slots[pane] === slot ? { [pane]: null } : slots);
  }, [documentKey, pane]);

  return <div ref={register} className={className ? `nb-pdf-status-slot ${className}` : 'nb-pdf-status-slot'} />;
}
