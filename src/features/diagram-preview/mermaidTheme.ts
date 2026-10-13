import { useSyncExternalStore } from 'react';
import type { MermaidConfig } from 'mermaid';

export type MermaidTheme = 'default' | 'dark' | 'forest' | 'chen-guang' | 'hu-po' | 'mo-ye';
const listeners = new Set<() => void>();
let observer: MutationObserver | undefined;
export function currentDiagramTheme(): MermaidTheme {
  const value = typeof document === 'undefined' ? '' : document.documentElement.dataset.theme;
  return value === 'mo-ye' || value === 'hu-po' || value === 'chen-guang' ? value : value === 'dark' ? 'mo-ye' : 'chen-guang';
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!observer) {
    observer = new MutationObserver(() => listeners.forEach(notify => notify()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }
  return () => { listeners.delete(listener); if (!listeners.size) { observer?.disconnect(); observer = undefined; } };
}
/** One observer for all mounted diagrams, including the standalone preview. */
export function useDiagramTheme() { return useSyncExternalStore(subscribe, currentDiagramTheme, () => 'chen-guang' as const); }

export function mermaidThemeConfig(theme: MermaidTheme): Pick<MermaidConfig, 'theme' | 'themeVariables'> {
  // Export explicitly requests "default" and stays independent of screen theme.
  if (theme === 'default' || theme === 'forest') return { theme };
  if (theme === 'mo-ye' || theme === 'dark') return { theme: 'base', themeVariables: {
    darkMode: true, background: '#0f172a', primaryColor: '#25364c', secondaryColor: '#24413c', tertiaryColor: '#38314a',
    primaryTextColor: '#c6cfdd', secondaryTextColor: '#c6cfdd', tertiaryTextColor: '#c6cfdd', textColor: '#c6cfdd',
    primaryBorderColor: '#8097b6', secondaryBorderColor: '#739e91', tertiaryBorderColor: '#9b8eb6',
    lineColor: '#a4b3c9', defaultLinkColor: '#a4b3c9', edgeLabelBackground: '#1e293b',
    clusterBkg: '#182337', clusterBorder: '#60758f', actorBkg: '#25364c', actorBorder: '#8097b6', actorTextColor: '#c6cfdd',
    signalColor: '#a4b3c9', signalTextColor: '#c6cfdd', labelBoxBkgColor: '#1e293b', labelTextColor: '#c6cfdd',
  } };
  if (theme === 'hu-po') return { theme: 'base', themeVariables: {
    background: '#faf9f5', primaryColor: '#eee9de', secondaryColor: '#e9eddf', tertiaryColor: '#eee5e1',
    primaryTextColor: '#45433c', secondaryTextColor: '#45433c', tertiaryTextColor: '#45433c', textColor: '#45433c',
    primaryBorderColor: '#8c8475', secondaryBorderColor: '#858c74', tertiaryBorderColor: '#9b8278',
    lineColor: '#716d62', defaultLinkColor: '#716d62', edgeLabelBackground: '#faf9f5',
    clusterBkg: '#f3f0e8', clusterBorder: '#a39a8a', actorBkg: '#eee9de', actorBorder: '#8c8475', actorTextColor: '#45433c',
    signalColor: '#716d62', signalTextColor: '#45433c', labelBoxBkgColor: '#faf9f5', labelTextColor: '#45433c',
  } };
  return { theme: 'default' };
}
