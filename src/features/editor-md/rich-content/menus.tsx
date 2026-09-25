import { useState } from 'react';
import type { Editor } from '@tiptap/core';
import { Image, Grid2X2, GalleryHorizontalEnd, MoreHorizontal, EyeOff, CircleHelp, MessageSquareText, X } from 'lucide-react';
import { ToolbarButton, ToolbarDropdown, ToolbarDropdownItem } from '../../toolbar/ToolbarComponents';
import { editorDocumentFormat } from '../editorDocumentCodec';
import { imageCollectionTemplate, insertImageCollection, selectionConcealed, toggleConceal, type ImageTemplate } from './commands';
import { beginAnnotation, openAnnotation, removeAnnotation, selectedAnnotationId } from '../annotations/commands';

export const IMAGE_TEMPLATES: { template: ImageTemplate; label: string }[] = [
  { template: 4, label: '四宫格' }, { template: 6, label: '六宫格' }, { template: 9, label: '九宫格' }, { template: 'carousel', label: '图片轮播' },
];
export function ImageInsertItems({ editor, onLocal, onNetwork, onDone }: { editor: Editor | null; onLocal(): void; onNetwork(): void; onDone(): void }) {
  const native = editor && editorDocumentFormat(editor) === 'noteboard';
  return <>
    <ToolbarDropdownItem icon={<Image size={14}/>} label="插入图片" onClick={() => { onDone(); onLocal(); }}/>
    <ToolbarDropdownItem icon={<Image size={14}/>} label="从链接插入" onClick={() => { onDone(); onNetwork(); }}/>
    {native && <><div className="nb-rich-menu-divider"/>{IMAGE_TEMPLATES.map(({ template, label }) => <ToolbarDropdownItem key={template} icon={template === 'carousel' ? <GalleryHorizontalEnd size={14}/> : <Grid2X2 size={14}/>} label={label} onClick={() => { onDone(); insertImageCollection(editor, template); }}/>)}</>}
  </>;
}
export function ImageInsertMenu(props: Omit<Parameters<typeof ImageInsertItems>[0], 'onDone'> & { collapsePriority?: number }) {
  const [open, setOpen] = useState(false);
  return <ToolbarDropdown isOpen={open} onOpenChange={setOpen} trigger={<ToolbarButton icon={<Image size={15}/>} title="图片" hasDropdown/>}>
    <ImageInsertItems {...props} onDone={() => setOpen(false)}/>
  </ToolbarDropdown>;
}
export function RichSelectionMenu({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  if (editorDocumentFormat(editor) !== 'noteboard' || editor.state.selection.empty) return null;
  const id = selectedAnnotationId(editor), concealed = selectionConcealed(editor);
  const done = (run: () => void) => { setOpen(false); run(); };
  return <ToolbarDropdown isOpen={open} onOpenChange={setOpen} trigger={<ToolbarButton icon={<MoreHorizontal size={17}/>} title="更多文字操作" hasDropdown/>}>
    <ToolbarDropdownItem icon={id ? <MessageSquareText size={14}/> : <CircleHelp size={14}/>} label={id ? '编辑说明' : '添加说明'} onClick={() => done(() => { if (id) openAnnotation(editor, id, { edit: true }); else beginAnnotation(editor); })}/>
    {id && <ToolbarDropdownItem icon={<X size={14}/>} label="移除说明" onClick={() => done(() => { removeAnnotation(editor, id); })}/>}
    <div className="nb-rich-menu-divider"/>
    <ToolbarDropdownItem icon={<EyeOff size={14}/>} label={concealed ? '取消模糊' : '模糊内容'} active={concealed} onClick={() => done(() => { toggleConceal(editor); })}/>
  </ToolbarDropdown>;
}
// Public recipe data is shared with authoring examples, without UI-only IDs.
export { imageCollectionTemplate };
