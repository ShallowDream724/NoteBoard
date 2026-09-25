import type { Editor } from '@tiptap/core';
import { AlignLeft, AlignCenter, AlignRight } from 'lucide-react';
import { Tooltip } from '../../components/Tooltip';
import { tableAlignment } from './tableAlignment';
import { setTableAlignment } from './tableAlignmentCommands';
import './tableAlignmentMenu.css';

export function TableAlignmentMenu({ editor, pos, value, close }: { editor: Editor; pos: number; value: unknown; close: () => void }) {
  const current = tableAlignment(value) ?? 'left';
  return <div className="nb-block-style-row nb-table-alignment" role="group" aria-label="整表位置">
    <span>整表位置</span>
    {([{ value: 'left', label: '整张表格居左', Icon: AlignLeft }, { value: 'center', label: '整张表格居中', Icon: AlignCenter },
      { value: 'right', label: '整张表格居右', Icon: AlignRight }] as const).map(({ value, label, Icon }) =>
      <Tooltip key={value} content={label}><button type="button" aria-label={label} aria-pressed={current === value}
        onClick={() => { setTableAlignment(editor, pos, value); close(); }}><Icon size={16}/></button></Tooltip>)}
  </div>;
}
