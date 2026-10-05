import { createRoot } from 'react-dom/client';
import { Tooltip, TooltipProvider } from '../../src/components/Tooltip';
import { ContextualHelpContent, contextualHelp, type ContextualHelpKey } from '../../src/components/contextualHelp';
import { TipTapEditor } from '../../src/features/editor-md/TipTapEditor';
import { getMdTipTapEditor } from '../../src/features/editor-md/editorInstances';
import { calloutContent, mathContent } from '../../src/features/editor-md/insertContentRecipes';
import { encodeNativeDocument, type NativeNode } from '../../src/core/nativeDocument';
import { useDocumentStore } from '../../src/stores/documentStore';
import { ToolbarDropdown, ToolbarDropdownItem } from '../../src/features/toolbar/ToolbarComponents';
import { useState } from 'react';
import '../../src/styles/globals.css';

const params = new URLSearchParams(location.search);
document.documentElement.dataset.theme = params.get('theme') || 'chen-guang';
const cases: Array<{ label: string; key: ContextualHelpKey }> = [
  { label: '整张表格居中', key: 'table.position' }, { label: '单元格文字居中', key: 'table.cell.horizontal' },
  { label: '设置表头行', key: 'table.header.row' }, { label: '设置首列表头', key: 'table.header.column' },
  { label: '三线表', key: 'table.style.three-line' }, { label: '公式自然展开', key: 'formula.reading.expand' },
  { label: '公式自动换行', key: 'formula.reading.wrap' }, { label: '公式滚动块', key: 'formula.reading.scroll' },
  { label: '表格滚动块', key: 'table.reading.scroll' }, { label: '添加图注', key: 'figure.caption' },
  { label: '添加说明', key: 'block.annotation' }, { label: '折叠块', key: 'block.disclosure' },
  { label: '添加表注', key: 'table.caption' }, { label: '提示块', key: 'block.callout' },
  { label: '行内公式', key: 'formula.inline' }, { label: '公式块', key: 'formula.block' },
];
const key = 'untitled:contextual-help-comparison';
function sample(help: string): NativeNode[] {
  if (help === 'block.annotation') return [{ type:'paragraph', attrs:{ annotationId:'help-note' }, content:[{ type:'text', text:'观测结果保持稳定。' }] },
    { type:'annotationStore', content:[{ type:'annotationBody', attrs:{ id:'help-note' }, content:[{ type:'paragraph', content:[{ type:'text', text:'样本来自同一组观测。' }] }] }] }];
  if (help.startsWith('block.callout')) return [{ ...calloutContent(), attrs: { ...calloutContent().attrs, kind: help.endsWith('.wrap') ? 'note' : help.split('.')[2] || 'note' },
    ...(help.endsWith('.wrap') ? { content:[{ type:'paragraph', content:[{ type:'text', text:'保留当前内容。' }] }] } : {}) } as NativeNode];
  if (help === 'block.disclosure') return [{ type: 'disclosure', content: [{ type: 'paragraph' }] }];
  if (help === 'formula.block') return [mathContent('block') as NativeNode];
  if (help === 'formula.inline') return [{ type: 'paragraph', content: [{ type: 'text', text: '正文 ' }, mathContent('inline') as NativeNode, { type: 'text', text: ' 正文' }] }];
  if (help.startsWith('formula.reading')) return [{ type: 'mathBlock', attrs: { latex: 'a+b+c+d=e+f+g+h', textAlign: 'left' } }];
  if (help === 'figure.caption') return [{ type: 'image', attrs: { src: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="280" height="90"%3E%3Crect width="280" height="90" fill="%23dbeafe"/%3E%3C/svg%3E', caption: '图 1 · 图片说明' } }];
  return [{ type: 'table', attrs: help === 'table.caption' ? { caption: '表 1 · 样本统计' } : {}, content: [['项目','数量','状态'],['样本 A','12','完成']].map((row,r) => ({ type: 'tableRow', content: row.map(text => ({ type: r === 0 ? 'tableHeader' : 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })) })) }];
}
const selected = params.get('sample') || 'block.callout';
if (params.has('compare')) useDocumentStore.getState().upsertFromPayload({ key, displayName: 'help-comparison.nb', dirPath: '', kind: 'noteboard', language: 'markdown',
  content: encodeNativeDocument({ type: 'doc', content: sample(selected) }), encoding: 'utf8', eol: 'lf', size: 0, mtime: 0, readonly: false });
window.contextualHelpQA = { ready: () => !!getMdTipTapEditor(key), editor: () => getMdTipTapEditor(key) };
declare global { interface Window { contextualHelpQA: { ready(): boolean; editor(): ReturnType<typeof getMdTipTapEditor> } } }
function Fixture() {
  const [open, setOpen] = useState(true);
  if (params.has('compare')) return <TooltipProvider><main style={{ display:'grid', gridTemplateColumns:'286px minmax(400px,1fr)', gap:28, padding:24, color:'var(--editor-text)', background:'var(--editor-bg)', minHeight:400 }}>
    <section><h3>悬停帮助</h3><ContextualHelpContent helpKey={selected as ContextualHelpKey} title={selected}/></section>
    <section><h3>真实编辑器</h3><div style={{ position:'relative', height:380 }}><TipTapEditor docKey={key}/></div></section>
  </main></TooltipProvider>;
  if (params.has('gallery')) return <main style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(260px,1fr))', gap:18, padding:24, color:'var(--editor-text)', background:'var(--editor-bg)' }}>
    {(Object.keys(contextualHelp) as ContextualHelpKey[]).map(help => <section key={help}><ContextualHelpContent helpKey={help} title={help}/></section>)}
  </main>;
  return <TooltipProvider><main style={{ padding: 24, color: 'var(--editor-text)', fontFamily: 'var(--ui-font-family)' }}>
    <ToolbarDropdown trigger={<button type="button">内容块操作</button>} isOpen={open} onOpenChange={setOpen}>
      {cases.map(item => <ToolbarDropdownItem key={item.key} label={item.label} helpKey={item.key} onClick={() => setOpen(false)}/>)}
    </ToolbarDropdown>
    <div style={{ position: 'fixed', right: 12, bottom: 12 }}><Tooltip content="折叠块" helpKey="block.disclosure"><button type="button">边界检查</button></Tooltip></div>
  </main></TooltipProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
