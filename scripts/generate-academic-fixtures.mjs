import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const output = path.resolve(process.argv[2] ?? 'test/fixtures/generated');
await mkdir(output, { recursive: true });
const cases = JSON.parse(await readFile(new URL('../test/fixtures/math/academic-math.json', import.meta.url), 'utf8'));
const lines = ['# 学术公式兼容性图册', '',
  '每个案例提供 LaTeX 源码与定界符对照。行内公式应与正文同行；显示公式应独立居中。',
  '颜色、字体和精确行距仍需目视确认。兼容边界案例只展示源码，避免把不支持的命令误当成功。', ''];
let group;
for (const sample of cases) {
  if (group !== sample.group) { group = sample.group; lines.push('## ' + group, ''); }
  lines.push('### ' + sample.id + ' ' + sample.title, '', '```latex', sample.latex, '```', '');
  if (!sample.supported) { lines.push('兼容边界：当前排版器不支持此写法。', ''); continue; }
  if (!sample.displayOnly) {
    lines.push('美元行内：前文 $' + sample.latex + '$ 后文。', '',
      '括号行内：前文 \\(' + sample.latex + '\\) 后文。', '');
  }
  lines.push('美元显示：', '', '$$', sample.latex, '$$', '',
    '方括号显示：', '', '\\[', sample.latex, '\\]', '');
}
lines.push('## 空白与代码边界', '');
for (const [open, close] of [['$', '$'], ['\\(', '\\)'], ['$$', '$$'], ['\\[', '\\]']]) {
  for (const pad of ['', ' ', '  ']) {
    const formula = open + pad + 'x+y' + pad + close;
    lines.push('`' + formula + '`', '', '前文 ' + formula + ' 后文。', '');
  }
}
lines.push('代码应保持字面内容：`\\(x\\)`、`\\[x\\]`、`$x$`。', '',
  '```latex', '\\[', '\\begin{pmatrix}1&2\\\\[2pt]3&4\\end{pmatrix}', '\\]', '```', '');

const files = [];
async function save(name, text) {
  const bytes = Buffer.from(text);
  await writeFile(path.join(output, name), bytes);
  files.push({ name, lines: text.split('\n').length, bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex') });
}
await save('NoteBoard-math-atlas.md', lines.join('\n'));
if (process.argv.includes('--large')) {
  for (const profile of ['prose', 'formulas', 'unclosed-code']) {
    const content = Array.from({ length: 100_000 }, (_, i) => {
      if (profile === 'unclosed-code') return i === 0 ? '```text' : '原始数据 ' + i + ' | \\\\[2pt] | **literal** | x'.repeat(2);
      if (i % 100 === 0) return '## 第 ' + (i / 100 + 1) + ' 节';
      if (i % 5 === 0) return '';
      if (profile === 'formulas') return '推导 ' + i + '：\\(E=mc^2\\)，$ x_{i+1}=x_i+1 $，\\[\\boxed{a^2+b^2=c^2}\\]。';
      return '段落 ' + i + '：这是用于检验长文档打开、编辑、搜索和保存的正文。每一行都具有可识别的编号。';
    }).join('\n');
    await save('NoteBoard-100k-' + profile + '.md', content);
  }
}
await writeFile(path.join(output, 'fixtures-manifest.json'), JSON.stringify({ cases: cases.length, files }, null, 2) + '\n');
console.log(JSON.stringify({ output, cases: cases.length, files }, null, 2));
