import type { Editor, JSONContent } from '@tiptap/core';
import type { KeyboardEvent, ReactNode } from 'react';
import { BarChart3, Braces, GalleryHorizontalEnd, Grid2X2, Image, Link2, List, ListTodo, Minus, PanelTop, PanelTopClose, Quote, Sigma, Table2, Type, Workflow } from 'lucide-react';
import { OrderedListIcon } from '../../components/OrderedListIcon';
import { useNativeFeatureVisibility } from '../document-format/featureGate';
import type { DocumentCapabilityId } from '../document-format/capabilities';
import { insertAtEmptyParagraph } from './emptyBlockInsertion';
import { insertEmptyParagraphImage, insertEmptyParagraphLink } from './emptyBlockDialogs';
import { diagramContent, mathContent } from './insertContentRecipes';
import { IMAGE_TEMPLATES, imageCollectionTemplate } from './rich-content/commands';

const paragraph = (): JSONContent => ({ type: 'paragraph' });
function tableContent(size: number): JSONContent {
  return { type: 'table', content: Array.from({ length: size }, (_, row) => ({ type: 'tableRow',
    content: Array.from({ length: size }, () => ({ type: row === 0 ? 'tableHeader' : 'tableCell', content: [paragraph()] })),
  })) };
}
function navigateMenu(event: KeyboardEvent<HTMLDivElement>) {
  if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)'));
  const current = items.indexOf(document.activeElement as HTMLButtonElement);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
    : (current + (event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 1) + items.length) % items.length;
  event.preventDefault(); items[next]?.focus();
}

/** A short, grouped insertion surface anchored to one empty paragraph. */
export function EmptyBlockInsertMenu({ editor, pos, close }: { editor: Editor; pos: number; close(): void }) {
  const native = useNativeFeatureVisibility();
  const action = (run: () => unknown) => { close(); run(); };
  const insert = (content: JSONContent, capability?: DocumentCapabilityId) => action(() => insertAtEmptyParagraph(editor, pos, content, capability));
  const item = (label: string, icon: ReactNode, run: () => unknown) => <button key={label} type="button" role="menuitem" onClick={() => action(run)}>{icon}<span>{label}</span></button>;
  const block = (label: string, icon: ReactNode, content: JSONContent, capability?: DocumentCapabilityId) => item(label, icon, () => insertAtEmptyParagraph(editor, pos, content, capability));
  return <div className="nb-block-context-menu nb-empty-block-menu" role="menu" aria-label="插入内容" onKeyDown={navigateMenu} onPointerDown={event => event.preventDefault()}>
    <div className="nb-empty-block-group" role="group" aria-label="文字与列表">
      <div className="nb-empty-block-label">文字与列表</div>
      <div className="nb-empty-block-headings">
        <button type="button" role="menuitem" aria-label="正文" title="正文" onClick={() => insert(paragraph())}><Type size={16}/></button>
        {([1, 2, 3, 4, 5, 6] as const).map(level => <button key={level} type="button" role="menuitem" aria-label={'标题 ' + level} title={'标题 ' + level} onClick={() => insert({ type: 'heading', attrs: { level } })}>H{level}</button>)}
      </div>
      <div className="nb-empty-block-grid">
        {block('无序列表', <List size={16}/>, { type: 'bulletList', content: [{ type: 'listItem', content: [paragraph()] }] })}
        {block('有序列表', <OrderedListIcon size={16}/>, { type: 'orderedList', content: [{ type: 'listItem', content: [paragraph()] }] })}
        {block('待办', <ListTodo size={16}/>, { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [paragraph()] }] })}
        {item('超链接', <Link2 size={16}/>, () => insertEmptyParagraphLink(editor, pos))}
      </div>
    </div>
    <div className="nb-empty-block-group" role="group" aria-label="内容块">
      <div className="nb-empty-block-label">内容块</div>
      <div className="nb-empty-block-grid">
        {block('代码块', <Braces size={16}/>, { type: 'codeBlock' })}
        {block('引用', <Quote size={16}/>, { type: 'blockquote', content: [paragraph()] })}
        {block('提示块', <PanelTop size={16}/>, { type: 'githubAlert', attrs: native ? { title: '' } : { kind: 'note' }, content: [paragraph()] }, native ? 'callout' : undefined)}
        {native && block('折叠块', <PanelTopClose size={16}/>, { type: 'disclosure', content: [paragraph()] }, 'disclosure')}
        {block('分割线', <Minus size={16}/>, { type: 'horizontalRule' })}
      </div>
      <div className="nb-empty-block-table" role="group" aria-label="表格尺寸"><span><Table2 size={16}/>表格</span>{[2, 3, 4].map(size =>
        <button key={size} type="button" role="menuitem" aria-label={`插入 ${size} × ${size} 表格`} onClick={() => insert(tableContent(size))}>{size} × {size}</button>)}</div>
    </div>
    <div className="nb-empty-block-group" role="group" aria-label="图片">
      <div className="nb-empty-block-label">图片</div>
      <div className="nb-empty-block-grid">
        {item('本地图片', <Image size={16}/>, () => insertEmptyParagraphImage(editor, pos, 'local'))}
        {item('图片链接', <Link2 size={16}/>, () => insertEmptyParagraphImage(editor, pos, 'url'))}
        {native && IMAGE_TEMPLATES.map(({ template, label }) => block(label, template === 'carousel' ? <GalleryHorizontalEnd size={16}/> : <Grid2X2 size={16}/>, imageCollectionTemplate(template), 'gallery'))}
      </div>
    </div>
    <div className="nb-empty-block-group" role="group" aria-label="公式与图表">
      <div className="nb-empty-block-label">公式与图表</div>
      <div className="nb-empty-block-grid">
        {block('行内公式', <Sigma size={16}/>, { type: 'paragraph', content: [mathContent('inline')] })}
        {block('公式块', <Sigma size={16}/>, mathContent('block'))}
        {block('Mermaid', <Workflow size={16}/>, diagramContent('mermaid'))}
        {block('信息图', <BarChart3 size={16}/>, diagramContent('infographic'))}
      </div>
    </div>
  </div>;
}
