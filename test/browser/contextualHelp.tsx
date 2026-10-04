import { createRoot } from 'react-dom/client';
import { Tooltip, TooltipProvider } from '../../src/components/Tooltip';
import type { ContextualHelpKey } from '../../src/components/contextualHelp';
import { ToolbarDropdown, ToolbarDropdownItem } from '../../src/features/toolbar/ToolbarComponents';
import { useState } from 'react';
import '../../src/styles/globals.css';

document.documentElement.dataset.theme = new URLSearchParams(location.search).get('theme') || 'chen-guang';
const cases: Array<{ label: string; key: ContextualHelpKey }> = [
  { label: '整张表格居中', key: 'table.position' }, { label: '单元格文字居中', key: 'table.cell.horizontal' },
  { label: '设置表头行', key: 'table.header.row' }, { label: '设置首列表头', key: 'table.header.column' },
  { label: '三线表', key: 'table.style.three-line' }, { label: '公式自然展开', key: 'formula.reading.expand' },
  { label: '公式自动换行', key: 'formula.reading.wrap' }, { label: '公式滚动块', key: 'formula.reading.scroll' },
  { label: '表格滚动块', key: 'table.reading.scroll' }, { label: '添加图注', key: 'figure.caption' },
  { label: '添加说明', key: 'block.annotation' }, { label: '折叠块', key: 'block.disclosure' },
];
function Fixture() {
  const [open, setOpen] = useState(true);
  return <TooltipProvider><main style={{ padding: 24, color: 'var(--editor-text)', fontFamily: 'var(--ui-font-family)' }}>
    <ToolbarDropdown trigger={<button type="button">内容块操作</button>} isOpen={open} onOpenChange={setOpen}>
      {cases.map(item => <ToolbarDropdownItem key={item.key} label={item.label} helpKey={item.key} onClick={() => setOpen(false)}/>)}
    </ToolbarDropdown>
    <div style={{ position: 'fixed', right: 12, bottom: 12 }}><Tooltip content="折叠块" helpKey="block.disclosure"><button type="button">边界检查</button></Tooltip></div>
  </main></TooltipProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
