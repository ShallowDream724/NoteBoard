import type { Editor } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import { AlignLeft, AlignCenter, AlignRight } from 'lucide-react';
import { Tooltip } from '../../../components/Tooltip';
import { dispatchDiscreteEdit } from '../discreteEdit';
import { COLLECTION_WIDTHS } from './collectionPresentation';

export function ImageCollectionMenu({ editor, node, pos }: { editor: Editor; node: Node; pos: number }) {
  const apply = (attrs: { width?: string; align?: string }) => {
    const current = editor.state.doc.nodeAt(pos);
    if (current?.type.name !== 'imageCollection' || Object.entries(attrs).every(([key, value]) => current.attrs[key] === value)) return;
    dispatchDiscreteEdit(editor.view, editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, ...attrs }));
  };
  return <>
    <div className="nb-block-format-grid nb-collection-widths" role="group" aria-label="整组图片宽度">
      {COLLECTION_WIDTHS.map(width => <Tooltip key={width} content={`整组宽度 ${width}`}><button type="button" aria-label={`整组宽度 ${width}`} aria-pressed={node.attrs.width === width} onClick={() => apply({ width })}>{width}</button></Tooltip>)}
    </div>
    {node.attrs.layout === 'grid' && <div className="nb-block-style-row" role="group" aria-label="图片组合对齐">
      {([{ align:'left', label:'图片组合居左', Icon:AlignLeft },{ align:'center', label:'图片组合居中', Icon:AlignCenter },{ align:'right', label:'图片组合居右', Icon:AlignRight }] as const).map(({align,label,Icon}) =>
        <Tooltip key={align} content={label}><button type="button" aria-label={label} aria-pressed={node.attrs.align === align} onClick={() => apply({align})}><Icon size={16}/></button></Tooltip>)}
    </div>}
  </>;
}
