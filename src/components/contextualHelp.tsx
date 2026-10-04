import type { ReactNode } from 'react';
import './contextualHelp.css';

type Illustration = 'table-position' | 'cell-align' | 'cell-vertical' | 'header-row' | 'header-column' | 'three-line' | 'table' | 'table-scroll' | 'formula-expand' | 'formula-wrap' | 'formula-scroll' | 'caption' | 'annotation' | 'disclosure' | 'callout' | 'inline-formula' | 'block-formula';
interface HelpEntry { description: string; illustration: Illustration; scope?: string }

/** Semantic keys keep identically named operations in different scopes distinct. */
export const contextualHelp = {
  'table.position': { description: '调整整张表格在页面中的位置。单元格里的文字位置保持原样。', illustration: 'table-position', scope: '当前表格' },
  'table.cell.horizontal': { description: '调整选中单元格内的文字：靠左、居中或靠右。整张表格的位置保持原样。', illustration: 'cell-align', scope: '选中单元格' },
  'table.cell.vertical': { description: '调整文字在选中单元格内的上下位置。行高较大时更容易看出效果。', illustration: 'cell-vertical', scope: '选中单元格' },
  'table.header.row': { description: '将第一行设为表头，适合列名、指标名。再次选择可恢复为普通单元格。', illustration: 'header-row', scope: '当前表格' },
  'table.header.column': { description: '将第一列设为表头，适合项目名、分类名。再次选择可恢复为普通单元格。', illustration: 'header-column', scope: '当前表格' },
  'table.style.standard': { description: '显示完整网格，适合逐格阅读、录入和比较数据。', illustration: 'table', scope: '全文表格' },
  'table.style.three-line': { description: '保留顶线、表头下方的分隔线与底线，适合论文和简洁的数据展示。', illustration: 'three-line', scope: '全文表格' },
  'table.reading.expand': { description: '按表格本身的宽度展开。宽表会延伸页面的阅读范围。', illustration: 'table', scope: '全文表格 · 阅读视图' },
  'table.reading.scroll': { description: '将宽表放进页面内的滚动区域，横向滚动查看其余列。', illustration: 'table-scroll', scope: '全文表格 · 阅读视图' },
  'formula.reading.expand': { description: '按公式的自然宽度完整展开，保留原有排版。长公式会延伸阅读范围。', illustration: 'formula-expand', scope: '全文公式 · 阅读视图' },
  'formula.reading.wrap': { description: '让长公式在合适的位置换行，便于窄窗口阅读。公式源码保持原样。', illustration: 'formula-wrap', scope: '全文公式 · 阅读视图' },
  'formula.reading.scroll': { description: '过宽的块公式可在局部横向滚动，原有分行保留；行内公式自动换行。', illustration: 'formula-scroll', scope: '全文公式 · 阅读视图' },
  'figure.caption': { description: '在图片下方添加可见的标题或来源，阅读时与图片一起展示。', illustration: 'caption', scope: '当前图片' },
  'table.caption': { description: '在表格下方添加可见的标题或来源，阅读时与表格一起展示。', illustration: 'caption', scope: '当前表格' },
  'block.annotation': { description: '为这个内容块补充解释，读者通过说明标记查看详情，正文保持简洁。', illustration: 'annotation', scope: '当前内容块' },
  'block.disclosure': { description: '用标题收起一组内容，点击标题展开，适合详细过程、附录或参考材料。', illustration: 'disclosure' },
  'block.callout': { description: '用带类型标识的提示块突出说明、建议或注意事项。', illustration: 'callout' },
  'formula.inline': { description: '将短公式放进一句话中，与前后的文字一起排列。', illustration: 'inline-formula' },
  'formula.block': { description: '让公式独占一个内容块，适合较长的表达式或推导。', illustration: 'block-formula' },
} as const satisfies Record<string, HelpEntry>;
export type ContextualHelpKey = keyof typeof contextualHelp;

function TableDiagram({ kind }: { kind: Illustration }) {
  const threeLine = kind === 'three-line';
  return <>
    <rect x="28" y="12" width="216" height="78" rx="5" className="nb-help-page"/>
    <g transform={kind === 'table-position' ? 'translate(24 0)' : undefined} className={kind === 'table-position' ? 'nb-help-table-move' : undefined}>
      <rect x="52" y="26" width="120" height="49" rx="2" className={threeLine ? 'nb-help-table-surface' : 'nb-help-table'}/>
      {kind === 'header-row' && <rect x="53" y="27" width="118" height="15" className="nb-help-highlight"/>}
      {kind === 'header-column' && <rect x="53" y="27" width="39" height="47" className="nb-help-highlight"/>}
      {threeLine ? <path d="M52 26H172M52 42H172M52 75H172" className="nb-help-ink"/> : <path d="M92 26V75M132 26V75M52 42H172M52 58H172" className="nb-help-grid"/>}
      {[0,1,2].map(row => [0,1,2].map(col => <path key={`${row}-${col}`} d={`M${60 + col * 40} ${34 + row * 16}h22`} className="nb-help-text-line"/>))}
    </g>
    {kind === 'table-position' && <path d="M51 84H220m-5-4 5 4-5 4M56 80l-5 4 5 4" className="nb-help-accent-line"/>}
  </>;
}

function HelpIllustration({ kind }: { kind: Illustration }) {
  let drawing: ReactNode;
  if (['table-position','header-row','header-column','three-line','table'].includes(kind)) drawing = <TableDiagram kind={kind}/>;
  else if (kind === 'cell-align' || kind === 'cell-vertical') drawing = <>{[0,1,2].map(index => <g key={index} transform={`translate(${24 + index * 78} 22)`}>
    <rect width="68" height="60" rx="4" className="nb-help-table"/>
    {[0,1,2].map(row => <path key={row} d={kind === 'cell-align' ? `M${[8,20,32][index]} ${20 + row * 10}h${row === 2 ? 18 : 28}` : `M14 ${[10,24,38][index] + row * 7}h${row === 2 ? 22 : 38}`} className="nb-help-text-line"/>)}
  </g>)}</>;
  else if (kind === 'table-scroll') drawing = <><rect x="22" y="18" width="228" height="68" rx="5" className="nb-help-page"/>
    <svg x="35" y="22" width="198" height="52"><g className="nb-help-formula-pan"><rect x="0" y="4" width="280" height="44" className="nb-help-table"/><path d="M70 4V48M140 4V48M210 4V48M0 19H280M0 34H280" className="nb-help-grid"/>{[0,1,2,3].map(col => <path key={col} d={`M${12 + col * 70} 12h39M${12 + col * 70} 27h39M${12 + col * 70} 41h39`} className="nb-help-text-line"/>)}</g></svg>
    <path d="M40 79H232" className="nb-help-grid"/><path d="M42 79H112" className="nb-help-accent-line nb-help-scroll-thumb"/>
  </>;
  else if (kind.startsWith('formula-')) drawing = <>
    <rect x="22" y="18" width="228" height="68" rx="5" className="nb-help-page"/>
    {kind === 'formula-wrap' ? <><text x="42" y="43" className="nb-help-formula">a + b + c + d</text><text x="62" y="66" className="nb-help-formula">= x + y + z</text><path d="M211 36v14h-14m5-5-5 5 5 5" className="nb-help-accent-line"/></>
      : <><svg x={kind === 'formula-expand' ? '20' : '32'} y="29" width={kind === 'formula-expand' ? '248' : '208'} height="35"><text x="8" y="25" className={`nb-help-formula ${kind === 'formula-scroll' ? 'nb-help-formula-pan' : ''}`}>a + b + c + d = x + y + z</text></svg>{kind === 'formula-scroll' && <><path d="M40 75H232" className="nb-help-grid"/><path d="M42 75H112" className="nb-help-accent-line nb-help-scroll-thumb"/></>}</>}
  </>;
  else if (kind === 'caption') drawing = <><rect x="62" y="12" width="148" height="58" rx="4" className="nb-help-page"/><path d="m79 60 30-29 21 20 18-15 43 24" className="nb-help-grid"/><circle cx="178" cy="29" r="6" className="nb-help-highlight"/><path d="M81 82H191" className="nb-help-accent-line"/><text x="136" y="96" textAnchor="middle" className="nb-help-small-text">标题 / 来源</text></>;
  else if (kind === 'annotation') drawing = <><rect x="18" y="22" width="119" height="54" rx="5" className="nb-help-page"/><path d="M31 38h84M31 49h73M31 60h56" className="nb-help-text-line"/><circle cx="139" cy="28" r="9" className="nb-help-highlight"/><text x="139" y="32" textAnchor="middle" className="nb-help-small-text">?</text><path d="M151 28h11" className="nb-help-accent-line"/><rect x="171" y="16" width="82" height="67" rx="5" className="nb-help-page"/><path d="M184 33h55M184 45h48M184 57h55M184 69h32" className="nb-help-text-line"/></>;
  else if (kind === 'disclosure') drawing = <><rect x="27" y="13" width="218" height="77" rx="5" className="nb-help-page"/><path d="m40 28 4 4 4-4" className="nb-help-accent-line"/><path d="M59 30h106" className="nb-help-text-line"/><g className="nb-help-disclosure-body"><path d="M59 49h154M59 61h133M59 73h112" className="nb-help-text-line"/></g></>;
  else if (kind === 'callout') drawing = <><rect x="27" y="19" width="218" height="65" rx="5" className="nb-help-page"/><path d="M28 22v59" className="nb-help-accent-line"/><circle cx="47" cy="37" r="8" className="nb-help-highlight"/><text x="47" y="41" textAnchor="middle" className="nb-help-small-text">i</text><path d="M65 37h72M65 54h155M65 67h116" className="nb-help-text-line"/></>;
  else drawing = <><path d="M25 25h218M25 79h218" className="nb-help-grid"/>{kind === 'inline-formula' ? <><path d="M25 50h53M177 50h66" className="nb-help-text-line"/><text x="90" y="55" className="nb-help-formula">E = mc²</text></> : <><path d="M25 35h154M25 88h176" className="nb-help-text-line"/><text x="136" y="62" textAnchor="middle" className="nb-help-formula">E = mc²</text></>}</>;
  return <svg className="nb-contextual-help-illustration" viewBox="0 0 272 104" aria-hidden="true" focusable="false">{drawing}</svg>;
}

export function ContextualHelpContent({ helpKey, title, shortcut }: { helpKey: ContextualHelpKey; title: ReactNode; shortcut?: string }) {
  const entry: HelpEntry = contextualHelp[helpKey];
  return <div className="nb-contextual-help" data-help-key={helpKey}>
    <div className="nb-contextual-help-heading"><span>{title}</span>{shortcut && <kbd className="nb-tooltip-kbd">{shortcut}</kbd>}</div>
    {entry.scope && <div className="nb-contextual-help-scope">{entry.scope}</div>}
    <HelpIllustration kind={entry.illustration}/>
    <p>{entry.description}</p>
  </div>;
}
