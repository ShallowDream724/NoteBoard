import { useCallback } from 'react';
import { create } from 'zustand';

type DocumentStatusTarget = { documentKey: string; element: HTMLDivElement };
const useTargets = create<Partial<Record<string, DocumentStatusTarget>>>(() => ({}));

export function useDocumentStatusTarget(slot: string, documentKey?: string) {
  return useTargets(targets => {
    const target = targets[slot];
    return target && target.documentKey === documentKey ? target.element : null;
  });
}

export function useDocumentStatusSlot(slot: string, documentKey: string) {
  return useCallback((element: HTMLDivElement | null) => {
    if (!element) return;
    const target = { documentKey, element };
    useTargets.setState({ [slot]: target });
    return () => useTargets.setState(targets => targets[slot] === target ? { [slot]: undefined } : targets);
  }, [slot, documentKey]);
}
