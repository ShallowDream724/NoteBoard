import { useSyncExternalStore } from 'react';
import { documentColor } from './colors';
export interface TextStylePair { color: string | null; background: string | null }
const key = 'noteboard.text-style', listeners = new Set<() => void>();
let pair: TextStylePair = { color: null, background: '#fef08a' };
try {
  const saved = localStorage.getItem(key);
  if (saved) { const value = JSON.parse(saved); pair = { color: documentColor(value.color), background: documentColor(value.background) }; }
  else pair.background = documentColor(localStorage.getItem('noteboard.highlight-color')) ?? pair.background;
} catch { /* Session preference remains available without storage. */ }
export function rememberTextStyle(change: Partial<TextStylePair>) {
  const next = { color: change.color === undefined ? pair.color : documentColor(change.color), background: change.background === undefined ? pair.background : documentColor(change.background) };
  if (next.color === pair.color && next.background === pair.background) return;
  pair = next; try { localStorage.setItem(key, JSON.stringify(pair)); } catch { /* Session fallback. */ }
  listeners.forEach(listener => listener());
}
export function subscribeTextStyle(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function lastTextStyle() { return pair; }
export function useTextStylePreference() { return useSyncExternalStore(subscribeTextStyle, lastTextStyle); }
