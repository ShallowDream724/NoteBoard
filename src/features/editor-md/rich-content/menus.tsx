import { useState } from 'react';
import type { Editor } from '@tiptap/core';
import { Image, Grid2X2, GalleryHorizontalEnd, MoreHorizontal, EyeOff, CircleHelp, MessageSquareText, X } from 'lucide-react';
import { ToolbarButton, ToolbarDropdown, ToolbarDropdownItem } from '../../toolbar/ToolbarComponents';
import { useNativeFeatureVisibility } from '../../document-format/featureGate';
import { imageCollectionTemplate, insertImageCollection, selectionConcealed, toggleConceal, type ImageTemplate } from './commands';
import { beginAnnotation, openAnnotation, removeAnnotation, selectedAnnotationId } from '../annotations/commands';

export const IMAGE_TEMPLATES: { template: ImageTemplate; label: string }[] = [
  { template: 4, label: '四宫格' }, { template: 6, label: '六宫格' }, { template: 9, label: '九宫格' }, { template: 'carousel', label: '图片轮播' },
];
export function ImageInsertItems({ editor, onLocal, onNetwork, onDone }: { editor: Editor | null; onLocal(): void; onNetwork(): void; onDone(): void }) {
  const visible = useNativeFeatureVisibility();
  return <>
    <ToolbarDropdownItem icon={<Image size={14}/>} label="插入图片" onClick={() => { onDone(); onLocal(); }}/>
    <ToolbarDropdownItem icon={<Image size={14}/>} label="从链接插入" onClick={() => { onDone(); onNetwork(); }}/>
    {visible && editor && <div className="nb-rich-menu-divider"/>}
    {visible && editor && IMAGE_TEMPLATES.map(({ template, label }) => <ToolbarDropdownItem key={template} icon={template === 'carousel' ? <GalleryHorizontalEnd size={14}/> : <Grid2X2 size={14}/>} label={label} onClick={() => { onDone(); insertImageCollection(editor, template); }}/>) }
  </>;
}
export function ImageInsertMenu(props: Omit<Parameters<typeof ImageInsertItems>[0], 'onDone'> & { collapsePriority?: number; overflowId?: string }) {
  const [open, setOpen] = useState(false);
  return <ToolbarDropdown isOpen={open} onOpenChange={setOpen} trigger={<ToolbarButton icon={<Image size={15}/>} label="图片" compactLabel title="图片" hasDropdown/>}>
    <ImageInsertItems {...props} onDone={() => setOpen(false)}/>
  </ToolbarDropdown>;
}
export function AnnotationButton({ editor }: { editor: Editor; collapsePriority?: number }) {
  const visible = useNativeFeatureVisibility();
  if (!visible || editor.state.selection.empty) return null;
  const id = selectedAnnotationId(editor);
  return <ToolbarButton icon={id ? <MessageSquareText size={16}/> : <CircleHelp size={16}/>}
    label="说明" compactLabel title={id ? '编辑说明' : '添加说明'} active={!!id}
    onClick={() => { if (id) openAnnotation(editor, id, { edit: true }); else beginAnnotation(editor); }}/>
}
export function RichSelectionMenu({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const visible = useNativeFeatureVisibility();
  if (!visible || editor.state.selection.empty) return null;
  const id = selectedAnnotationId(editor), concealed = selectionConcealed(editor);
  const done = (run: () => void) => { setOpen(false); run(); };
  return <ToolbarDropdown isOpen={open} onOpenChange={setOpen} trigger={<ToolbarButton icon={<MoreHorizontal size={17}/>} title="更多文字操作" hasDropdown/>}>
    {id && <ToolbarDropdownItem icon={<X size={14}/>} label="移除说明" onClick={() => done(() => { removeAnnotation(editor, id); })}/>}
    {id && <div className="nb-rich-menu-divider"/>}
    <ToolbarDropdownItem icon={<EyeOff size={14}/>} label={concealed ? '取消模糊' : '模糊内容'} active={concealed} onClick={() => done(() => { toggleConceal(editor); })}/>
  </ToolbarDropdown>;
}
// Public recipe data is shared with authoring examples, without UI-only IDs.
export { imageCollectionTemplate };
