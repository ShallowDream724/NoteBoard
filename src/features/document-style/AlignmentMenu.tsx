import { useState } from 'react';
import type { Editor } from '@tiptap/core';
import * as Popover from '@radix-ui/react-popover';
import { AlignLeft, AlignCenter, AlignRight, ArrowUpToLine, ArrowDownToLine, AlignVerticalJustifyCenter, IndentIncrease, IndentDecrease, ChevronDown, Check } from 'lucide-react';
import { setParagraphPresentation } from './documentStyles';
import { alignTableSelection } from '../editor-md/tablePresentationCommands';
import './alignmentMenu.css';

export function AlignmentMenu({ editor, cells = false }: { editor: Editor; cells?: boolean }) {
  const [open, setOpen] = useState(false);
  const attrs = cells ? { ...editor.getAttributes('tableCell'), ...editor.getAttributes('tableHeader') }
    : { ...editor.getAttributes('paragraph'), ...editor.getAttributes('heading') };
  const horizontal = [ ['left','左对齐',AlignLeft], ['center','居中',AlignCenter], ['right','右对齐',AlignRight] ] as const;
  const vertical = [ ['top','顶部对齐',ArrowUpToLine], ['middle','垂直居中',AlignVerticalJustifyCenter], ['bottom','底部对齐',ArrowDownToLine] ] as const;
  const apply = (action: () => void) => { action(); setOpen(false); };
  return <Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Trigger className="nb-alignment-trigger" aria-label={cells ? '单元格对齐' : '对齐与缩进'}><AlignLeft size={17}/><ChevronDown size={10}/></Popover.Trigger>
    <Popover.Portal><Popover.Content className="nb-alignment-menu" sideOffset={6} collisionPadding={8}
      onCloseAutoFocus={event => { event.preventDefault(); editor.view.focus(); }}>
      {horizontal.map(([value,label,Icon]) => <button type="button" key={value} onClick={() => apply(() => {
        if (cells) alignTableSelection(editor, { textAlign: value }); else setParagraphPresentation(editor, { textAlign: value });
      })}><Icon size={16}/><span>{label}</span>{(attrs.textAlign ?? attrs.align ?? 'left') === value && <Check size={14}/>}</button>)}
      <hr/>
      {cells ? vertical.map(([value,label,Icon]) => <button type="button" key={value} onClick={() => apply(() => { alignTableSelection(editor, { verticalAlign: value }); })}>
        <Icon size={16}/><span>{label}</span>{(attrs.verticalAlign ?? 'top') === value && <Check size={14}/>}</button>) : <>
        <button type="button" onClick={() => apply(() => { setParagraphPresentation(editor, { indentBy: -1 }); })}><IndentDecrease size={16}/><span>减少缩进</span></button>
        <button type="button" onClick={() => apply(() => { setParagraphPresentation(editor, { indentBy: 1 }); })}><IndentIncrease size={16}/><span>增加缩进</span></button>
      </>}
    </Popover.Content></Popover.Portal>
  </Popover.Root>;
}
