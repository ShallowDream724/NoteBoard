import { expect, it } from 'vitest';
import { matrixPart, matrixSource } from '../../src/core/math/structure';
import { pandocSource } from '../../src/features/export/pandocDocument';
import { renderDocument } from '../../src/features/export/renderDocument';

it('matrix tiles preserve cell separators after TeX comments and retain escaped percent', () => {
  const source = matrixSource(String.raw`\begin{pmatrix}a% ignore & and \\ and \def
&b\\c\%&d% last comment
\end{pmatrix}`)!;
  expect(source.rows).toEqual([['a', 'b'], [String.raw`c\%`, 'd']]);
  expect(matrixPart(source, 0, 2, 0, 2)).toBe(String.raw`\begin{pmatrix}a&b\\c\%&d\end{pmatrix}`);
});

it('Pandoc table colspec covers logical columns occupied by spans', () => {
  const source = '<table><tr><td rowspan="2" colspan="2"><p>A</p></td><td><p>B</p></td></tr><tr><td><p>C</p></td></tr></table>';
  const ast = JSON.parse(pandocSource(source)) as { blocks: Array<{ t: string; c: unknown[] }> };
  const table = ast.blocks.find(block => block.t === 'Table')!;
  expect(table.c[2]).toHaveLength(3);
  expect(JSON.stringify(table)).toContain('"C"');
});

it('Pandoc highlight spans retain safe explicit and default background colors', () => {
  const source = pandocSource('<mark data-color="#ff66aa">colored</mark> and ==default==');
  expect(source).toContain('background-color: #ff66aa');
  expect(source).toContain('["data-color","#ff66aa"]');
  expect(source).toContain('background-color: #ffff00');
});

it('asset relocation changes only image source attributes and keeps marker-looking prose and code', async () => {
  const input = 'noteboard-export-asset:0\n\n```\nnoteboard-export-asset:0\n```\n\n![noteboard-export-asset:0](images/a.png)';
  const paths: string[] = [];
  const output = await renderDocument(input, 'assets', 'C:/docs', undefined, undefined, undefined, async assets => {
    paths.push(...assets); return assets.map(path => 'asset:' + path);
  });
  const root = document.createElement('div'); root.innerHTML = output.html;
  expect(root.querySelector('p')?.textContent).toBe('noteboard-export-asset:0');
  expect(root.querySelector('code')?.textContent).toBe('noteboard-export-asset:0');
  expect(paths).toEqual(['C:\\docs\\images\\a.png']);
  expect(root.querySelector('img')?.getAttribute('src')).toBe('asset:C:\\docs\\images\\a.png');
  expect(root.querySelector('img')?.getAttribute('alt')).toBe('noteboard-export-asset:0');
});
