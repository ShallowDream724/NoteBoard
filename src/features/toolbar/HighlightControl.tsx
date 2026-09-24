import * as Popover from '@radix-ui/react-popover';
import { useEffect, useId, useRef, type CSSProperties } from 'react';
import { Check, ChevronDown, Eraser, Highlighter } from 'lucide-react';
import { HIGHLIGHT_COLORS, rememberHighlightColor, useHighlightColor } from './highlightPreference';
import './highlightControl.css';

interface Props {
  active: boolean; currentColor?: string; open: boolean; onOpenChange: (open: boolean) => void;
  onApply: (color: string) => void; onRemove: () => void; collapsePriority?: number;
  onReturnToEditor: () => void;
}

/** Hover is only a preview: it must not move the editor's caret or keyboard focus. */
export function HighlightControl({ active, currentColor, open, onOpenChange, onApply, onRemove, onReturnToEditor }: Props) {
  const lastColor = useHighlightColor();
  const menuId = useId();
  const menu = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const keyboardOpen = useRef(false);
  const cancel = () => { clearTimeout(timer.current); timer.current = undefined; };
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!open) { clearTimeout(timer.current); keyboardOpen.current = false; }
  }, [open]);
  const enter = () => {
    cancel();
    if (!open) timer.current = setTimeout(() => { keyboardOpen.current = false; onOpenChange(true); }, 240);
  };
  const leave = () => {
    cancel();
    if (!keyboardOpen.current) timer.current = setTimeout(() => onOpenChange(false), 160);
  };
  const apply = (color: string) => { rememberHighlightColor(color); onApply(color); onOpenChange(false); };
  const toggle = () => { cancel(); if (active) { onRemove(); onOpenChange(false); } else apply(lastColor); };
  return <div className="nb-highlight-control" onPointerEnter={event => { if (event.pointerType !== 'touch') enter(); }} onPointerLeave={leave}>
    <Popover.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <Popover.Anchor asChild>
        <button type="button" className="nb-highlight-apply" aria-label={active ? '取消高亮' : '应用高亮'} aria-pressed={active}
          aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} data-state={open ? 'open' : 'closed'}
          aria-description="点击应用或取消高亮，停留或按向下键选择颜色"
          onPointerDown={event => event.preventDefault()} onMouseDown={event => event.preventDefault()} onClick={toggle}
          onKeyDown={event => {
            cancel();
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(); }
            if (event.key === 'ArrowDown') { event.preventDefault(); keyboardOpen.current = true; onOpenChange(true); }
          }}>
          <Highlighter size={17} className="nb-highlight-icon" style={{ '--highlight-nib': active && currentColor ? currentColor : lastColor } as CSSProperties}/>
          <ChevronDown size={10}/>
        </button>
      </Popover.Anchor>
      <Popover.Portal><Popover.Content ref={menu} id={menuId} role="menu" aria-label="高亮颜色" className="nb-highlight-menu" align="start" sideOffset={6} collisionPadding={8}
        onPointerEnter={() => { cancel(); keyboardOpen.current = false; }} onPointerLeave={leave}
        onOpenAutoFocus={event => { event.preventDefault(); if (keyboardOpen.current) menu.current?.querySelector<HTMLButtonElement>('[aria-checked=true],button')?.focus(); }}
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
        <div className="nb-highlight-title">高亮颜色</div>
        {HIGHLIGHT_COLORS.map(item => <button type="button" role="menuitemradio" aria-checked={active ? currentColor === item.color : lastColor === item.color} key={item.color} className="nb-highlight-color" onClick={() => apply(item.color)}>
          <span className="nb-highlight-swatch" style={{ backgroundColor: item.color }} />
          <span>{item.name}</span>{(active ? currentColor === item.color : lastColor === item.color) && <Check size={14}/>}
        </button>)}
        <div role="separator" className="nb-highlight-separator"/>
        <button type="button" role="menuitem" className="nb-highlight-color" onClick={() => { onRemove(); onOpenChange(false); }}><Eraser size={16}/><span>取消高亮</span></button>
      </Popover.Content></Popover.Portal>
    </Popover.Root>
  </div>;
}
