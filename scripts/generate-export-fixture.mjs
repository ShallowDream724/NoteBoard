import fs from 'node:fs';
import path from 'node:path';

// Deterministic, reviewable content; increase rows/columns without a checked-in giant fixture.
const destination = process.argv[2] ?? '.tmp/export-stress.md';
const rows = Number(process.argv[3] ?? 1000);
const columns = Number(process.argv[4] ?? 30);
if (!Number.isInteger(rows) || rows < 1 || rows > 100000 || !Number.isInteger(columns) || columns < 3 || columns > 100) throw new Error('Invalid fixture dimensions');
const sections = ['# 公式与表格排版试验册',
  '用于检查长公式换行、逐项缩放、宽表格续表、跨页表头与页码。普通内容保持统一字号。超宽矩阵、分式可以单独选择“缩到正文宽度”。',
  '> [!IMPORTANT]\n> 先在导出预览里点击超宽对象，再修改它的排版方式。其他对象的设置应当保持原样。\n>\n> 这里的中文、**粗体**、[外部链接](https://katex.org/)和提示块样式应完整保留。',
  '## 连续表达式'];
function formula(label, source, delimiter = '$$') {
  sections.push(`### ${label}`, delimiter === '\\[' ? `\\[\n${source}\n\\]` : `$$\n${source}\n$$`);
}
const terms = (n, f, sep = '+') => Array.from({length:n}, (_,i)=>f(i+1)).join(sep);
formula('六十四项多项式', 'P(x)='+terms(64,i=>`a_{${i}}x^{${i}}`)+'=0');
formula('损失函数与复杂分式', String.raw`\mathcal L(\theta)=`+terms(18,i=>String.raw`\lambda_{${i}}\frac{\left\|A_{${i}}\theta-b_{${i}}\right\|_2^2}{1+\exp(-\alpha_{${i}})}`));
formula('积分、微分与函数算子', String.raw`\mathcal{F}[u]=`+terms(14,i=>String.raw`\int_{\Omega_{${i}}}\left(\frac{\partial u}{\partial x_{${i}}}\right)^2\,\mathrm{d}x`));
formula('连等式与下标', String.raw`\mathbb{E}[X]=`+terms(20,i=>String.raw`\sum_{j=1}^{n_{${i}}}p_{{${i}}j}x_{{${i}}j}`,'='), '\\[');
formula('自动换行与显式对齐', String.raw`\begin{aligned}
  \nabla\cdot\mathbf{E} &= \frac{\rho}{\varepsilon_0}, & \nabla\cdot\mathbf{B} &= 0,\\[4pt]
  \nabla\times\mathbf{E} &= -\frac{\partial\mathbf{B}}{\partial t}, &
  \nabla\times\mathbf{B} &= \mu_0\mathbf{J}+\mu_0\varepsilon_0\frac{\partial\mathbf{E}}{\partial t}.
\end{aligned}`);
formula('超宽矩阵（单独缩放）', String.raw`A=\begin{bmatrix}`+Array.from({length:5},(_,r)=>terms(18,c=>`a_{${r+1},${c}}`,'&')).join('\\\\[3pt]')+String.raw`\end{bmatrix}`);
formula('不可从分子中间拆开的分式（单独缩放）', String.raw`R=\frac{`+terms(40,i=>`x_{${i}}^{2}`)+String.raw`}{1+\sum_{j=1}^{n}y_j^2}`);
formula('颜色、边框与组合符号', String.raw`\boxed{\color{blue}{\mathcal{H}}=\underbrace{\sum_{i=1}^{n}\frac{\hbar^2}{2m_i}\nabla_i^2}_{\text{kinetic energy}}+\overbrace{\sum_{i<j}\frac{q_iq_j}{4\pi\varepsilon_0r_{ij}}}^{\text{interaction}}}`);
formula('条件分段', String.raw`f(x)=\begin{cases}\displaystyle\frac{\sin x}{x},&x\ne0,\\[6pt]1,&x=0.\end{cases}`);
formula('化学反应', String.raw`\ce{2KMnO4 + 16HCl -> 2KCl + 2MnCl2 + 5Cl2 ^ + 8H2O}`);
formula('张量与量子力学', String.raw`\left\langle\psi\middle|\hat{H}\middle|\psi\right\rangle=`+terms(16,i=>String.raw`\sum_{\mu,\nu}\overline{c_{${i}\mu}}\,H_{\mu\nu}\,c_{${i}\nu}`));
sections.push('## 复杂行内公式', '前文保持在同一段落。$Q='+terms(32,i=>String.raw`\frac{a_{${i}}}{b_{${i}}}`)+'$ 后文也必须保留。',
  '## 千行观测表', `| 行号 | 数值 | 观测记录 |\n|---:|---:|---|\n`+Array.from({length:rows},(_,i)=>`| R${String(i+1).padStart(6,'0')} | ${((i+1)*.125).toFixed(3)} | 第 ${i+1} 次观测，边界记录 ${i===0?'FIRST':i===rows-1?'LAST':'CONT'} |`).join('\n'));
sections.push(`## ${columns} 列宽表`, '| 样本 | '+terms(columns-1,i=>'变量 '+i,' | ')+' |\n|'+Array.from({length:columns},()=>'---').join('|')+'|\n'+Array.from({length:120},(_,i)=>`| W${String(i+1).padStart(4,'0')} | `+terms(columns-1,j=>`V${i+1}C${j}`,' | ')+' |').join('\n'));
sections.push('## 单元格中的公式与链接', String.raw`| 项目 | 推导 | 来源 |
|---|---|---|
| 甲 | $a^2+b^2=c^2$ | [KaTeX](https://katex.org/) |
| 乙 | $F=`+terms(22,i=>String.raw`\frac{a_{${i}}}{1+b_{${i}}}`)+String.raw`$ | [Pandoc](https://pandoc.org/) |`,
  '## 特别高的一行', '| 名称 | 记录 |\n|---|---|\n| HIGHEST | '+Array.from({length:500},(_,i)=>`高行片段${i+1}`).join(' ')+' END-OF-TALL-CELL |',
  '## 合并单元格', '<table><thead><tr><th>项目</th><th>观测 A</th><th>观测 B</th></tr></thead><tbody><tr><td rowspan="2">共同来源</td><td>12.3</td><td>45.6</td></tr><tr><td colspan="2">合并结果保持完整</td></tr></tbody></table>',
  '## 代码与尾页', '```python\ndef energy(mass, c=299792458):\n    # 代码应有着色，文字可以复制\n    return mass * c ** 2\n```',
  '结束标记：END-OF-EXPORT-FIXTURE。最后一行必须出现在 PDF 中。');
fs.mkdirSync(path.dirname(destination), {recursive:true});
const text = sections.join('\n\n')+'\n'; fs.writeFileSync(destination, text);
console.log(JSON.stringify({destination,rows,columns,lines:text.split('\n').length,bytes:Buffer.byteLength(text)}));
