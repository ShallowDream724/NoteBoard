import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Code, Eye } from 'lucide-react';
import { Tooltip } from './Tooltip';
import './documentModeToggle.css';

type ViewMode = 'visual' | 'source';
type ModeOption = { label: string; accessibleName: string; tooltip?: string; shortcut?: string };

interface DocumentModeToggleProps {
  viewMode: ViewMode;
  onToggle: (mode: ViewMode) => void;
  label: string;
  options: Record<ViewMode, ModeOption>;
  revealOnChange?: boolean;
  frameEdge?: boolean;
  disabled?: boolean;
}

const REVEAL_MS = 3000;

export function DocumentModeToggle({ viewMode, onToggle, label, options, revealOnChange, frameEdge, disabled }: DocumentModeToggleProps) {
  const hotZone = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const [nearby, setNearby] = useState(false);
  const [recentlyRevealed, setRecentlyRevealed] = useState(false);
  const clearReveal = useCallback(() => window.clearTimeout(timer.current), []);
  const reveal = useCallback(() => {
    clearReveal();
    setRecentlyRevealed(true);
    timer.current = window.setTimeout(() => setRecentlyRevealed(false), REVEAL_MS);
  }, [clearReveal]);

  useEffect(() => {
    if (!revealOnChange) return;
    reveal();
  }, [revealOnChange, viewMode, reveal]);
  useEffect(() => clearReveal, [clearReveal]);

  useEffect(() => {
    if (frameEdge) {
      setNearby(false);
      return;
    }
    let inside = false;
    const move = ({ clientX, clientY, pointerType }: PointerEvent) => {
      const rect = hotZone.current?.getBoundingClientRect();
      if (!rect || pointerType === 'touch') return;
      const next = rect.width > 0 && rect.height > 0
        && clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
      if (inside === next) return;
      inside = next;
      setNearby(inside);
    };
    const leave = () => { inside = false; setNearby(false); };
    document.addEventListener('pointermove', move, { passive: true });
    document.addEventListener('pointerleave', leave);
    window.addEventListener('blur', leave);
    return () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerleave', leave);
      window.removeEventListener('blur', leave);
    };
  }, [frameEdge]);

  return <>
    {frameEdge
      // An opaque iframe owns its pointer events. Listen at the outer edge so
      // the preview keeps receiving clicks while the capsule is hidden.
      ? <div aria-hidden="true" className="nb-document-mode-frame-edge" onPointerEnter={event => {
        if (event.pointerType !== 'touch') reveal();
      }} />
      : <div aria-hidden="true" className="nb-document-mode-hot-zone" ref={hotZone} />}
    <div className="nb-document-mode-toggle" data-revealed={nearby || recentlyRevealed || undefined} role="group" aria-label={label}>
      {(['visual', 'source'] as const).map(mode => {
        const option = options[mode];
        const Icon = mode === 'visual' ? Eye : Code;
        const title = option.shortcut ? `${option.accessibleName} (${option.shortcut})` : option.accessibleName;
        const button = <button type="button" aria-label={option.accessibleName} aria-pressed={viewMode === mode}
          title={option.tooltip ? undefined : title}
          disabled={disabled} onClick={() => { if (viewMode !== mode) onToggle(mode); }}
          onMouseDown={revealOnChange ? event => { if (event.button === 0) event.preventDefault(); } : undefined}>
          <Icon size={13} aria-hidden="true" />
          <span>{option.label}</span>
        </button>;
        return option.tooltip ? <Tooltip key={mode} content={option.tooltip} shortcut={option.shortcut} side="top">
          {button}
        </Tooltip> : <Fragment key={mode}>{button}</Fragment>;
      })}
    </div>
  </>;
}
