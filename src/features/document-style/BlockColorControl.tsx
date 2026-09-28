import * as Popover from '@radix-ui/react-popover';
import { ChevronDown, Palette } from 'lucide-react';
import { useState } from 'react';
import { ColorSwatches } from './ColorSwatches';
import { useHoverMenu } from '../../components/useHoverMenu';
import '../toolbar/highlightControl.css';

export function BlockColorControl({ color, background, onChange }: {
  color: string | null; background: string | null;
  onChange(patch: { color?: string | null; background?: string | null }): void;
}) {
  const [open, setOpen] = useState(false), hover = useHoverMenu(open, setOpen);
  return <Popover.Root open={open} onOpenChange={hover.change} modal={false}>
    <Popover.Trigger {...hover.triggerProps} className="nb-table-style-trigger" aria-label="整块颜色" title="整块颜色"><Palette size={17}/><ChevronDown className="nb-menu-chevron" size={11}/></Popover.Trigger>
    <Popover.Portal><Popover.Content {...hover.contentProps} className="nb-highlight-menu" aria-label="整块颜色" role="dialog" sideOffset={6} collisionPadding={8} align="start" onOpenAutoFocus={hover.onOpenAutoFocus} onCloseAutoFocus={hover.onCloseAutoFocus}>
      <div className="nb-highlight-title">文字颜色</div><ColorSwatches kind="text" label="整块文字颜色" value={color} onChange={color => onChange({ color })}/>
      <div className="nb-highlight-title">整块底色</div><ColorSwatches kind="background" label="整块底色" value={background} onChange={background => onChange({ background })}/>
      <button type="button" className="nb-color-reset" onClick={() => onChange({ color: null, background: null })}>重置整块颜色</button>
    </Popover.Content></Popover.Portal>
  </Popover.Root>;
}
