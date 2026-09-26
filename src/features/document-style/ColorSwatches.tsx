import { BACKGROUND_COLORS, TEXT_COLORS } from './colors';
import './colorSwatches.css';

/** A shared compact palette for text and cells; scope and commands belong to the caller. */
export function ColorSwatches({ kind, value, onChange, label }: {
  kind: 'text' | 'background' | 'border'; value?: string | null;
  onChange: (color: string | null) => void; label: string;
}) {
  const colors = kind === 'background' ? BACKGROUND_COLORS : TEXT_COLORS;
  return <div className="nb-color-swatches" role="group" aria-label={label}
    onKeyDown={event => {
      const step = ({ ArrowRight: 1, ArrowLeft: -1, ArrowDown: 8, ArrowUp: -8 } as Record<string, number>)[event.key];
      if (!step) return;
      event.preventDefault(); event.stopPropagation();
      const items = Array.from(event.currentTarget.querySelectorAll('button'));
      const current = items.indexOf(event.target as HTMLButtonElement);
      items[(current + step + items.length) % items.length]?.focus();
    }}>
    {colors.map(item => <button type="button" key={item.color ?? 'default'} className="nb-color-swatch"
      aria-label={kind === 'border' && item.color === null ? '默认边框颜色' : item.name} title={kind === 'border' && item.color === null ? '默认边框颜色' : item.name} aria-pressed={(value ?? null) === item.color}
      data-kind={kind} data-clear={kind === 'background' && item.color === null || undefined}
      style={kind === 'text' ? { color: item.color ?? 'var(--editor-text)' } : { backgroundColor: item.color ?? (kind === 'border' ? 'var(--editor-border)' : 'var(--editor-bg)') }}
      onPointerDown={event => event.preventDefault()} onClick={() => onChange(item.color)}>
      {kind === 'text' ? <span aria-hidden="true">A</span> : null}
    </button>)}
  </div>;
}
