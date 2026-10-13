import type { Editor } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import { AlignLeft, AlignCenter, AlignRight, Minus, Plus } from 'lucide-react';
import { imageGridColumns, IMAGE_GRID_MAX_CELLS, IMAGE_GRID_MAX_COLUMNS } from '../../../core/document/imageGrid';
import { resizeImageGrid } from './gridEditing';
import { Tooltip } from '../../../components/Tooltip';
import { dispatchDiscreteEdit } from '../discreteEdit';
import { COLLECTION_WIDTHS } from './collectionPresentation';
import '../blockPositionRow.css';

export function ImageCollectionMenu({ editor, node, pos }: { editor: Editor; node: Node; pos: number }) {
  const columns = imageGridColumns(node.attrs.columns), rows = Math.ceil(node.childCount / columns);
  const apply = (attrs: { width?: string; align?: string }) => {
    const current = editor.state.doc.nodeAt(pos);
    if (current?.type.name !== 'imageCollection' || Object.entries(attrs).every(([key, value]) => current.attrs[key] === value)) return;
    dispatchDiscreteEdit(editor.view, editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, ...attrs }));
  };
  return <>
    {node.attrs.layout === 'grid' && <div className="nb-grid-dimensions" role="group" aria-label="宫格行列">
      <span>列数</span>
      <Tooltip content="删除最右一列，可撤销">
        <button type="button" aria-label="删除最右一列" disabled={columns <= 1}
          onClick={() => resizeImageGrid(editor, pos, columns - 1, rows)}><Minus size={14}/></button>
      </Tooltip>
      <output>{columns}</output>
      <Tooltip content="在右侧加一列">
        <button type="button" aria-label="在右侧加一列"
          disabled={columns >= IMAGE_GRID_MAX_COLUMNS || (columns + 1) * rows > IMAGE_GRID_MAX_CELLS}
          onClick={() => resizeImageGrid(editor, pos, columns + 1, rows)}><Plus size={14}/></button>
      </Tooltip>
      <span>行数</span>
      <Tooltip content="删除最下一行，可撤销">
        <button type="button" aria-label="删除最下一行" disabled={rows <= 1}
          onClick={() => resizeImageGrid(editor, pos, columns, rows - 1)}><Minus size={14}/></button>
      </Tooltip>
      <output>{rows}</output>
      <Tooltip content="在下方加一行">
        <button type="button" aria-label="在下方加一行" disabled={columns * (rows + 1) > IMAGE_GRID_MAX_CELLS}
          onClick={() => resizeImageGrid(editor, pos, columns, rows + 1)}><Plus size={14}/></button>
      </Tooltip>
    </div>}
    <div className="nb-block-format-grid nb-collection-widths" role="group" aria-label="整组图片宽度">
      {COLLECTION_WIDTHS.map(width => <Tooltip key={width} content={`整组宽度 ${width}`}><button type="button" aria-label={`整组宽度 ${width}`} aria-pressed={node.attrs.width === width} onClick={() => apply({ width })}>{width}</button></Tooltip>)}
    </div>
    {node.attrs.layout === 'grid' && <div className="nb-block-style-row nb-block-position-row" role="group" aria-label="图片组合对齐">
      <span>整组位置</span>
      {([{ align:'left', label:'图片组合居左', Icon:AlignLeft },{ align:'center', label:'图片组合居中', Icon:AlignCenter },{ align:'right', label:'图片组合居右', Icon:AlignRight }] as const).map(({align,label,Icon}) =>
        <Tooltip key={align} content={label}><button type="button" aria-label={label} aria-pressed={node.attrs.align === align} onClick={() => apply({align})}><Icon size={16}/></button></Tooltip>)}
    </div>}
  </>;
}
