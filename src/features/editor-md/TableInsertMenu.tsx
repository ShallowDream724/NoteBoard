import { useState } from 'react';
import type { Editor } from '@tiptap/core';
import * as Popover from '@radix-ui/react-popover';
import { Plus, ChevronDown, Rows3, Columns3 } from 'lucide-react';
import { useHoverMenu } from '../../components/useHoverMenu';
import { runDiscreteEdit } from './discreteEdit';

export function TableInsertMenu({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false), hover = useHoverMenu(open, setOpen);
  const choices = [
    ['addRowBefore', '在上方插入行', Rows3], ['addRowAfter', '在下方插入行', Rows3],
    ['addColumnBefore', '向左插入列', Columns3], ['addColumnAfter', '向右插入列', Columns3],
  ] as const;
  return <Popover.Root open={open} onOpenChange={hover.change}>
    <Popover.Trigger {...hover.triggerProps} className="nb-table-style-trigger" aria-label="插入行列"><Plus size={16}/><ChevronDown className="nb-menu-chevron" size={11}/></Popover.Trigger>
    <Popover.Portal><Popover.Content {...hover.contentProps} className="nb-alignment-menu" sideOffset={6} collisionPadding={8}
      onOpenAutoFocus={hover.onOpenAutoFocus} onCloseAutoFocus={hover.onCloseAutoFocus}>
      {choices.map(([command, label, Icon]) => <button key={command} type="button" onClick={() => {
        runDiscreteEdit(editor, chain => chain[command]()); setOpen(false); editor.view.focus();
      }}><Icon size={16}/><span>{label}</span></button>)}
    </Popover.Content></Popover.Portal>
  </Popover.Root>;
}
