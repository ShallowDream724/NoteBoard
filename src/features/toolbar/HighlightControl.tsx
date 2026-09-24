import * as Popover from '@radix-ui/react-popover';
import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { rememberTextStyle, useTextStylePreference, type TextStylePair } from '../document-style/stylePreference';
import { ColorSwatches } from '../document-style/ColorSwatches';
import './highlightControl.css';

interface Props {
  active: boolean; currentColor?: string; open: boolean; onOpenChange: (open: boolean) => void;
  onApply: (color: string) => void; onRemove: () => void; collapsePriority?: number;
  onReturnToEditor: () => void;
  textColor?: string | null; onTextColor?: (color: string | null) => void;
  onApplyStyle?: (pair: TextStylePair) => void;
}

/** Hover is only a preview: it must not move the editor's caret or keyboard focus. */
export function HighlightControl({ active, currentColor, open, onOpenChange, onApply, onRemove, onReturnToEditor, textColor, onTextColor, onApplyStyle }: Props) {
  const lastStyle = useTextStylePreference();
  const menuId = useId();
  const menu = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const keyboardOpen = useRef(false);
  const [arming, setArming] = useState(false);
  const cancel = () => { clearTimeout(timer.current); timer.current = undefined; };
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!open) { clearTimeout(timer.current); keyboardOpen.current = false; setArming(false); }
  }, [open]);
  const enter = () => {
    cancel();
    if (!open) timer.current = setTimeout(() => {
      keyboardOpen.current = false; setArming(true);
      timer.current = setTimeout(() => onOpenChange(true), 90);
    }, 180);
  };
  const leave = () => {
    cancel();
    if (!open) setArming(false);
    if (!keyboardOpen.current) timer.current = setTimeout(() => onOpenChange(false), 160);
  };
  const apply = (color: string | null) => { rememberTextStyle({ background: color }); if (color) onApply(color); else onRemove(); onOpenChange(false); };
  const applyPair = (pair: TextStylePair) => {
    if (onApplyStyle) onApplyStyle(pair);
    else { if (pair.background) onApply(pair.background); else onRemove(); onTextColor?.(pair.color); }
    cancel(); onOpenChange(false);
  };
  return <div className="nb-highlight-control" data-open={open || arming || undefined} onPointerLeave={leave}>
    <Popover.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <Popover.Anchor asChild><div className="nb-text-style-group">
        <button type="button" className="nb-highlight-apply" aria-label="应用文字颜色与高亮" aria-pressed={active || !!textColor}
          aria-description="应用上次的文字颜色和高亮"
          onPointerDown={event => event.preventDefault()} onMouseDown={event => event.preventDefault()} onClick={() => applyPair(lastStyle)}
          onKeyDown={event => {
            cancel();
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); applyPair(lastStyle); }
            if (event.key === 'ArrowDown') { event.preventDefault(); keyboardOpen.current = true; onOpenChange(true); }
          }}>
          <span aria-hidden="true" className="nb-text-style-preview" style={{ color: lastStyle.color ?? 'var(--editor-text)', backgroundColor: lastStyle.background ?? 'transparent' }}>A</span>
        </button>
        <button type="button" className="nb-text-style-expand" aria-label="选择文字颜色与高亮" aria-haspopup="dialog" aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          onPointerEnter={event => { if (event.pointerType !== 'touch') enter(); }}
          onPointerLeave={() => { if (!open) { cancel(); setArming(false); } }}
          onPointerDown={event => event.preventDefault()}
          onClick={() => { cancel(); setArming(false); keyboardOpen.current = false; onOpenChange(!open); }}
          onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); cancel(); keyboardOpen.current = true; onOpenChange(true); } }}><ChevronDown size={12}/></button>
      </div></Popover.Anchor>
      <Popover.Portal><Popover.Content ref={menu} id={menuId} role="dialog" aria-label="文字颜色与高亮" className="nb-highlight-menu" align="start" sideOffset={6} collisionPadding={8}
        onPointerEnter={() => { cancel(); keyboardOpen.current = false; }} onPointerLeave={leave}
        onOpenAutoFocus={event => { event.preventDefault(); if (keyboardOpen.current) menu.current?.querySelector<HTMLButtonElement>('[aria-pressed=true],button')?.focus(); }}
        onKeyDown={event => {
          cancel(); keyboardOpen.current = true;
          if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('button') ?? []);
          const index = items.indexOf(document.activeElement as HTMLButtonElement);
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
          items[next]?.focus();
        }}
        onEscapeKeyDown={onReturnToEditor}
        onCloseAutoFocus={event => event.preventDefault()}>
        {onTextColor && <><div className="nb-highlight-title">文字颜色</div>
          <ColorSwatches kind="text" label="文字颜色" value={textColor} onChange={color => { rememberTextStyle({ color }); onTextColor(color); onOpenChange(false); }}/></>}
        <div className="nb-highlight-title">高亮</div>
        <ColorSwatches kind="background" label="高亮颜色" value={active ? currentColor : null}
          onChange={apply}/>
        <button type="button" className="nb-color-reset" onClick={() => { const pair = { color: null, background: null }; rememberTextStyle(pair); applyPair(pair); }}>重置</button>
      </Popover.Content></Popover.Portal>
    </Popover.Root>
  </div>;
}
