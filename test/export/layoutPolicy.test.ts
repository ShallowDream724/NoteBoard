import { describe, expect, it } from 'vitest';
import katex from 'katex';
import { planMath, planTableColumns } from '../../src/features/export/layoutPolicy';
import { matrixPart, matrixSource, MAX_MATRIX_CELLS } from '../../src/core/math/structure';
import { reflowMathSource } from '../../src/core/math/reflow';

describe('print layout policy', () => {
  it('keeps natural width and balances continuation columns without losing their order', () => {
    const natural = planTableColumns([40, 60, 150], 700, .8)!;
    expect(natural.scale).toBe(1); expect(natural.bands).toEqual([{ from: 1, to: 3 }]);
    const widths = [65, ...Array(11).fill(125)];
    const plan = planTableColumns(widths, 703, 1)!;
    expect(plan.scale).toBe(1);
    expect(plan.bands.flatMap(band => Array.from({ length: band.to - band.from }, (_, i) => band.from + i))).toEqual(Array.from({ length: 11 }, (_, i) => i + 1));
    expect(Math.max(...plan.bands.map(b => b.to - b.from)) - Math.min(...plan.bands.map(b => b.to - b.from))).toBeLessThanOrEqual(1);
    for (const band of plan.bands) expect(widths[0] + widths.slice(band.from, band.to).reduce((a, b) => a + b)).toBeLessThanOrEqual(703);
  });
  it('combines readable scaling and splitting, refusing an indivisible column beyond the floor', () => {
    const plan = planTableColumns([50, ...Array(30).fill(80)], 700, .8)!;
    expect(plan.scale).toBeGreaterThanOrEqual(.8);
    expect(plan.bands.length).toBeGreaterThan(1);
    expect(planTableColumns([500, 800], 700, .8)).toBeNull();
  });
  it('wraps at normal size, shrinks atomic content only within the readability floor', () => {
    const base = { width: 1800, height: 30, wrappedWidth: 600, wrappedHeight: 100, availableWidth: 700, availableHeight: 1000, minimumScale: .8 };
    expect(planMath(base)).toEqual({ wrap: true, scale: 1, readable: true });
    expect(planMath({ ...base, width: 800, wrappedWidth: 800, wrappedHeight: 30 }).readable).toBe(true);
    expect(planMath({ ...base, wrappedWidth: 1800 }).readable).toBe(false);
  });
});

describe('structured formula continuation', () => {
  it('keeps nested environments, escaped delimiters, row spacing and empty cells', () => {
    const source = matrixSource(String.raw`A=\begin{bmatrix}\text{a\&b}&\begin{matrix}1&2\\3&4\end{matrix}\\[2pt]5\end{bmatrix}`)!;
    expect(source.rows).toHaveLength(2); expect(source.columns).toBe(2);
    expect(source.rows[0][0]).toBe(String.raw`\text{a\&b}`);
    expect(matrixPart(source, 1, 2, 0, 2)).toBe(String.raw`\begin{bmatrix}5&\end{bmatrix}`);
    expect(matrixPart(source, 0, 2, 0, 2)).toContain(String.raw`\\[2pt]`);
    expect(() => katex.renderToString(matrixPart(source, 0, 2, 0, 2), { throwOnError: true })).not.toThrow();
  });
  it('does not tile a matrix used as an operand and stops oversized inputs before rendering', () => {
    expect(matrixSource(String.raw`B\begin{bmatrix}1&2\end{bmatrix}`)).toBeNull();
    expect(matrixSource(String.raw`\begin{vmatrix}1&2\\3&4\end{vmatrix}`)).toBeNull();
    expect(matrixSource(String.raw`\begin{matrix}\color{red}x&y\end{matrix}`)).toBeNull();
    expect(() => matrixSource('\\begin{matrix}' + 'x&'.repeat(MAX_MATRIX_CELLS) + 'x\\end{matrix}')).toThrow('单元格');
  });
  it('wraps numerator and denominator independently while retaining every term', () => {
    const numerator = Array.from({ length: 30 }, (_, i) => `a_{${i}}^2`).join('+');
    const denominator = Array.from({ length: 30 }, (_, i) => `b_{${i}}^2`).join('+');
    const source = `R=\\frac{${numerator}}{${denominator}}`;
    const result = reflowMathSource(source, 45)!;
    expect(result.match(/begin\{gathered\}/g)!.length).toBeGreaterThanOrEqual(2);
    expect(result.replace(/\\begin\{gathered\}|\\end\{gathered\}|\\\\/g, '')).toBe(source);
    expect(() => katex.renderToString(result, { throwOnError: true })).not.toThrow();
    expect(reflowMathSource(String.raw`\frac{\unknown{x+y}+z}{d}`, 3)).toBeNull();
  });
});
