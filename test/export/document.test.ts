import { expect, it } from 'vitest';
import { renderDocument } from '../../src/features/export/renderDocument';
import { pandocSource } from '../../src/features/export/pandocDocument';

it('导出使用相同公式语法、提示块和可重复表头，排除编辑控件', async () => {
  const markdown = '# Report\n\n> [!IMPORTANT]\n> 正文 $ x^2 $\n\n\\[\\begin{pmatrix}1&2\\\\[2pt]3&4\\end{pmatrix}\\]\n\n| A | B |\n| - | - |\n| 1 | 2 |';
  const result = await renderDocument(markdown + '\n\n- [x] 已完成\n- [ ] 待完成', 'Report', '');
  const root = document.createElement('div'); root.innerHTML = result.html;
  expect(root.querySelectorAll('.katex').length).toBe(2);
  expect(root.querySelector('.github-alert-important svg')).not.toBeNull();
  expect(root.querySelector('thead th')?.textContent).toBe('A');
  expect(root.querySelector('textarea,button,input')).toBeNull();
  expect(root.querySelectorAll('.export-task-check')).toHaveLength(2);
  const ast = pandocSource(markdown);
  expect(ast).toContain('InlineMath'); expect(ast).toContain('DisplayMath');
  expect(ast).toContain('pmatrix'); expect(ast).toContain('Important');
});
