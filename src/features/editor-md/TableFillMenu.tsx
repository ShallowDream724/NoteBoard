import { useState } from 'react';
import type { Editor } from '@tiptap/core';
import * as Popover from '@radix-ui/react-popover';
import { PaintBucket, ChevronDown } from 'lucide-react';
import { ColorSwatches } from '../document-style/ColorSwatches';
import { fillTableSelection, type TableFillScope } from './tablePresentationCommands';
import { useHoverMenu } from '../../components/useHoverMenu';
import { useNativeFeatureVisibility } from '../document-format/featureGate';

export function TableFillMenu({ editor, disabled }: { editor: Editor; disabled: boolean }) {
  const visible = useNativeFeatureVisibility();
  const [open, setOpen] = useState(false), [scope, setScope] = useState<TableFillScope>('cells');
  const hover = useHoverMenu(open, setOpen, disabled);
  const fill = (color: string | null) => { fillTableSelection(editor, scope, color); setOpen(false); };
  if (!visible) return null;
  return <Popover.Root open={open && !disabled} onOpenChange={hover.change}>
    <Popover.Trigger {...hover.triggerProps} className="nb-table-style-trigger" disabled={disabled} aria-label={disabled ? '三线表不使用底色' : '表格底色'}
      title={disabled ? '三线表不使用底色' : '表格底色'}><PaintBucket size={16}/><ChevronDown className="nb-menu-chevron" size={11}/></Popover.Trigger>
    <Popover.Portal><Popover.Content className="nb-table-fill-menu" sideOffset={8} collisionPadding={10}
      {...hover.contentProps} onOpenAutoFocus={hover.onOpenAutoFocus} onCloseAutoFocus={hover.onCloseAutoFocus}>
      <div className="nb-table-fill-heading">表格底色</div>
      <div className="nb-table-fill-scopes" role="group" aria-label="填色范围">
        {([{ value: 'cells', label: '选中格' }, { value: 'row', label: '整行' }, { value: 'column', label: '整列' }] as const).map(item =>
          <button type="button" title={item.label} key={item.value} aria-pressed={scope === item.value} onClick={() => setScope(item.value)}>{item.label}</button>)}
      </div>
      <ColorSwatches kind="background" label="底色" value={editor.getAttributes('tableCell').background} onChange={fill}/>
      <button type="button" title="重置底色" className="nb-color-reset" onClick={() => fill(null)}>重置</button>
      <p>填色保留表头原有样式</p>
    </Popover.Content></Popover.Portal>
  </Popover.Root>;
}
