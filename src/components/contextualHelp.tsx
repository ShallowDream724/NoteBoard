import { useEffect, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Copy, Pencil, Pin, Trash2, WrapText, X } from 'lucide-react';
import { DisclosureTriangle } from './DisclosureTriangle';
import { CALLOUT_DEFAULTS, calloutStyle, calloutSvgIcon, calloutTitle } from '../features/editor-md/calloutPresentation';
import type { AlertKind } from '../features/editor-md/alertPresentation';
import { tableAlignmentMargins } from '../features/editor-md/tableAlignment';
import '../features/editor-md/callout.css';
import '../features/editor-md/rich-content/richContent.css';
import '../features/editor-md/rich-content/carousel.css';
import '../features/editor-md/codeBlockView.css';
import '../features/editor-md/tablePresentation.css';
import '../features/editor-md/tableView.css';
import '../features/editor-md/imageCaption.css';
import '../features/editor-md/annotations/annotations.css';
import '../features/editor-md/formulaSourceEditor.css';
import '../features/editor-md/documentReadingView.css';
import './contextualHelp.css';

type ImageIllustration = `image-grid-${4 | 6 | 9}` | `image-columns-${2 | 3}` | 'image-carousel';
type Illustration = 'table-position' | `table-position-${'left' | 'center' | 'right'}` | 'cell-align' | `cell-align-${'left' | 'center' | 'right'}` | 'cell-vertical' | `cell-vertical-${'top' | 'middle' | 'bottom'}` | 'header-row' | 'header-column' | 'header-row-clear' | 'header-column-clear' | 'three-line' | 'table' | 'table-expand' | 'table-scroll' | 'formula-expand' | 'formula-wrap' | 'formula-scroll' | 'figure-caption' | 'table-caption' | 'annotation' | 'disclosure' | 'callout' | 'callout-wrap' | `callout-${AlertKind}` | 'inline-formula' | 'block-formula' | ImageIllustration | 'bullet-list' | 'ordered-list' | 'task-list' | 'code-block' | 'quote' | 'divider' | 'paragraph' | `heading-${1 | 2 | 3 | 4 | 5 | 6}`;
interface HelpEntry { description: string; illustration: Illustration; scope?: string; previewLabel?: string }

/** Semantic keys keep identically named operations in different scopes distinct. */
export const contextualHelp = {
  'block.paragraph': { description: '用普通正文写说明和细节。选中已有文字后使用，可恢复为正文段落。', illustration: 'paragraph' },
  'block.heading.1': { description: '用最大的标题标出文章主题或主要部分，方便从大纲定位。', illustration: 'heading-1' },
  'block.heading.2': { description: '标出主要章节，适合放在一级标题之下组织内容。', illustration: 'heading-2' },
  'block.heading.3': { description: '标出章节中的小节，让较长的内容更容易浏览。', illustration: 'heading-3' },
  'block.heading.4': { description: '细分小节中的主题，适合较详细的内容结构。', illustration: 'heading-4' },
  'block.heading.5': { description: '标出更细的内容层级，适合复杂文档中的子主题。', illustration: 'heading-5' },
  'block.heading.6': { description: '标出最细一级的主题，以接近正文的大小保留标题层级。', illustration: 'heading-6' },
  'list.bullet': { description: '把并列要点排成列表，适合物品、想法或没有先后顺序的事项。按 Enter 继续下一项。', illustration: 'bullet-list' },
  'list.ordered': { description: '按顺序列出步骤或排名，编号会自动接续。按 Enter 继续下一项。', illustration: 'ordered-list' },
  'list.task': { description: '记录需要完成的事项，点击复选框标记完成。按 Enter 继续添加下一项。', illustration: 'task-list' },
  'block.code': { description: '集中放置多行代码，保留缩进并按语言显示颜色。可在顶部选择语言、折叠或复制代码。', illustration: 'code-block', previewLabel: '输入代码后的效果' },
  'block.quote': { description: '突出引用原话或参考内容，让它与自己的正文容易区分。', illustration: 'quote' },
  'block.divider': { description: '用一条横线分隔内容，适合在话题或章节之间留出清楚的边界。', illustration: 'divider' },
  'image.collection.4': { description: '插入两列、四格的图片组合，适合并排比较。点击空格添加自己的图片。', illustration: 'image-grid-4', previewLabel: '添加图片后的效果' },
  'image.collection.6': { description: '插入三列、六格的图片组合，适合展示一组照片。点击空格添加自己的图片。', illustration: 'image-grid-6', previewLabel: '添加图片后的效果' },
  'image.collection.9': { description: '插入三列、九格的图片组合，适合集中浏览更多图片。点击空格添加自己的图片。', illustration: 'image-grid-9', previewLabel: '添加图片后的效果' },
  'image.collection.carousel': { description: '每次展示一张图片，用下方箭头或圆点逐张切换。新建时提供三个空格，点击空格添加图片。', illustration: 'image-carousel', previewLabel: '添加图片后的效果' },
  'image.collection.layout.carousel': { description: '将现有图片组合改为逐张展示，保留图片和图注。用下方箭头或圆点切换查看。', illustration: 'image-carousel', scope: '当前图片组合' },
  'image.collection.columns.2': { description: '将现有图片按两列重新排列，单张图片更大，保留全部图片和图注。', illustration: 'image-columns-2', scope: '当前图片组合' },
  'image.collection.columns.3': { description: '将现有图片按三列重新排列，同一行可浏览更多图片，保留全部图片和图注。', illustration: 'image-columns-3', scope: '当前图片组合' },
  'table.position': { description: '调整整张表格在页面中的位置。单元格里的文字位置保持原样。', illustration: 'table-position', scope: '当前表格' },
  'table.position.left': { description: '将整张表格放在页面左侧，单元格里的文字位置保持原样。', illustration: 'table-position-left', scope: '当前表格' },
  'table.position.center': { description: '将整张表格放在页面中央，单元格里的文字位置保持原样。', illustration: 'table-position-center', scope: '当前表格' },
  'table.position.right': { description: '将整张表格放在页面右侧，单元格里的文字位置保持原样。', illustration: 'table-position-right', scope: '当前表格' },
  'table.cell.horizontal': { description: '调整选中单元格内的文字：靠左、居中或靠右。整张表格的位置保持原样。', illustration: 'cell-align', scope: '选中单元格' },
  'table.cell.horizontal.left': { description: '将选中单元格内的文字靠左排列。', illustration: 'cell-align-left', scope: '选中单元格' },
  'table.cell.horizontal.center': { description: '将选中单元格内的文字居中排列。', illustration: 'cell-align-center', scope: '选中单元格' },
  'table.cell.horizontal.right': { description: '将选中单元格内的文字靠右排列。', illustration: 'cell-align-right', scope: '选中单元格' },
  'table.cell.vertical': { description: '调整文字在选中单元格内的上下位置。行高较大时更容易看出效果。', illustration: 'cell-vertical', scope: '选中单元格' },
  'table.cell.vertical.top': { description: '将选中单元格内的文字放在顶部。行高较大时更容易看出效果。', illustration: 'cell-vertical-top', scope: '选中单元格' },
  'table.cell.vertical.middle': { description: '将选中单元格内的文字放在上下中央。行高较大时更容易看出效果。', illustration: 'cell-vertical-middle', scope: '选中单元格' },
  'table.cell.vertical.bottom': { description: '将选中单元格内的文字放在底部。行高较大时更容易看出效果。', illustration: 'cell-vertical-bottom', scope: '选中单元格' },
  'table.header.row': { description: '将第一行设为表头，适合列名、指标名。再次选择可恢复为普通单元格。', illustration: 'header-row', scope: '当前表格' },
  'table.header.row.clear': { description: '将第一行恢复为普通单元格，保留文字和数据。', illustration: 'header-row-clear', scope: '当前表格' },
  'table.header.column': { description: '将第一列设为表头，适合项目名、分类名。再次选择可恢复为普通单元格。', illustration: 'header-column', scope: '当前表格' },
  'table.header.column.clear': { description: '将第一列恢复为普通单元格，保留文字和数据。', illustration: 'header-column-clear', scope: '当前表格' },
  'table.style.standard': { description: '显示完整网格，适合逐格阅读、录入和比较数据。', illustration: 'table', scope: '全文表格' },
  'table.style.three-line': { description: '保留顶线、表头下方的分隔线与底线，适合论文和简洁的数据展示。', illustration: 'three-line', scope: '全文表格' },
  'table.reading.expand': { description: '按表格本身的宽度展开。宽表会延伸页面的阅读范围。', illustration: 'table-expand', scope: '全文表格 · 阅读视图' },
  'table.reading.scroll': { description: '将宽表放进页面内的滚动区域，横向滚动查看其余列。', illustration: 'table-scroll', scope: '全文表格 · 阅读视图' },
  'formula.reading.expand': { description: '按公式的自然宽度完整展开，保留原有排版。长公式会延伸阅读范围。', illustration: 'formula-expand', scope: '全文公式 · 阅读视图' },
  'formula.reading.wrap': { description: '让长公式在合适的位置换行，便于窄窗口阅读。公式源码保持原样。', illustration: 'formula-wrap', scope: '全文公式 · 阅读视图' },
  'formula.reading.scroll': { description: '过宽的块公式可在局部横向滚动，原有分行保留；行内公式自动换行。', illustration: 'formula-scroll', scope: '全文公式 · 阅读视图' },
  'figure.caption': { description: '在图片下方添加可见的标题或来源，阅读时与图片一起展示。', illustration: 'figure-caption', scope: '当前图片' },
  'table.caption': { description: '在表格下方添加可见的标题或来源，阅读时与表格一起展示。', illustration: 'table-caption', scope: '当前表格' },
  'block.annotation': { description: '为这个内容块补充解释，读者通过说明标记查看详情，正文保持简洁。', illustration: 'annotation', scope: '当前内容块' },
  'block.disclosure': { description: '用标题收起一组内容，点击标题展开，适合详细过程、附录或参考材料。', illustration: 'disclosure' },
  'block.callout': { description: '插入带 Note 标题的空提示块。输入正文后，可更换标题、图标和颜色。', illustration: 'callout' },
  'block.callout.wrap': { description: '将当前内容放进带 Note 标题的提示块，保留原有文字。可继续更换标题、图标和颜色。', illustration: 'callout-wrap', scope: '当前内容块' },
  'block.callout.note': { description: '插入 Note 说明块，适合备注与补充信息。', illustration: 'callout-note' },
  'block.callout.tip': { description: '插入 Tip 技巧块，适合建议与小技巧。', illustration: 'callout-tip' },
  'block.callout.important': { description: '插入 Important 重要信息块。', illustration: 'callout-important' },
  'block.callout.warning': { description: '插入 Warning 警告块，突出需要注意的风险。', illustration: 'callout-warning' },
  'block.callout.caution': { description: '插入 Caution 谨慎块，提醒读者谨慎操作。', illustration: 'callout-caution' },
  'formula.inline': { description: '插入空的行内公式，在 $ 标记之间输入 LaTeX 源码，与前后的文字一起排列。', illustration: 'inline-formula' },
  'formula.block': { description: '插入空的公式块并打开源码输入框。输入 LaTeX 后按 Ctrl+Enter 完成，公式独占一个内容块。', illustration: 'block-formula' },
} as const satisfies Record<string, HelpEntry>;
export type ContextualHelpKey = keyof typeof contextualHelp;

/** Read-only node-view DOM. Only the containing viewport is miniaturized;
 * presentation stays owned by the same CSS and metadata as the real document. */
function TablePreview({ kind }: { kind: Illustration }) {
  const horizontal = kind.startsWith('cell-align'), vertical = kind.startsWith('cell-vertical');
  const cells = horizontal || vertical;
  const rows = cells ? [['文字', '文字', '文字']] : kind === 'table-scroll' || kind === 'table-expand' ? [['项目', '一月', '二月', '三月', '四月', '五月'], ['样本 A', '12', '18', '24', '30', '36']] : [['项目', '数量', '状态'], ['样本 A', '12', '完成']];
  return <div className="tableWrapper"><table style={tableAlignmentMargins(kind.startsWith('table-position') ? kind.slice(15) || 'center' : 'center')}>
    <tbody>{rows.map((row, r) => <tr key={r}>{row.map((text, c) => {
      const header = kind === 'header-row-clear' ? false : kind === 'header-column-clear' ? r === 0 && c > 0 : kind === 'header-column' ? r === 0 || c === 0 : r === 0 && !cells;
      const Cell = header ? 'th' : 'td';
      return <Cell key={c} style={{ textAlign: horizontal ? kind === 'cell-align' ? (['left', 'center', 'right'] as const)[c] : kind.slice(11) as 'left' | 'center' | 'right' : undefined,
        verticalAlign: vertical ? kind === 'cell-vertical' ? (['top', 'middle', 'bottom'] as const)[c] : kind.slice(14) as 'top' | 'middle' | 'bottom' : undefined,
        width: cells ? 100 : undefined, height: vertical ? 72 : undefined }}><p>{text}</p></Cell>;
    })}</tr>)}</tbody>
    {kind === 'table-caption' && <caption className="nb-table-accessories"><span className="nb-table-caption" role="text">表 1 · 样本统计</span></caption>}
  </table></div>;
}

function CalloutPreview({ kind, wrapped = false }: { kind: AlertKind; wrapped?: boolean }) {
  const attrs = { ...CALLOUT_DEFAULTS, kind };
  return <div className={`github-alert github-alert-${kind}`} data-alert={kind} style={calloutStyle(attrs)}>
    <span className="callout-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d={calloutSvgIcon(attrs)}/></svg></span>
    <div className="alert-title">{calloutTitle(attrs)}</div><div className="alert-body"><p>{wrapped ? '保留当前内容。' : <br/>}</p></div>
  </div>;
}

// Local drawings stand in for the user's images; no image is fetched or inserted.
function imageScene(index: number) {
  const colors = [['#d8e9ec', '#659599', '#3d7075'], ['#f1e3d0', '#c8a273', '#987749'], ['#e3e2f0', '#a099bd', '#736a99']][index % 3];
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120" viewBox="0 0 160 120"><rect width="160" height="120" fill="${colors[0]}"/><circle cx="122" cy="30" r="12" fill="${colors[1]}" opacity=".55"/><path d="M0 92 48 40 104 98 135 68 160 94V120H0Z" fill="${colors[1]}"/><path d="m0 106 64-40 49 38 47-19v35H0Z" fill="${colors[2]}"/></svg>`)}`;
}

function ImageCollectionPreview({ kind }: { kind: ImageIllustration }) {
  const carousel = kind === 'image-carousel';
  const columns = kind === 'image-grid-4' || kind === 'image-columns-2' || carousel ? 2 : 3;
  const count = carousel ? 3 : kind.startsWith('image-grid-') ? Number(kind.slice(11)) : 6;
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (!carousel) return;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    let timer: number | undefined, index = 0;
    const stop = () => { window.clearTimeout(timer); timer = undefined; };
    const advance = () => {
      index += 1; setActive(index);
      // One pass is enough to show the relationship between images and dots.
      timer = index < count - 1 ? window.setTimeout(advance, 1600) : undefined;
    };
    const visibility = () => { if (document.hidden) stop(); };
    const motion = () => { if (reducedMotion?.matches) stop(); };
    if (!document.hidden && !reducedMotion?.matches) timer = window.setTimeout(advance, 1600);
    document.addEventListener('visibilitychange', visibility);
    reducedMotion?.addEventListener('change', motion);
    return () => { stop(); document.removeEventListener('visibilitychange', visibility); reducedMotion?.removeEventListener('change', motion); };
  }, [carousel, count]);
  return <section className="nb-image-collection" data-layout={carousel ? 'carousel' : 'grid'} role="group" aria-label="图片组合" style={{ width: '100%', marginLeft: 'auto', marginRight: 'auto' }}>
    <div className="nb-image-viewport"><div className="nb-image-slots" style={{ gridTemplateColumns: `repeat(${columns},minmax(0,1fr))`, transform: carousel ? `translateX(-${active * 100}%)` : undefined }}>
      {Array.from({ length: count }, (_, index) => <figure key={index} className="nb-image-slot" data-empty="false" data-active={index === active ? '' : undefined}>
        <div className="nb-image-slot-content"><div className="nb-image"><div data-image-frame><img src={imageScene(index)} width={160} height={120} alt=""/></div></div></div>
      </figure>)}
    </div></div>
    {carousel && <div className="nb-image-collection-controls">
      <button type="button" className="nb-image-page nb-image-page-previous" aria-label="上一张图片" disabled={active === 0} tabIndex={-1}><ChevronRight size={16}/></button>
      <div className="nb-image-pagination"><div className="nb-image-dots" role="group" aria-label="选择图片">
        {Array.from({ length: count }, (_, index) => <button key={index} type="button" className="nb-image-dot" aria-label={`第 ${index + 1} 张图片`} aria-pressed={index === active} tabIndex={-1}/>)}
      </div><span className="nb-image-counter" hidden>{active + 1} / {count}</span></div>
      <button type="button" className="nb-image-page" aria-label="下一张图片" disabled={active === count - 1} tabIndex={-1}><ChevronRight size={16}/></button>
    </div>}
  </section>;
}

function ListPreview({ kind }: { kind: 'bullet-list' | 'ordered-list' | 'task-list' }) {
  if (kind === 'task-list') return <ul data-type="taskList">{['整理资料', '完成初稿', '检查并分享'].map((text, index) =>
    <li key={text} data-type="taskItem" data-checked={index === 0 ? 'true' : 'false'}><label contentEditable={false}><input type="checkbox" checked={index === 0} readOnly tabIndex={-1}/><span/></label><div><p>{text}</p></div></li>)}</ul>;
  const List = kind === 'ordered-list' ? 'ol' : 'ul';
  const items = kind === 'ordered-list' ? ['准备材料', '开始制作', '检查结果'] : ['记录想法', '收集资料', '整理要点'];
  return <List>{items.map(text => <li key={text}><p>{text}</p></li>)}</List>;
}

function CodePreview() {
  return <div className="nb-code-block" data-wrap="false" data-collapsed="false" style={{ position: 'relative', borderRadius: 'var(--radius-md)', overflow: 'visible', border: '1px solid var(--editor-border)', background: 'var(--code-block-bg)' }}>
    <div className="nb-code-block-toolbar" contentEditable={false} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 8px', background: 'var(--editor-surface)', borderBottom: '1px solid var(--editor-border)', borderTopLeftRadius: 'calc(var(--radius-md) - 1px)', borderTopRightRadius: 'calc(var(--radius-md) - 1px)', fontSize: 12, color: 'var(--editor-text-muted)' }}>
      <div className="nb-code-block-leading"><button type="button" className="nb-code-block-heading" aria-label="折叠代码块" aria-expanded tabIndex={-1}><DisclosureTriangle expanded size={12}/></button>
        <button type="button" className="nb-code-block-language" aria-label="选择代码语言" aria-expanded={false} tabIndex={-1}><span style={{ fontWeight: 600, color: 'var(--editor-accent)' }}>JavaScript</span><ChevronDown size={12}/></button></div>
      <div className="nb-code-block-actions"><button type="button" className="nb-code-block-icon" aria-label="自动换行" aria-pressed={false} tabIndex={-1}><WrapText size={14}/></button>
        <div className="nb-annotation-toolbar-actions"><button type="button" aria-label="复制代码内容" className="nb-help-code-copy" tabIndex={-1}><Copy size={13}/><span>复制</span></button></div></div>
    </div>
    <pre className="nb-code-block-content" style={{ margin: 0, padding: '12px 16px 12px calc(38px + var(--nb-code-line-digits, 2) * .85ch)', overflowX: 'auto', fontSize: 'var(--mono-font-size)', fontFamily: 'var(--mono-font-family)', lineHeight: 1.5, background: 'transparent', border: 'none' }}><code className="language-javascript">
      {[<><span className="hljs-keyword">const</span> name = <span className="hljs-string">'NoteBoard'</span>;</>, <>console.log(name);</>, <><span className="hljs-comment">// 记录你的想法</span></>].map((line, index) => <span className="nb-help-code-line" key={index}><span className="nb-code-line-gutter"><span className="nb-code-line-number">{index + 1}</span></span>{line}{index < 2 ? '\n' : ''}</span>)}
    </code></pre>
  </div>;
}

// Fixed KaTeX HTML for a+b+c+d=e+f+g+h, generated at authoring time. The editor
// already supplies KaTeX fonts/CSS; this preview never imports its renderer.
function ReadingFormulaPreview() {
  return <div className="math-node math-node-display" data-math-align="left"><span className="math-node-preview"><span className="math-preview">
    <span className="katex-display"><span className="katex"><span className="katex-html">{['a','b','c','d','e','f','g','h'].map((letter, index) =>
      <span className="base" key={letter}><span className="strut" style={{ height: ['.6667em','.7778em','.6667em','.6944em','.6667em','.8889em','.7778em','.6944em'][index], verticalAlign: index === 3 || index === 7 ? undefined : index === 5 || index === 6 ? '-.1944em' : '-.0833em' }}/><span className="mord mathnormal" style={{ marginRight: index === 5 ? '.1076em' : index === 6 ? '.0359em' : undefined }}>{letter}</span>{index !== 7 && <>
        <span className="mspace" style={{ marginRight: index === 3 ? '.2778em' : '.2222em' }}/><span className={index === 3 ? 'mrel' : 'mbin'}>{index === 3 ? '=' : '+'}</span><span className="mspace" style={{ marginRight: index === 3 ? '.2778em' : '.2222em' }}/></>}
      </span>)}</span></span></span>
  </span></span></div>;
}

function HelpIllustration({ kind, label }: { kind: Illustration; label?: string }) {
  let content: ReactNode;
  if (kind === 'callout' || kind.startsWith('callout-')) content = <CalloutPreview kind={kind === 'callout' || kind === 'callout-wrap' ? CALLOUT_DEFAULTS.kind : kind.slice(8) as AlertKind} wrapped={kind === 'callout-wrap'}/>;
  else if (kind === 'disclosure') content = <section className="nb-disclosure" data-open="true"><div className="nb-disclosure-header">
    <span className="nb-disclosure-toggle"><DisclosureTriangle/></span><span className="nb-disclosure-title">更多内容</span></div>
    <div className="nb-disclosure-body"><p><br/></p></div></section>;
  else if (kind === 'inline-formula') content = <><p>正文 <span className="formula-source-editor formula-source-inline"><span className="formula-source-delimiter">$</span><span className="formula-source-text"/><span className="formula-source-delimiter">$</span></span> 正文</p><div className="math-node math-node-editing nb-help-inline-preview"><span className="math-node-preview"><span className="nb-help-empty-math">点击输入公式</span></span></div></>;
  else if (kind === 'block-formula') content = <div className="formula-source-editor formula-source-display"><textarea value="" readOnly tabIndex={-1} rows={4}/><div className="formula-source-hint">Enter 换行 · Ctrl+Enter 完成</div><div className="nb-help-empty-math">点击输入公式</div></div>;
  else if (kind.startsWith('formula-')) content = <ReadingFormulaPreview/>;
  else if (kind === 'figure-caption') content = <figure className="nb-help-figure"><div className="nb-help-image"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 16 5-5 5 5 3-3 5 5"/></svg></div><figcaption className="nb-image-caption"><span className="nb-image-caption-text">图 1 · 图片说明</span></figcaption></figure>;
  else if (kind === 'annotation') content = <div className="nb-help-annotation"><p className="nb-annotation-text-block">观测结果保持稳定。<span className="nb-annotation-inline-marker"><span className="nb-annotation-inline-anchor"><span className="nb-annotation-indicator">?</span></span></span></p>
    <div className="nb-annotation-panel"><div className="nb-annotation-header"><span className="nb-annotation-title">补充说明</span><div className="nb-annotation-actions">
      {[Trash2, Pencil, Pin, X].map((Icon, index) => <button key={index} type="button" tabIndex={-1}><Icon size={14}/></button>)}
    </div></div><div className="nb-annotation-richtext"><p>样本来自同一组观测。</p></div></div></div>;
  else if (kind.startsWith('image-')) content = <ImageCollectionPreview key={kind} kind={kind as ImageIllustration}/>;
  else if (kind === 'bullet-list' || kind === 'ordered-list' || kind === 'task-list') content = <ListPreview kind={kind}/>;
  else if (kind === 'code-block') content = <CodePreview/>;
  else if (kind === 'quote') content = <blockquote><p>阅读让想法不断生长。</p></blockquote>;
  else if (kind === 'divider') content = <><p>上一部分</p><hr/><p>下一部分</p></>;
  else if (kind === 'paragraph') content = <p>在这里写下想法，补充内容和细节。</p>;
  else if (kind.startsWith('heading-')) {
    const Heading = `h${kind.slice(8)}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
    content = <><Heading>章节标题</Heading><p>这一部分的正文内容。</p></>;
  }
  else content = <TablePreview kind={kind}/>;
  return <div className="nb-contextual-help-illustration" aria-hidden="true" inert data-preview-kind={kind}>
    {label && <div className="nb-help-preview-label">{label}</div>}
    <div className="ProseMirror nb-embedded-prose nb-help-document" data-table-style={kind === 'three-line' ? 'three-line' : 'standard'}
      data-table-reading={kind === 'table-scroll' ? 'scroll' : 'expand'} data-formula-reading={kind === 'formula-wrap' ? 'wrap' : kind === 'formula-scroll' ? 'scroll' : 'expand'}>{content}</div>
  </div>;
}

export function ContextualHelpContent({ helpKey, title, shortcut }: { helpKey: ContextualHelpKey; title: ReactNode; shortcut?: string }) {
  const entry: HelpEntry = contextualHelp[helpKey];
  return <div className="nb-contextual-help" data-help-key={helpKey}>
    <div className="nb-contextual-help-heading"><span>{title}</span>{shortcut && <kbd className="nb-tooltip-kbd">{shortcut}</kbd>}</div>
    {entry.scope && <div className="nb-contextual-help-scope">{entry.scope}</div>}
    <HelpIllustration kind={entry.illustration} label={entry.previewLabel}/>
    <p>{entry.description}</p>
  </div>;
}
