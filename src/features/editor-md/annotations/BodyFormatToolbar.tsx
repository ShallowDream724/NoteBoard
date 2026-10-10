import { useEffect, useState } from 'react';
import type { EditorState } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { lift, setBlockType, toggleMark, wrapIn } from '@tiptap/pm/commands';
import { liftListItem, wrapInList } from '@tiptap/pm/schema-list';
import { undo, redo, undoDepth, redoDepth } from '@tiptap/pm/history';
import { Bold, Code, Eraser, ImagePlus, Italic, Link, List, Quote, Redo2, Strikethrough, Underline, Undo2 } from 'lucide-react';
import { OrderedListIcon } from '../../../components/OrderedListIcon';
import { Tooltip } from '../../../components/Tooltip';
import { ColorSwatches } from '../../document-style/ColorSwatches';
import { canStyleDraftMark, clearDraftTextFormatting, draftMarkAttributes, draftMarkStatus, runDraftCommand, setDraftColor, setDraftLink, validDraftLink } from './bodyFormatting';

const marks = [['bold', '加粗', Bold], ['italic', '斜体', Italic], ['underline', '下划线', Underline], ['strike', '删除线', Strikethrough], ['code', '行内代码', Code]] as const;
function inNode(state: EditorState, name: string): boolean {
  for (let depth = state.selection.$from.depth; depth > 0; depth--) if (state.selection.$from.node(depth).type.name === name) return true;
  return false;
}

/** Commands receive the raw draft view, never the parent editor's selection. */
export function BodyFormatToolbar({ view, state, imageInput, onImageInput, composing = false }: {
  view: EditorView; state: EditorState; imageInput: boolean; onImageInput(): void; composing?: boolean;
}) {
  const [panel, setPanel] = useState<'colors' | 'link' | null>(null), [href, setHref] = useState('');
  const command = (action: Parameters<typeof runDraftCommand>[1]) => runDraftCommand(view, action);
  const linkActive = draftMarkStatus(state, 'link');
  const linkEnabled = !composing && canStyleDraftMark(state, 'link') && (!state.selection.empty || !!linkActive);
  const colorsEnabled = !composing && (canStyleDraftMark(state, 'textColor') || canStyleDraftMark(state, 'highlight'));
  useEffect(() => {
    if (panel === 'colors' && !colorsEnabled || panel === 'link' && !linkEnabled) setPanel(null);
  }, [panel, colorsEnabled, linkEnabled]);
  const paragraphType = state.selection.$from.parent.type.name;
  return <div className="nb-annotation-format-area" data-editing-scope-interaction>
    <div className="nb-annotation-format" role="toolbar" aria-label="说明格式" onKeyDown={event => {
      if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key) || (event.target as Element).tagName === 'SELECT') return;
      const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
      const index = buttons.indexOf(event.target as HTMLButtonElement); if (index < 0) return;
      event.preventDefault();
      buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    }}>
      {marks.filter(([name]) => state.schema.marks[name]).map(([name, label, Icon]) => <Tooltip content={label} key={name}><button type="button" aria-label={label}
        aria-pressed={draftMarkStatus(state, name)} disabled={composing || !canStyleDraftMark(state, name)}
        onPointerDown={event => event.preventDefault()} onClick={() => command(toggleMark(state.schema.marks[name]))}><Icon size={14}/></button></Tooltip>)}
      {(state.schema.marks.textColor || state.schema.marks.highlight) && <Tooltip content="文字颜色与高亮"><button type="button" aria-label="文字颜色与高亮" aria-expanded={panel === 'colors'} aria-haspopup="dialog"
        disabled={!colorsEnabled}
        onPointerDown={event => event.preventDefault()} onClick={() => setPanel(panel === 'colors' ? null : 'colors')}>
        <span aria-hidden="true" className="nb-annotation-color-preview" style={{ color: String(draftMarkAttributes(state, 'textColor').color ?? 'var(--editor-text)'), backgroundColor: String(draftMarkAttributes(state, 'highlight').color ?? 'transparent') }}>A</span>
      </button></Tooltip>}
      {state.schema.marks.link && <Tooltip content="链接"><button type="button" aria-label="链接" aria-pressed={linkActive} aria-expanded={panel === 'link'} aria-haspopup="dialog" disabled={!linkEnabled}
        onPointerDown={event => event.preventDefault()} onClick={() => {
          setHref(String(draftMarkAttributes(state, 'link').href ?? '')); setPanel(panel === 'link' ? null : 'link');
        }}><Link size={14}/></button></Tooltip>}
      <Tooltip content="清除文字样式" shortcut={'Ctrl+\\'}><button type="button" aria-label="清除文字格式" disabled={composing || !clearDraftTextFormatting(state)}
        onPointerDown={event => event.preventDefault()} onClick={() => command(clearDraftTextFormatting)}><Eraser size={14}/></button></Tooltip>
      <span className="nb-annotation-format-separator"/>
      {([['bulletList', '无序列表', List], ['orderedList', '有序列表', OrderedListIcon], ['blockquote', '引用', Quote]] as const)
        .filter(([name]) => state.schema.nodes[name]).map(([name, label, Icon]) => {
          const active = inNode(state, name);
          const action = name === 'blockquote' ? active ? lift : wrapIn(state.schema.nodes[name]) : active && state.schema.nodes.listItem ? liftListItem(state.schema.nodes.listItem) : wrapInList(state.schema.nodes[name]);
          return <Tooltip content={label} key={name}><button type="button" aria-label={label} aria-pressed={active} disabled={composing || !action(state)}
            onPointerDown={event => event.preventDefault()} onClick={() => command(action)}><Icon size={14}/></button></Tooltip>;
        })}
      <select aria-label="段落样式" value={paragraphType === 'heading' ? 'heading' : paragraphType === 'paragraph' ? 'paragraph' : ''} disabled={composing}
        onChange={event => { const name = event.target.value; if (state.schema.nodes[name]) command(setBlockType(state.schema.nodes[name], name === 'heading' ? { level: 2 } : undefined)); }}>
        <option value="" disabled>段落</option><option value="paragraph">正文</option>{state.schema.nodes.heading && <option value="heading">标题</option>}
      </select>
      {state.schema.nodes.image && <Tooltip content="插入图片"><button type="button" aria-label="插入图片" aria-expanded={imageInput} disabled={composing}
        onPointerDown={event => event.preventDefault()} onClick={onImageInput}><ImagePlus size={14}/></button></Tooltip>}
      <Tooltip content="撤销说明编辑"><button type="button" aria-label="撤销说明编辑" disabled={composing || !undoDepth(state)} onPointerDown={event => event.preventDefault()} onClick={() => command(undo)}><Undo2 size={14}/></button></Tooltip>
      <Tooltip content="重做说明编辑"><button type="button" aria-label="重做说明编辑" disabled={composing || !redoDepth(state)} onPointerDown={event => event.preventDefault()} onClick={() => command(redo)}><Redo2 size={14}/></button></Tooltip>
    </div>
    {panel === 'colors' && <div className="nb-annotation-color-panel" role="dialog" aria-label="说明文字颜色与高亮" onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setPanel(null); view.focus(); }
    }}>
      {state.schema.marks.textColor && <><span>文字颜色</span><ColorSwatches kind="text" label="说明文字颜色" value={draftMarkAttributes(state, 'textColor').color as string | undefined} onChange={color => setDraftColor(view, 'textColor', color)}/></>}
      {state.schema.marks.highlight && <><span>高亮</span><ColorSwatches kind="background" label="说明高亮颜色" value={draftMarkAttributes(state, 'highlight').color as string | undefined} onChange={color => setDraftColor(view, 'highlight', color)}/></>}
    </div>}
    {panel === 'link' && <form className="nb-annotation-link-input nb-annotation-image-input" role="dialog" aria-label="说明链接" onSubmit={event => {
      event.preventDefault(); if (setDraftLink(view, href)) { setPanel(null); view.focus(); }
    }} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setPanel(null); view.focus(); } }}>
      <input autoFocus aria-label="说明链接地址" placeholder="链接地址或相对路径" value={href} onChange={event => setHref(event.target.value)} aria-invalid={!!href && !validDraftLink(href)}/>
      <div><button type="submit" disabled={!validDraftLink(href)}>应用</button>{linkActive && <button type="button" onClick={() => { if (setDraftLink(view, null)) setPanel(null); }}>移除链接</button>}
        <button type="button" onClick={() => { setPanel(null); view.focus(); }}>取消</button></div>
    </form>}
  </div>;
}
