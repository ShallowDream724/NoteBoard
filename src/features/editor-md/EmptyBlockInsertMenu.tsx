import type { Editor, JSONContent } from '@tiptap/core';
import type { KeyboardEvent, ReactNode } from 'react';
import { BarChart3, Braces, GalleryHorizontalEnd, Grid2X2, Image, Link2, List, CheckSquare, Minus, PanelTop, PanelTopClose, Quote, Table2, Type, Workflow } from 'lucide-react';
import { InlineFormulaIcon, BlockFormulaIcon } from '../../components/FormulaIcons';
import { OrderedListIcon } from '../../components/OrderedListIcon';
import { useNativeFeatureVisibility } from '../document-format/featureGate';
import type { DocumentCapabilityId } from '../document-format/capabilities';
import { insertAtEmptyParagraph } from './emptyBlockInsertion';
import { insertEmptyParagraphImage, insertEmptyParagraphLink } from './emptyBlockDialogs';
import { calloutContent, diagramContent, mathContent } from './insertContentRecipes';
import { IMAGE_TEMPLATES, imageCollectionTemplate } from './rich-content/commands';
import { Tooltip } from '../../components/Tooltip';
import type { ContextualHelpKey } from '../../components/contextualHelp';

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
  type Help = { helpKey?: ContextualHelpKey; shortcut?: string };
  const item = (label: string, icon: ReactNode, run: () => unknown, help: Help = {}) => <Tooltip key={label} content={label} {...help} side="right" disabled={!help.helpKey && !help.shortcut}><button type="button" role="menuitem" onClick={() => action(run)}>{icon}<span>{label}</span></button></Tooltip>;
  const block = (label: string, icon: ReactNode, content: JSONContent, capability?: DocumentCapabilityId, help?: Help) => item(label, icon, () => insertAtEmptyParagraph(editor, pos, content, capability), help);
  return <div className="nb-block-context-menu nb-empty-block-menu" role="menu" aria-label="插入内容" onKeyDown={navigateMenu} onPointerDown={event => event.preventDefault()}>
    <div className="nb-empty-block-group" role="group" aria-label="文字与列表">
      <div className="nb-empty-block-label">文字与列表</div>
      <div className="nb-empty-block-headings">
        <Tooltip content="正文" shortcut="Ctrl+0"><button type="button" role="menuitem" aria-label="正文" onClick={() => insert(paragraph())}><Type size={16}/></button></Tooltip>
        {([1, 2, 3, 4, 5, 6] as const).map(level => <Tooltip key={level} content={'标题 ' + level} shortcut={`Ctrl+${level}`}><button type="button" role="menuitem" aria-label={'标题 ' + level} onClick={() => insert({ type: 'heading', attrs: { level } })}>H{level}</button></Tooltip>)}
      </div>
      <div className="nb-empty-block-grid">
        {block('无序列表', <List size={16}/>, { type: 'bulletList', content: [{ type: 'listItem', content: [paragraph()] }] }, undefined, { shortcut: 'Ctrl+Shift+8' })}
        {block('有序列表', <OrderedListIcon size={16}/>, { type: 'orderedList', content: [{ type: 'listItem', content: [paragraph()] }] }, undefined, { shortcut: 'Ctrl+Shift+7' })}
        {block('待办', <CheckSquare size={16}/>, { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [paragraph()] }] }, undefined, { shortcut: 'Ctrl+Shift+9' })}
        {item('超链接', <Link2 size={16}/>, () => insertEmptyParagraphLink(editor, pos))}
      </div>
    </div>
    <div className="nb-empty-block-group" role="group" aria-label="内容块">
      <div className="nb-empty-block-label">内容块</div>
      <div className="nb-empty-block-grid">
        {block('代码块', <Braces size={16}/>, { type: 'codeBlock' }, undefined, { shortcut: 'Ctrl+Alt+C' })}
        {block('引用', <Quote size={16}/>, { type: 'blockquote', content: [paragraph()] })}
        {block('提示块', <PanelTop size={16}/>, calloutContent(), native ? 'callout' : undefined, { helpKey: 'block.callout' })}
        {native && block('折叠块', <PanelTopClose size={16}/>, { type: 'disclosure', content: [paragraph()] }, 'disclosure', { helpKey: 'block.disclosure' })}
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
        {block('行内公式', <InlineFormulaIcon size={16}/>, { type: 'paragraph', content: [mathContent('inline')] }, undefined, { helpKey: 'formula.inline' })}
        {block('公式块', <BlockFormulaIcon size={16}/>, mathContent('block'), undefined, { helpKey: 'formula.block' })}
        {block('Mermaid', <Workflow size={16}/>, diagramContent('mermaid'))}
        {block('信息图', <BarChart3 size={16}/>, diagramContent('infographic'))}
      </div>
    </div>
  </div>;
}
