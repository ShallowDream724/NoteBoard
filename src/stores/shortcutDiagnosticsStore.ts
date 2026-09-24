import { create } from 'zustand';
import { isTauri } from '@tauri-apps/api/core';
import { probeShortcuts, type ShortcutProbe } from '../core/ipc/commands';
import { SHORTCUTS } from '../core/shortcutCatalog';
import { commandBindings } from '../core/shortcutBindings';

interface Diagnostics { checking: boolean; results: Record<string, ShortcutProbe>; error: string | null; refresh: () => Promise<void> }
let sequence = 0;
export async function checkShortcutSystem(bindings: string[]) {
  return isTauri() ? probeShortcuts([...new Set(bindings)]) : bindings.map(binding => ({ binding, status: 'unknown' as const, errorCode: null }));
}
export const useShortcutDiagnosticsStore = create<Diagnostics>(set => ({
  checking: false, results: {}, error: null,
  refresh: async () => {
    const current = ++sequence;
    set({ checking: true, error: null });
    try {
      const result = await checkShortcutSystem(SHORTCUTS.flatMap(command => [...commandBindings(command.id)]));
      if (current === sequence) set({ checking: false, results: Object.fromEntries(result.map(item => [item.binding, item])) });
    } catch (error) {
      if (current === sequence) set({ checking: false, results: {}, error: String(error) });
    }
  },
}));
