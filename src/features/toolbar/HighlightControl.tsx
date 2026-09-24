import * as Menu from '@radix-ui/react-dropdown-menu';
import { Check, ChevronDown, Eraser } from 'lucide-react';
import { Tooltip } from '../../components/Tooltip';
import { HIGHLIGHT_COLORS, rememberHighlightColor, useHighlightColor } from './highlightPreference';
import './highlightControl.css';

interface Props {
  active: boolean; currentColor?: string; open: boolean; onOpenChange: (open: boolean) => void;
  onApply: (color: string) => void; onRemove: () => void; collapsePriority?: number;
  onReturnToEditor: () => void;
}

/** One split control shared by the fixed toolbar and selection bubble. */
export function HighlightControl({ active, currentColor, open, onOpenChange, onApply, onRemove, onReturnToEditor }: Props) {
  const lastColor = useHighlightColor();
  const apply = (color: string) => { rememberHighlightColor(color); onApply(color); onOpenChange(false); };
  return <div className="nb-highlight-control">
    <Tooltip content={active ? '取消高亮' : '应用高亮'}>
      <button type="button" className="nb-highlight-apply" aria-label={active ? '取消高亮' : '应用高亮'} aria-pressed={active}
        onMouseDown={event => event.preventDefault()} onClick={() => active ? onRemove() : apply(lastColor)}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m9 11 7-7 5 5-7 7z"/><path d="m5 15 4-4 5 5-4 4H5z" fill={active && currentColor ? currentColor : lastColor}/><path d="m5 19-2 2h7"/>
        </svg>
      </button>
    </Tooltip>
    <Menu.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <Tooltip content="高亮颜色"><Menu.Trigger asChild>
        <button type="button" className="nb-highlight-trigger" aria-label="高亮颜色" onMouseDown={event => event.preventDefault()}><ChevronDown size={11}/></button>
      </Menu.Trigger></Tooltip>
      <Menu.Portal><Menu.Content className="nb-highlight-menu" align="start" sideOffset={6} collisionPadding={8}
        onEscapeKeyDown={onReturnToEditor}
        onCloseAutoFocus={event => event.preventDefault()}>
        <Menu.Label className="nb-highlight-title">高亮颜色</Menu.Label>
        {HIGHLIGHT_COLORS.map(item => <Menu.Item key={item.color} className="nb-highlight-color" onSelect={() => apply(item.color)}>
          <span className="nb-highlight-swatch" style={{ backgroundColor: item.color }} />
          <span>{item.name}</span>{(active ? currentColor === item.color : lastColor === item.color) && <Check size={14}/>}
        </Menu.Item>)}
        <Menu.Separator className="nb-highlight-separator"/>
        <Menu.Item className="nb-highlight-color" onSelect={onRemove}><Eraser size={16}/><span>取消高亮</span></Menu.Item>
      </Menu.Content></Menu.Portal>
    </Menu.Root>
  </div>;
}
