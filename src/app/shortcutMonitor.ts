import { useEffect } from 'react';
import { useSettingsStore } from '../stores/settingsStore';
import { useShortcutDiagnosticsStore } from '../stores/shortcutDiagnosticsStore';
import { subscribeShortcuts } from '../core/shortcutBindings';
import { showToast } from '../stores/toastStore';

/** Probe on actual foreground entry, never continuously reserve system hotkeys. */
export function useShortcutMonitor(ready: boolean) {
  useEffect(() => {
    if (!ready) return;
    let stopped = false, lastCheck = 0;
    const announced = new Set<string>();
    const check = async (force = false) => {
      if (!useSettingsStore.getState().initialized || (!force && Date.now() - lastCheck < 30_000)) return;
      lastCheck = Date.now();
      await useShortcutDiagnosticsStore.getState().refresh();
      if (stopped) return;
      const newConflicts = Object.values(useShortcutDiagnosticsStore.getState().results)
        .filter(item => item.status === 'occupied' && !announced.has(item.binding));
      if (newConflicts.length) {
        newConflicts.forEach(item => announced.add(item.binding));
        const names = newConflicts.slice(0, 3).map(item => item.binding).join('、');
        showToast(`${names}${newConflicts.length > 3 ? ' 等' : ''} 已被其他程序占用，可在设置的“快捷键”中修改。`, 'warning');
      }
    };
    const timer = setTimeout(() => void check(true), 1800);
    const focus = () => void check();
    const unsubscribe = subscribeShortcuts(() => void check(true));
    window.addEventListener('focus', focus);
    return () => { stopped = true; clearTimeout(timer); unsubscribe(); window.removeEventListener('focus', focus); };
  }, [ready]);
}
