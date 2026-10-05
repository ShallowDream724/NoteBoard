import type { Editor } from '@tiptap/core';
import { Type, Table2, Image, Braces, Quote, List, CheckSquare, Copy, Scissors, Trash2, Plus, Rows3, Columns3, AlignLeft, AlignCenter, AlignRight, Grid2X2, GalleryHorizontalEnd, PanelTopClose, PanelTop, Minus, CircleHelp, EyeOff, MessageSquareText } from 'lucide-react';
import { OrderedListIcon as ListOrdered } from '../../components/OrderedListIcon';
import { BlockFormulaIcon } from '../../components/FormulaIcons';
import { blockRange, copyBlock, deleteBlock, formatBlock, insertAfterBlock } from './blockActions';
import { AlignmentMenu } from '../document-style/AlignmentMenu';
import { BlockColorControl } from '../document-style/BlockColorControl';
import { blockColors, setBlockColors } from '../document-style/blockAppearance';
import { supportsBlockColors } from '../document-style/blockAppearanceSchema';
import { Tooltip } from '../../components/Tooltip';
import { TableAppearanceMenu } from './TableAppearanceMenu';
import { TableFillMenu } from './TableFillMenu';
import { documentTableStyle } from './documentPresentation';
import { distributeTableColumns, distributeTableRows, selectTableScope, setSelectedTableHeader } from './tablePresentationCommands';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import { tableGrid } from './tableStructure';
import { runDiscreteEdit } from './discreteEdit';
import { showToast } from '../../stores/toastStore';
import { useFormattingUpdates } from './useFormattingUpdates';
import './blockContextMenu.css';
import { runWithDocumentCapability, useNativeFeatureVisibility } from '../document-format/featureGate';
import { NodeSelection } from '@tiptap/pm/state';
import { beginBlockAnnotation, canAnnotateBlock, openAnnotation } from './annotations/commands';
import { toggleConceal } from './rich-content/commands';
import { ImageCollectionMenu } from './rich-content/ImageCollectionMenu';
import { TableAlignmentMenu } from './TableAlignmentMenu';
import { canWrapBlockInCallout, wrapBlockInCallout } from './alertCommands';
import { editFigureCaption } from './figureCaptionCommands';
import { isEmptyParagraph } from './blockInteractionScope';
import { EmptyBlockInsertMenu } from './EmptyBlockInsertMenu';
import { RemoveFormatting } from 'lucide-react';
import { clearBlockFormatting, supportsBlockTextFormatting, hasCaptionTextFormatting, clearCaptionTextFormatting } from './textFormatting';
import { ArrowRightLeft, WrapText, Square, Check } from 'lucide-react';
import { documentFormulaReadingMode, setDocumentFormulaReadingMode, documentTableReadingMode, setDocumentTableReadingMode } from './documentReadingView';
import { preserveReadingAnchor } from '../../core/dom/readingAnchor';
import { HEADING_HELP_KEYS } from '../../components/contextualHelpKeys';

export function BlockTypeIcon({ type, level }: { type: string | null; level?: number }) {
  if (type === 'heading') return <span className="nb-block-heading-icon">H{level}</span>;
  const Icon = type === 'mathBlock' ? BlockFormulaIcon : type === 'taskItem' || type === 'taskList' ? CheckSquare : type === 'table' ? Table2 : type === 'image' ? Image : type === 'imageCollection' ? Grid2X2 : type === 'disclosure' ? PanelTopClose : type === 'githubAlert' ? PanelTop : type === 'horizontalRule' ? Minus : type === 'codeBlock' ? Braces : type === 'blockquote' ? Quote : Type;
  return <Icon size={15}/>;
}
export function BlockContextMenu({ editor, pos, close }: { editor: Editor; pos: number; close: () => void }) {
  const native = useNativeFeatureVisibility();
  useFormattingUpdates(editor);
  const range = blockRange(editor, pos); if (!range) return null;
  const colors = blockColors(range.node);
  if (isEmptyParagraph(range.node) && !colors.color && !colors.background) return <EmptyBlockInsertMenu editor={editor} pos={pos} close={close}/>;
  const type = range.node.type.name, text = ['paragraph','heading','blockquote','bulletList','orderedList','taskList','listItem','taskItem'].includes(type);
  const readingMode = type === 'mathBlock' ? documentFormulaReadingMode(editor.state) : documentTableReadingMode(editor.state);
  const readingOptions = type === 'mathBlock' ? [
    { mode: 'expand', label: '自然展开', Icon: ArrowRightLeft, helpKey: 'formula.reading.expand' },
    { mode: 'wrap', label: '自动换行', Icon: WrapText, helpKey: 'formula.reading.wrap' },
    { mode: 'scroll', label: '滚动块', Icon: Square, helpKey: 'formula.reading.scroll' },
  ] as const : [
    { mode: 'expand', label: '自然展开', Icon: ArrowRightLeft, helpKey: 'table.reading.expand' },
    { mode: 'scroll', label: '滚动块', Icon: Square, helpKey: 'table.reading.scroll' },
  ] as const;
  const styled = supportsBlockColors(type);
  const canWrapCallout = canWrapBlockInCallout(editor, pos);
  const showAnnotation = canAnnotateBlock(range.node) || !!range.node.attrs.annotationId;
  const selectNode = () => editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)));
  const grid = type === 'table' ? tableGrid(range.node) : null;
  const headerRow = grid?.cells.filter(cell => cell.row === 0), headerColumn = grid?.cells.filter(cell => cell.column === 0);
  const action = (run: () => unknown) => { run(); close(); };
  const readingAction = (run: () => unknown) => action(() => {
    const node = editor.view.nodeDOM(pos);
    const selector = type === 'table' ? '.tableWrapper' : '.math-node-preview';
    const viewport = node instanceof HTMLElement ? node.matches(selector) ? node : node.querySelector<HTMLElement>(selector) : null;
    preserveReadingAnchor(viewport, run);
  });
  const copy = (cut: boolean) => { if (!copyBlock(editor, pos, cut)) showToast('无法写入剪贴板，请用键盘快捷键重试', 'warning'); };
  const header = (axis: 'row' | 'column') => {
    const node = editor.state.doc.nodeAt(pos); if (node?.type.name !== 'table') return;
    const map = TableMap.get(node), start = pos + 1;
    editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc, start + map.map[0])));
    selectTableScope(editor, axis); setSelectedTableHeader(editor, axis);
  };
  return <div className="nb-block-context-menu" role="menu" aria-label="内容块操作" onPointerDown={event => event.preventDefault()}>
    {type === 'codeBlock' && <><Tooltip content="转为正文" helpKey="block.paragraph" shortcut="Ctrl+0" side="right"><button role="menuitem" type="button" onClick={() => action(() => formatBlock(editor, pos, chain => chain.setParagraph(), true))}><Type size={16}/>转为正文</button></Tooltip><hr/></>}
    {text && <div className="nb-block-format-grid">
      <Tooltip content="正文" helpKey="block.paragraph" shortcut="Ctrl+0" side="right"><button type="button" aria-label="正文" onClick={() => action(() => formatBlock(editor, pos, chain => chain.setParagraph(), true))}><Type size={17}/></button></Tooltip>
      {([1,2,3,4,5,6] as const).map(level => <Tooltip key={level} content={'标题 ' + level} helpKey={HEADING_HELP_KEYS[level]} shortcut={`Ctrl+${level}`} side="right"><button type="button" aria-label={'标题 ' + level}
        onClick={() => action(() => formatBlock(editor, pos, chain => chain.setHeading({ level }), true))}>H{level}</button></Tooltip>)}
      {([{ label:'无序列表', Icon:List, command:'toggleBulletList', shortcut: 'Ctrl+Shift+8', helpKey: 'list.bullet' }, { label:'有序列表', Icon:ListOrdered, command:'toggleOrderedList', shortcut: 'Ctrl+Shift+7', helpKey: 'list.ordered' },
        { label:'待办', Icon:CheckSquare, command:'toggleTaskList', shortcut: 'Ctrl+Shift+9', helpKey: 'list.task' }, { label:'代码块', Icon:Braces, command:'toggleCodeBlock', shortcut: 'Ctrl+Alt+C', helpKey: 'block.code' },
        { label:'引用', Icon:Quote, command:'toggleBlockquote', shortcut: undefined, helpKey: 'block.quote' }] as const).map(({ label, Icon, command, shortcut, helpKey }) =>
        <Tooltip key={command} content={label} shortcut={shortcut} helpKey={helpKey} side="right"><button type="button" aria-label={label} onClick={() => action(() => formatBlock(editor, pos, chain => chain[command]()))}><Icon size={17}/></button></Tooltip>)}
      {native && canWrapCallout && <Tooltip content="设为提示块" helpKey="block.callout.wrap" side="right"><button type="button" aria-label="设为提示块" onClick={() => action(() => wrapBlockInCallout(editor, pos))}><PanelTop size={17}/></button></Tooltip>}
    </div>}
    {native && type === 'image' && <div className="nb-block-style-row nb-block-position-row" role="group" aria-label="图片位置">
      <span>图片位置</span>
      {([{ value: 'left', label: '图片左对齐', Icon: AlignLeft }, { value: 'center', label: '图片居中', Icon: AlignCenter },
        { value: 'right', label: '图片右对齐', Icon: AlignRight }] as const).map(({ value, label, Icon }) =>
        <Tooltip key={value} content={label}><button type="button" aria-label={label} aria-pressed={(range.node.attrs.align || 'center') === value} onClick={() => action(() => runWithDocumentCapability(editor, 'imageLayout', next => runDiscreteEdit(next, chain => chain.updateAttributes('image', { align: value }))))}><Icon size={16}/></button></Tooltip>)}
    </div>}
    {native && type === 'table' && <TableAlignmentMenu editor={editor} pos={pos} value={range.node.attrs.tableAlign} close={close}/>}
    {native && (styled || type === 'table' || type === 'horizontalRule') && <div className="nb-block-style-row">
      <AlignmentMenu editor={editor}/>
      {styled && <BlockColorControl {...colors} onChange={patch => setBlockColors(editor, pos, patch)}/>}
      {type === 'table' && <><TableFillMenu editor={editor} disabled={documentTableStyle(editor.state.doc) === 'three-line'}/><TableAppearanceMenu editor={editor}/></>}
    </div>}
    {(type === 'table' || type === 'mathBlock') && <>
      <div className="nb-block-reading-label">{type === 'mathBlock' ? '阅读视图 · 全文公式' : '阅读视图 · 全文表格'}</div>
      {readingOptions.map(({ mode, label, Icon, helpKey }) =>
        <Tooltip key={mode} content={label} helpKey={helpKey} side="right"><button type="button" role="menuitemradio" aria-checked={readingMode === mode}
          onClick={() => readingAction(() => type === 'mathBlock' ? setDocumentFormulaReadingMode(editor, mode) : mode !== 'wrap' && setDocumentTableReadingMode(editor, mode))}><Icon size={16}/>{label}{readingMode === mode && <Check size={14} style={{ marginLeft:'auto' }}/>}</button></Tooltip>)}
      <hr/>
    </>}
    {(type === 'githubAlert' || supportsBlockTextFormatting(range.node)) && <button role="menuitem" type="button" onClick={() => action(() => clearBlockFormatting(editor, pos))}><RemoveFormatting size={16}/>{type === 'githubAlert' ? '取消提示块' : '清除文本格式'}</button>}
    {native && hasCaptionTextFormatting(range.node) && <button role="menuitem" type="button" onClick={() => action(() => clearCaptionTextFormatting(editor, pos))}><RemoveFormatting size={16}/>{type === 'table' ? '清除表注文字格式' : '清除图注文字格式'}</button>}
    {native && type === 'imageCollection' && <>
      <ImageCollectionMenu editor={editor} node={range.node} pos={pos}/>
      {([{ layout: 'grid', columns: 2, label: '两列拼图', Icon: Grid2X2, helpKey: 'image.collection.columns.2' }, { layout: 'grid', columns: 3, label: '三列拼图', Icon: Grid2X2, helpKey: 'image.collection.columns.3' }, { layout: 'carousel', columns: range.node.attrs.columns, label: '图片轮播', Icon: GalleryHorizontalEnd, helpKey: 'image.collection.layout.carousel' }] as const).map(({ layout, columns, label, Icon, helpKey }) =>
        <Tooltip key={label} content={label} helpKey={helpKey} side="right"><button role="menuitemradio" aria-checked={range.node.attrs.layout === layout && range.node.attrs.columns === columns} type="button" onClick={() => action(() => runDiscreteEdit(editor, chain => chain.updateAttributes('imageCollection', { layout, columns })))}><Icon size={16}/>{label}</button></Tooltip>)}
      <hr/>
    </>}
    {native && (type === 'table' || type === 'image') && <Tooltip content={`${range.node.attrs.caption ? '编辑' : '添加'}${type === 'table' ? '表注' : '图注'}`} helpKey={type === 'table' ? 'table.caption' : 'figure.caption'} side="right"><button role="menuitem" type="button" onClick={() => action(() => editFigureCaption(editor, pos))}><MessageSquareText size={16}/>{range.node.attrs.caption ? '编辑' : '添加'}{type === 'table' ? '表注' : '图注'}</button></Tooltip>}
    {native && showAnnotation && <Tooltip content={range.node.attrs.annotationId ? '编辑说明' : '添加说明'} helpKey="block.annotation" side="right"><button role="menuitem" type="button" onClick={() => action(() => { const id = range.node.attrs.annotationId; if (id) openAnnotation(editor, id, { edit: true }); else beginBlockAnnotation(editor, pos); })}>{range.node.attrs.annotationId ? <MessageSquareText size={16}/> : <CircleHelp size={16}/>} {range.node.attrs.annotationId ? '编辑说明' : '添加说明'}</button></Tooltip>}
    {native && Object.hasOwn(range.node.attrs, 'concealed') && <button role="menuitem" type="button" onClick={() => action(() => { selectNode(); toggleConceal(editor); })}><EyeOff size={16}/>{range.node.attrs.concealed ? '取消模糊' : '模糊内容'}</button>}
    {native && (showAnnotation || Object.hasOwn(range.node.attrs, 'concealed')) && <hr/>}
    <button role="menuitem" type="button" onClick={() => action(() => copy(true))}><Scissors size={16}/>剪切</button>
    <button role="menuitem" type="button" onClick={() => action(() => copy(false))}><Copy size={16}/>复制</button>
    <button role="menuitem" type="button" onClick={() => action(() => deleteBlock(editor, pos))}><Trash2 size={16}/>删除</button>
    {type === 'table' && <><hr/>
      <Tooltip content={headerRow?.every(cell => cell.node.type.name === 'tableHeader') ? '取消表头行' : '设置表头行'} helpKey={headerRow?.every(cell => cell.node.type.name === 'tableHeader') ? 'table.header.row.clear' : 'table.header.row'} disabled={headerRow?.some(cell => cell.node.attrs.rowspan > 1)} side="right"><button role="menuitem" type="button" disabled={headerRow?.some(cell => cell.node.attrs.rowspan > 1)} onClick={() => action(() => header('row'))}><Rows3 size={16}/>{headerRow?.every(cell => cell.node.type.name === 'tableHeader') ? '取消表头行' : '设置表头行'}</button></Tooltip>
      {native && <><Tooltip content={headerColumn?.every(cell => cell.node.type.name === 'tableHeader') ? '取消首列表头' : '设置首列表头'} helpKey={headerColumn?.every(cell => cell.node.type.name === 'tableHeader') ? 'table.header.column.clear' : 'table.header.column'} disabled={headerColumn?.some(cell => cell.node.attrs.colspan > 1)} side="right"><button role="menuitem" type="button" disabled={headerColumn?.some(cell => cell.node.attrs.colspan > 1)} onClick={() => action(() => header('column'))}><Columns3 size={16}/>{headerColumn?.every(cell => cell.node.type.name === 'tableHeader') ? '取消首列表头' : '设置首列表头'}</button></Tooltip>
      <button role="menuitem" type="button" onClick={() => action(() => distributeTableColumns(editor))}><Columns3 size={16}/>平均分布列宽</button>
      <button role="menuitem" type="button" onClick={() => action(() => distributeTableRows(editor))}><Rows3 size={16}/>平均分布行高</button></>}
    </>}
    <hr/><button role="menuitem" type="button" onClick={() => action(() => insertAfterBlock(editor, pos))}><Plus size={16}/>{['listItem','taskItem'].includes(type) ? '在下方插入列表项' : '在下方插入段落'}</button>
  </div>;
}
