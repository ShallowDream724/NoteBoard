import type { Editor } from '@tiptap/core';
import { Type, Table2, Image, Braces, Quote, List, ListOrdered, ListTodo, Copy, Scissors, Trash2, Plus, Rows3, Columns3, AlignLeft, AlignCenter, AlignRight } from 'lucide-react';
import { blockRange, copyBlock, deleteBlock, formatBlock, insertAfterBlock } from './blockActions';
import { AlignmentMenu } from '../document-style/AlignmentMenu';
import { HighlightControl } from '../toolbar/HighlightControl';
import { applyTextStyle, setTextColor } from '../document-style/documentStyles';
import { useState } from 'react';
import { TableAppearanceMenu } from './TableAppearanceMenu';
import { TableFillMenu } from './TableFillMenu';
import { documentTableStyle } from './documentPresentation';
import { distributeTableColumns, distributeTableRows, selectTableScope, setSelectedTableHeader } from './tablePresentationCommands';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import { tableGrid } from './tableStructure';
import { runDiscreteEdit } from './discreteEdit';
import { showToast } from '../../stores/toastStore';
import './blockContextMenu.css';

export function BlockTypeIcon({ type, level }: { type: string | null; level?: number }) {
  if (type === 'heading') return <span className="nb-block-heading-icon">H{level}</span>;
  const Icon = type === 'table' ? Table2 : type === 'image' ? Image : type === 'codeBlock' ? Braces : type === 'blockquote' ? Quote : Type;
  return <Icon size={15}/>;
}
export function BlockContextMenu({ editor, pos, close }: { editor: Editor; pos: number; close: () => void }) {
  const [colorsOpen, setColorsOpen] = useState(false);
  const range = blockRange(editor, pos); if (!range) return null;
  const type = range.node.type.name, text = ['paragraph','heading','blockquote','bulletList','orderedList','taskList','codeBlock'].includes(type);
  const grid = type === 'table' ? tableGrid(range.node) : null;
  const headerRow = grid?.cells.filter(cell => cell.row === 0), headerColumn = grid?.cells.filter(cell => cell.column === 0);
  const action = (run: () => unknown) => { run(); close(); };
  const copy = (cut: boolean) => { if (!copyBlock(editor, pos, cut)) showToast('无法写入剪贴板，请用键盘快捷键重试', 'warning'); };
  const header = (axis: 'row' | 'column') => {
    const node = editor.state.doc.nodeAt(pos); if (node?.type.name !== 'table') return;
    const map = TableMap.get(node), start = pos + 1;
    editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc, start + map.map[0])));
    selectTableScope(editor, axis); setSelectedTableHeader(editor, axis);
  };
  return <div className="nb-block-context-menu" role="menu" aria-label="内容块操作" onPointerDown={event => event.preventDefault()}>
    {text && <div className="nb-block-format-grid">
      <button type="button" aria-label="正文" onClick={() => action(() => formatBlock(editor, pos, chain => chain.setParagraph(), true))}><Type size={17}/></button>
      {([1,2,3,4,5,6] as const).map(level => <button key={level} type="button" aria-label={'标题 ' + level}
        onClick={() => action(() => formatBlock(editor, pos, chain => chain.setHeading({ level }), true))}>H{level}</button>)}
      {([{ label:'无序列表', Icon:List, command:'toggleBulletList' }, { label:'有序列表', Icon:ListOrdered, command:'toggleOrderedList' },
        { label:'任务列表', Icon:ListTodo, command:'toggleTaskList' }, { label:'代码块', Icon:Braces, command:'toggleCodeBlock' },
        { label:'引用', Icon:Quote, command:'toggleBlockquote' }] as const).map(({ label, Icon, command }) =>
        <button type="button" key={command} aria-label={label} onClick={() => action(() => formatBlock(editor, pos, chain => chain[command]()))}><Icon size={17}/></button>)}
    </div>}
    {type === 'image' && <div className="nb-block-style-row">
      {([{ value: 'left', label: '图片左对齐', Icon: AlignLeft }, { value: 'center', label: '图片居中', Icon: AlignCenter },
        { value: 'right', label: '图片右对齐', Icon: AlignRight }] as const).map(({ value, label, Icon }) =>
        <button type="button" key={value} aria-label={label} onClick={() => action(() => runDiscreteEdit(editor, chain => chain.updateAttributes('image', { align: value })))}><Icon size={16}/></button>)}
    </div>}
    {(text || type === 'table') && <div className="nb-block-style-row">
      <AlignmentMenu editor={editor} cells={type === 'table'}/>
      {text && <HighlightControl open={colorsOpen} onOpenChange={setColorsOpen} active={editor.isActive('highlight')}
        currentColor={editor.getAttributes('highlight').color} textColor={editor.getAttributes('textColor').color}
        onApplyStyle={pair => applyTextStyle(editor, pair)} onTextColor={color => setTextColor(editor, color)}
        onApply={color => editor.chain().setHighlight({ color }).run()} onRemove={() => editor.chain().unsetHighlight().run()}
        onReturnToEditor={() => editor.view.focus()}/>}
      {type === 'table' && <><TableFillMenu editor={editor} disabled={documentTableStyle(editor.state.doc) === 'three-line'}/><TableAppearanceMenu editor={editor}/></>}
    </div>}
    <button role="menuitem" type="button" onClick={() => action(() => copy(true))}><Scissors size={16}/>剪切</button>
    <button role="menuitem" type="button" onClick={() => action(() => copy(false))}><Copy size={16}/>复制</button>
    <button role="menuitem" type="button" onClick={() => action(() => deleteBlock(editor, pos))}><Trash2 size={16}/>删除</button>
    {type === 'table' && <><hr/>
      <button role="menuitem" type="button" disabled={headerRow?.some(cell => cell.node.attrs.rowspan > 1)} onClick={() => action(() => header('row'))}><Rows3 size={16}/>{headerRow?.every(cell => cell.node.type.name === 'tableHeader') ? '取消表头行' : '设置表头行'}</button>
      <button role="menuitem" type="button" disabled={headerColumn?.some(cell => cell.node.attrs.colspan > 1)} onClick={() => action(() => header('column'))}><Columns3 size={16}/>{headerColumn?.every(cell => cell.node.type.name === 'tableHeader') ? '取消首列表头' : '设置首列表头'}</button>
      <button role="menuitem" type="button" onClick={() => action(() => distributeTableColumns(editor))}><Columns3 size={16}/>平均分布列宽</button>
      <button role="menuitem" type="button" onClick={() => action(() => distributeTableRows(editor))}><Rows3 size={16}/>平均分布行高</button>
    </>}
    <hr/><button role="menuitem" type="button" onClick={() => action(() => insertAfterBlock(editor, pos))}><Plus size={16}/>在下方插入段落</button>
  </div>;
}
