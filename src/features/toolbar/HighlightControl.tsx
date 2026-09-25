import * as Popover from '@radix-ui/react-popover';
import { useId, useRef } from 'react';
import { ChevronDown } from 'lucide-react';
import { rememberTextStyle, useTextStylePreference, type TextStylePair } from '../document-style/stylePreference';
import { ColorSwatches } from '../document-style/ColorSwatches';
import './highlightControl.css';
import { useHoverMenu } from '../../components/useHoverMenu';
import { useNativeFeatureVisibility } from '../document-format/featureGate';

interface Props {
  active: boolean; currentColor?: string; open: boolean; onOpenChange: (open: boolean) => void;
  onApply: (color: string) => void; onRemove: () => void; collapsePriority?: number;
  onReturnToEditor: () => void;
  textColor?: string | null; onTextColor?: (color: string | null) => void;
  onApplyStyle?: (pair: TextStylePair) => void;
}

/** Hover is only a preview: it must not move the editor's caret or keyboard focus. */
export function HighlightControl({ active, currentColor, open, onOpenChange, onApply, onRemove, onReturnToEditor, textColor, onTextColor, onApplyStyle }: Props) {
  const visible = useNativeFeatureVisibility();
  const lastStyle = useTextStylePreference();
  const menuId = useId();
  const menu = useRef<HTMLDivElement>(null);
  const hover = useHoverMenu(open, onOpenChange);
  const { cancel, leave, keyboard: keyboardOpen } = hover;
  const apply = (color: string | null) => { rememberTextStyle({ background: color }); if (color) onApply(color); else onRemove(); };
  const applyPair = (pair: TextStylePair) => {
    if (onApplyStyle) onApplyStyle(pair);
    else { if (pair.background) onApply(pair.background); else onRemove(); onTextColor?.(pair.color); }
    cancel();
  };
  if (!visible) return null;
  return <div className="nb-highlight-control" data-open={hover.expanded || undefined} onPointerEnter={hover.keepAlive} onPointerLeave={leave}>
    <Popover.Root open={open} onOpenChange={hover.change} modal={false}>
      <Popover.Anchor asChild><div className="nb-text-style-group">
        <button type="button" className="nb-highlight-apply" title="应用文字颜色与高亮" aria-label="应用文字颜色与高亮" aria-pressed={active || !!textColor}
          aria-description="应用上次的文字颜色和高亮"
          onPointerEnter={hover.keepAlive}
          onPointerDown={event => event.preventDefault()} onMouseDown={event => event.preventDefault()} onClick={() => applyPair(lastStyle)}
          onKeyDown={event => {
            cancel();
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); applyPair(lastStyle); }
            if (event.key === 'ArrowDown') { event.preventDefault(); keyboardOpen.current = true; onOpenChange(true); }
          }}>
          <span aria-hidden="true" className="nb-text-style-preview" style={{ color: lastStyle.color ?? 'var(--editor-text)', backgroundColor: lastStyle.background ?? 'transparent' }}>A</span>
        </button>
        <button {...hover.triggerProps} type="button" className="nb-text-style-expand" title="选择文字颜色与高亮" aria-label="选择文字颜色与高亮" aria-haspopup="dialog" aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          onPointerDown={event => event.preventDefault()}
          onClick={() => { hover.change(true); }}
          onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); cancel(); keyboardOpen.current = true; onOpenChange(true); } }}><ChevronDown size={12}/></button>
      </div></Popover.Anchor>
      <Popover.Portal><Popover.Content {...hover.contentProps} ref={menu} id={menuId} role="dialog" aria-label="文字颜色与高亮" className="nb-highlight-menu" align="start" sideOffset={6} collisionPadding={8}
        onPointerEnter={() => { hover.keepAlive(); keyboardOpen.current = false; }} onPointerLeave={leave}
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
        onFocusOutside={event => event.preventDefault()}
        onCloseAutoFocus={event => event.preventDefault()}>
        {onTextColor && <><div className="nb-highlight-title">文字颜色</div>
          <ColorSwatches kind="text" label="文字颜色" value={textColor} onChange={color => { rememberTextStyle({ color }); onTextColor(color); }}/></>}
        <div className="nb-highlight-title">高亮</div>
        <ColorSwatches kind="background" label="高亮颜色" value={active ? currentColor : null}
          onChange={apply}/>
        <button type="button" title="重置文字颜色与高亮" className="nb-color-reset" onClick={() => { const pair = { color: null, background: null }; rememberTextStyle(pair); applyPair(pair); }}>重置</button>
      </Popover.Content></Popover.Portal>
    </Popover.Root>
  </div>;
}
