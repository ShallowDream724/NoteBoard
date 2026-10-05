import { useState } from 'react';
import type { Editor } from '@tiptap/core';
import * as Popover from '@radix-ui/react-popover';
import { AlignLeft, AlignCenter, AlignRight, ArrowUpToLine, ArrowDownToLine, AlignVerticalJustifyCenter, IndentIncrease, IndentDecrease, ChevronDown, Check } from 'lucide-react';
import { setParagraphPresentation } from './documentStyles';
import { alignTableSelection } from '../editor-md/tablePresentationCommands';
import './alignmentMenu.css';
import { useHoverMenu, HoverMenuContext } from '../../components/useHoverMenu';
import { useNativeFeatureVisibility } from '../document-format/featureGate';
import { commonPresentationValue, selectionPresentation } from './selectionPresentation';
import { Tooltip } from '../../components/Tooltip';

export function AlignmentMenu({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const hover = useHoverMenu(open, setOpen);
  const visible = useNativeFeatureVisibility();
  const scope = selectionPresentation(editor.state), cells = scope.cells;
  const targets = cells ? scope.cellBlocks : [...scope.textBlocks, ...scope.mathBlocks];
  const textAlign = commonPresentationValue(targets, cells ? 'align' : 'textAlign', targets.every(({ node }) => node.type.name === 'mathBlock') ? 'center' : 'left');
  const verticalAlign = commonPresentationValue(scope.cellBlocks, 'verticalAlign', 'top');
  const canIndent = !cells && scope.indentBlocks.length > 0;
  const label = cells ? '单元格对齐' : scope.mathBlocks.length && !scope.textBlocks.length ? '公式对齐' : targets.length ? '对齐与缩进' : '缩进';
  const horizontal = [ ['left','左对齐',AlignLeft], ['center','居中',AlignCenter], ['right','右对齐',AlignRight] ] as const;
  const vertical = [ ['top','顶部对齐',ArrowUpToLine], ['middle','垂直居中',AlignVerticalJustifyCenter], ['bottom','底部对齐',ArrowDownToLine] ] as const;
  const apply = (action: () => void) => { action(); setOpen(false); };
  if (!visible || !targets.length && !canIndent) return null;
  return <Popover.Root open={open} onOpenChange={hover.change}>
    <Popover.Trigger {...hover.triggerProps} className="nb-alignment-trigger" title={label} aria-label={label}>{targets.length ? <AlignLeft size={17}/> : <IndentIncrease size={17}/>}<ChevronDown className="nb-menu-chevron" size={10}/></Popover.Trigger>
    <Popover.Portal><Popover.Content className="nb-alignment-menu" sideOffset={6} collisionPadding={8}
      {...hover.contentProps} onMouseDown={event => event.preventDefault()} onOpenAutoFocus={hover.onOpenAutoFocus} onCloseAutoFocus={hover.onCloseAutoFocus}>
      <HoverMenuContext.Provider value={hover}>
      {targets.length > 0 && horizontal.map(([value,label,Icon]) => <Tooltip key={value} content={label} helpKey={cells ? `table.cell.horizontal.${value}` : undefined} side="right" disabled={!cells}><button type="button" onClick={() => apply(() => {
        setParagraphPresentation(editor, { textAlign: value });
      })}><Icon size={16}/><span>{label}</span>{textAlign === value && <Check size={14}/>}</button></Tooltip>)}
      {targets.length > 0 && <hr/>}
      {cells ? vertical.map(([value,label,Icon]) => <Tooltip key={value} content={label} helpKey={`table.cell.vertical.${value}`} side="right"><button type="button" onClick={() => apply(() => { alignTableSelection(editor, { verticalAlign: value }); })}>
        <Icon size={16}/><span>{label}</span>{verticalAlign === value && <Check size={14}/>}</button></Tooltip>) : canIndent && <>
        <button type="button" title="减少缩进" disabled={scope.indentBlocks.every(({ node }) => !node.attrs.indent)} onClick={() => apply(() => { setParagraphPresentation(editor, { indentBy: -1 }); })}><IndentDecrease size={16}/><span>减少缩进</span></button>
        <button type="button" title="增加缩进" disabled={scope.indentBlocks.every(({ node }) => node.attrs.indent >= 8)} onClick={() => apply(() => { setParagraphPresentation(editor, { indentBy: 1 }); })}><IndentIncrease size={16}/><span>增加缩进</span></button>
      </>}
      </HoverMenuContext.Provider>
    </Popover.Content></Popover.Portal>
  </Popover.Root>;
}
