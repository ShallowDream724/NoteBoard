import * as Popover from '@radix-ui/react-popover';
import { useId, useRef } from 'react';
import { ChevronDown, Pilcrow, RemoveFormatting } from 'lucide-react';
import { useHoverMenu } from '../../components/useHoverMenu';
import { useResolvedShortcutLabel } from '../../core/useShortcutBindings';
import './textResetControl.css';

interface Props {
  open: boolean; onOpenChange: (open: boolean) => void;
  disabled: boolean; restoreDisabled: boolean;
  onClear: () => void; onRestore: () => void; onReturnToEditor: () => void;
  collapsePriority?: number; overflowId?: string;
}

/** Selection-preserving main action with an independently hoverable menu. */
export function TextResetControl({ open, onOpenChange, disabled, restoreDisabled, onClear, onRestore, onReturnToEditor }: Props) {
  const id = useId(), menu = useRef<HTMLDivElement>(null);
  const hover = useHoverMenu(open, onOpenChange, disabled);
  const shortcut = useResolvedShortcutLabel('Ctrl+0');
  const apply = (action: () => void) => { hover.change(false); action(); onReturnToEditor(); };
  const showKeyboardMenu = () => { hover.keyboard.current = true; hover.change(true); };
  return <div className="nb-text-reset-control" data-open={hover.expanded || undefined} onPointerEnter={hover.keepAlive} onPointerLeave={hover.leave}>
    <Popover.Root open={open} onOpenChange={hover.change} modal={false}>
      <Popover.Anchor asChild><div className="nb-text-reset-group">
        <button type="button" className="nb-text-reset-apply" disabled={disabled} aria-label="清除文字样式" title="清除文字样式（保留链接和列表）"
          onPointerEnter={hover.keepAlive} onPointerDown={event => event.preventDefault()}
          onClick={() => apply(onClear)} onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); showKeyboardMenu(); } }}><RemoveFormatting size={15}/></button>
        <button {...hover.triggerProps} type="button" className="nb-text-reset-expand" disabled={disabled} aria-label="清除与还原选项" title="清除与还原选项" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
          onKeyDown={event => { if (['ArrowDown', 'Enter', ' '].includes(event.key)) { event.preventDefault(); showKeyboardMenu(); } }}><ChevronDown size={12}/></button>
      </div></Popover.Anchor>
      <Popover.Portal><Popover.Content {...hover.contentProps} ref={menu} id={id} role="menu" aria-label="清除与还原" className="nb-text-reset-menu" align="start" sideOffset={6} collisionPadding={8}
        onOpenAutoFocus={event => { event.preventDefault(); if (hover.keyboard.current) menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus(); }}
        onCloseAutoFocus={event => event.preventDefault()} onEscapeKeyDown={onReturnToEditor} onFocusOutside={event => event.preventDefault()}>
        <button type="button" role="menuitem" aria-label="清除文字样式" aria-describedby={`${id}-clear`} onPointerDown={event => event.preventDefault()} onClick={() => apply(onClear)}>
          <RemoveFormatting size={16}/><span><span className="nb-text-reset-label">清除文字样式</span><span className="nb-text-reset-description" id={`${id}-clear`}>保留链接、列表和内容</span></span>
        </button>
        <button type="button" role="menuitem" aria-label="还原为正文" disabled={restoreDisabled} aria-describedby={`${id}-restore`} onPointerDown={event => event.preventDefault()} onClick={() => apply(onRestore)}>
          <Pilcrow size={16}/><span><span className="nb-text-reset-label">还原为正文</span><span className="nb-text-reset-description" id={`${id}-restore`}>取消标题、列表或引用，保留文字样式</span></span>{shortcut && <kbd title={shortcut}>{shortcut.split(' / ')[0]}</kbd>}
        </button>
      </Popover.Content></Popover.Portal>
    </Popover.Root>
  </div>;
}
