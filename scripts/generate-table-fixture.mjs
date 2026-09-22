import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const output = resolve(process.argv[2] ?? 'table-layout.md');
const line = cells => `| ${cells.join(' | ')} |`;
const table = (header, rows) => [line(header), line(header.map(() => '---')), ...rows.map(line)].join('\n');
const wide = table(['样本', ...Array.from({ length: 11 }, (_, i) => `变量 ${i + 1}`)],
  Array.from({ length: 70 }, (_, r) => [`S${String(r + 1).padStart(3, '0')}`, ...Array.from({ length: 11 }, (_, c) => `${r + 1}.${String(c + 1).padStart(2, '0')}`)]));
const text = `# 表格排版检查

先拖动下面表格的列边界和行下边界，再试辅助栏中的标准表、三线表。样式应对本篇文档的所有表格生效。保存后关闭重开，检查尺寸和样式是否保留。

## 自然宽度

${table(['序号', '观测值', '备注'], [['1', '0.125', '中文实验记录'], ['2', '0.250', '第二条记录'], ['3', '0.375', '文字较多时，行高应自动容纳内容。']])}

## 第二张小表

${table(['项目', '说明'], [['A', '检查全文样式是否一致'], ['B', '在单元格里按 Ctrl+/，再切回来']])}

## 手动列宽与跨页续表

此表预设了列宽和第一条记录的最小行高。导出 PDF 时，应按列续表并重复样本列；较短的一组不应强制占满正文宽度。最后一个样本是 S070，末列为变量 11。

<!-- noteboard-table ${JSON.stringify({widths:[65,...Array(11).fill(125)],heights:{1:64}})} -->
${wide}

## 文档结尾

这里应出现在导出结果中。
`;
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, text, 'utf8');
console.log(output);
