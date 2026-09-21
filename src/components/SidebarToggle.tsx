import { PanelLeft, PanelRight } from 'lucide-react';
import { Tooltip } from './Tooltip';
import './SidebarToggle.css';

interface SidebarToggleProps {
  side: 'left' | 'right';
  visible: boolean;
  onToggle: () => void;
}

/** Layout control only: shares no state with the document or its undo history. */
export function SidebarToggle({ side, visible, onToggle }: SidebarToggleProps) {
  const left = side === 'left';
  const label = (visible ? '收起' : '展开') + (left ? '左侧栏' : '右侧栏');
  const Icon = left ? PanelLeft : PanelRight;
  return (
    <Tooltip content={label} shortcut={left ? 'Ctrl+Shift+B' : 'Ctrl+Alt+B'} side="bottom" sideOffset={6}>
      <button
        type="button"
        className="nb-sidebar-toggle"
        aria-label={label}
        aria-expanded={visible}
        aria-keyshortcuts={left ? 'Control+Shift+B' : 'Control+Alt+B'}
        data-open={visible}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onToggle}
      >
        <Icon size={17} strokeWidth={1.7} aria-hidden="true" />
      </button>
    </Tooltip>
  );
}
