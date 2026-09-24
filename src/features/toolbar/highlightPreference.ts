import { useSyncExternalStore } from 'react';

export const HIGHLIGHT_COLORS = [
  { name: '柠檬黄', color: '#fef08a' }, { name: '清新绿', color: '#bbf7d0' },
  { name: '天空蓝', color: '#bfdbfe' }, { name: '浅紫', color: '#e9d5ff' },
  { name: '蜜桃粉', color: '#fbcfe8' }, { name: '暖阳橙', color: '#fed7aa' },
  { name: '珊瑚红', color: '#fecaca' }, { name: '湖水青', color: '#a5f3fc' },
] as const;
const storageKey = 'noteboard.highlight-color';
const listeners = new Set<() => void>();
let color = HIGHLIGHT_COLORS[0].color as string;
try { const saved = localStorage.getItem(storageKey); if (HIGHLIGHT_COLORS.some(item => item.color === saved)) color = saved!; } catch { /* session fallback */ }
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function rememberHighlightColor(next: string) {
  if (next === color) return;
  color = next; try { localStorage.setItem(storageKey, color); } catch { /* session fallback */ }
  listeners.forEach(listener => listener());
}
/** Tool preference is independent of document formatting and never writes to Markdown. */
export function useHighlightColor() { return useSyncExternalStore(subscribe, () => color); }
