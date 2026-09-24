import type { CSSProperties } from 'react';
import { Check, Monitor } from 'lucide-react';
import { THEMES, type ThemeMeta } from '../../core/theme/themes';

function Scene({ theme }: { theme: ThemeMeta }) {
  const style = {
    '--preview-bg': theme.preview[0], '--preview-accent': theme.preview[1],
    '--preview-ink': theme.scheme === 'dark' ? '#e2e8f0' : '#243247',
  } as CSSProperties;
  return <span className="theme-scene" style={style}>
    <span className="theme-sheet theme-sheet-shadow" />
    <span className="theme-sheet">
      <span className="theme-sheet-toolbar"><i /><i /><i /></span>
      <span className="theme-sheet-title">Aa<span /></span>
      <span className="theme-sheet-line" /><span className="theme-sheet-line" />
      <span className="theme-sheet-code"><i /><i /><i /></span>
    </span>
  </span>;
}

/** Uses registered theme colors; preview decoration has no app state or timers. */
export function ThemeCard({ theme, system, title, description, selected, onSelect }: {
  theme: ThemeMeta; system?: boolean; title: string; description: string; selected: boolean; onSelect: () => void;
}) {
  return <button type="button" className="theme-card" aria-pressed={selected} onClick={onSelect}>
    <span className={`theme-card-art${system ? ' theme-card-system' : ''}`} aria-hidden="true">
      {system ? <><Scene theme={THEMES['chen-guang']} /><Scene theme={THEMES['mo-ye']} /></> : <Scene theme={theme} />}
    </span>
    <span className="theme-card-caption"><span><span className="theme-card-title">{title}{system && <Monitor size={13} />}</span>
      <span className="theme-card-description">{description}</span></span>
      <span className="theme-card-check" aria-hidden="true">{selected && <Check size={13} strokeWidth={2.5} />}</span>
    </span>
  </button>;
}
