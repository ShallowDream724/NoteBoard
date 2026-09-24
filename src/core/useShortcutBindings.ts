import { useSyncExternalStore } from 'react';
import { subscribeShortcuts, shortcutRevision, shortcutLabel, commandForDefault, commandBindings } from './shortcutBindings';
export function useShortcutBindings() { return useSyncExternalStore(subscribeShortcuts, shortcutRevision); }
export function useShortcutLabel(id: string) { useShortcutBindings(); return shortcutLabel(id); }
/** Compatibility adapter for existing hints while commands are identified by ID. */
export function useResolvedShortcutLabel(defaultBinding?: string) {
  useShortcutBindings();
  const id = defaultBinding ? commandForDefault(defaultBinding) : undefined;
  return id ? commandBindings(id).length ? shortcutLabel(id) : undefined : defaultBinding;
}
