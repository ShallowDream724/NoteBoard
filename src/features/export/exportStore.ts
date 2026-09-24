import { create } from 'zustand';
import { useWindowStore } from '../../stores/windowStore';
interface State { docKey: string | null; open: () => void; close: () => void }
/** Small lazy entry; no editor or PDF runtime enters the application shell. */
export const useExportStore = create<State>(set => ({
  docKey: null,
  open: () => {
    const state = useWindowStore.getState(); const tab = state.tabs.find(tab => tab.key === state.activeKey);
    if (tab && isRichDocument(tab.kind)) set({ docKey: tab.key });
  },
  close: () => set({ docKey: null }),
}));
import { isRichDocument } from '../../core/docKind';
