import { create } from 'zustand';
import type { UpdateCheckResult } from '../core/ipc/types';
import * as ipc from '../core/ipc/commands';
import { translateUpdateCheckError } from '../core/updates';
import { onUpdateNoticeDismissed } from '../core/ipc/events';

interface UpdateStore {
  checking: boolean;
  hasUpdate: boolean;
  updateResult: UpdateCheckResult | null;
  checkError: string | null;
  modalOpen: boolean;
  noticeReady: boolean;
  dismissedNoticeVersions: string[];
  dismissNotice: (version: string) => void;
  checkForUpdates: (silent?: boolean) => Promise<void>;
  openModal: () => void;
  closeModal: () => void;
  initAutoUpdateTimer: () => () => void;
}

const MINUTE = 60_000;
const REGULAR_INTERVAL = 30 * MINUTE;
const MAX_RETRY_INTERVAL = 6 * 60 * MINUTE;

export const useUpdateStore = create<UpdateStore>((set, get) => {
  let inFlight: Promise<void> | null = null;
  let retryNotBefore = 0;
  const mergeDismissals = (versions: string[]) => set(state => ({
    dismissedNoticeVersions: [...new Set([...state.dismissedNoticeVersions, ...versions])],
  }));
  return {
    checking: false, hasUpdate: false, updateResult: null, checkError: null, modalOpen: false,
    noticeReady: false,
    dismissedNoticeVersions: [],
    dismissNotice: version => {
      mergeDismissals([version]);
      void ipc.dismissUpdateNotice(version).catch(error => console.error('Update reminder dismissal:', error));
    },
    checkForUpdates: (silent = false) => {
      // A user may join an automatic request; their click must still open its status.
      if (!silent) set({ modalOpen: true });
      if (inFlight) return inFlight;
      if (silent && get().modalOpen) return Promise.resolve();
      inFlight = (async () => {
        // Start after publishing the shared promise, including synchronous IPC failures.
        await Promise.resolve();
        try {
          const result = await ipc.checkForUpdates();
          retryNotBefore = 0;
          set({ updateResult: result, hasUpdate: Boolean(result.updateAvailable) });
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          const reset = /^update_error:rate_limited:(\d+)$/.exec(reason);
          retryNotBefore = reset ? Math.min(Date.now() + 24 * 60 * MINUTE, Number(reset[1]) * 1000) : 0;
          // Keep the last successful result, but never present a failed request as "up to date".
          set({ checkError: translateUpdateCheckError(reason) });
        } finally { set({ checking: false }); inFlight = null; }
      })();
      set({ checking: true, checkError: null });
      return inFlight;
    },
    openModal: () => set({ modalOpen: true, checkError: null }),
    closeModal: () => set({ modalOpen: false }),
    initAutoUpdateTimer: () => {
      let stopped = false, failures = 0;
      let unlisten: (() => void) | undefined;
      set({ noticeReady: false });
      // Subscribe before the snapshot, merging events so a late read cannot undo a dismissal.
      void (async () => {
        try {
          const stop = await onUpdateNoticeDismissed(version => { if (!stopped) mergeDismissals([version]); });
          if (stopped) { stop(); return; }
          unlisten = stop;
          const versions = await ipc.getDismissedUpdateNotices();
          if (!stopped) mergeDismissals(versions);
        } catch (error) { console.error('Update reminder session:', error); }
        finally { if (!stopped) set({ noticeReady: true }); }
      })();
      let timer: ReturnType<typeof setTimeout>;
      const schedule = (delay: number) => { clearTimeout(timer); timer = setTimeout(run, delay); };
      const run = async () => {
        if (stopped) return;
        if (navigator.onLine === false) { schedule(MAX_RETRY_INTERVAL); return; }
        await get().checkForUpdates(true);
        if (stopped) return;
        const failed = Boolean(get().checkError);
        failures = failed ? Math.min(failures + 1, 5) : 0;
        const delay = failed ? Math.min(MAX_RETRY_INTERVAL, REGULAR_INTERVAL * 2 ** (failures - 1)) : REGULAR_INTERVAL;
        schedule(Math.max(delay, retryNotBefore - Date.now()));
      };
      const online = () => {
        if (stopped || inFlight) return;
        if (!get().updateResult || get().checkError) schedule(Math.max(3000, retryNotBefore - Date.now()));
      };
      schedule(3000);
      window.addEventListener('online', online);
      return () => { stopped = true; clearTimeout(timer); unlisten?.(); window.removeEventListener('online', online); };
    },
  };
});
