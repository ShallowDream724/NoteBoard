import { afterEach, expect, it, vi } from 'vitest';
import { continueMatrix } from '../../src/features/export/mathLayout';
import { renderDocument } from '../../src/features/export/renderDocument';
import { renderMath } from '../../src/features/editor-md/mathRendering';

vi.mock('../../src/features/editor-md/mathRendering', () => ({ renderMath: vi.fn() }));
const originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts');
afterEach(() => {
  vi.mocked(renderMath).mockReset();
  if (originalFonts) Object.defineProperty(document, 'fonts', originalFonts); else Reflect.deleteProperty(document, 'fonts');
});
function matrix(latex: string) {
  Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: Promise.resolve() } });
  const element = document.createElement('div'); element.dataset.latex = latex; element.dataset.matrixPreview = 'true';
  return element;
}

it('splits a limited candidate before mounting its markup', async () => {
  vi.mocked(renderMath).mockImplementation(async latex => latex.includes('&')
    ? { html: '<b id="rejected-markup">oversized</b>', error: 'budget', limited: 'nodes' }
    : { html: '<span class="katex-html">cell</span>' });
  const element = matrix(String.raw`\begin{matrix}a&b\end{matrix}`);
  const result = await continueMatrix(element, 1000, 1000, 10.5, false);
  expect(result).toEqual({ handled: true, issue: undefined });
  expect(element.querySelector('#rejected-markup')).toBeNull();
  expect(element.querySelectorAll('.math-continuation-part')).toHaveLength(2);
  expect(renderMath).toHaveBeenCalledTimes(3);
});

it('reports an indivisible budget-limited cell as explicit missing content', async () => {
  vi.mocked(renderMath).mockResolvedValue({ html: '', error: 'budget', limited: 'depth' });
  const element = matrix(String.raw`\begin{matrix}a\end{matrix}`);
  const result = await continueMatrix(element, 1000, 1000, 10.5, false);
  expect(result.handled).toBe(true);
  expect(result.issue).toContain('超出排版预算，未完整显示');
  expect(element.textContent).toContain('第 1–1 行、第 1–1 列');
});

it('routes a limited full matrix to continuation without marking a syntax error', async () => {
  const rendered = await renderDocument(String.raw`$$\begin{matrix}a&b\end{matrix}$$`, 'matrix', '', undefined, undefined,
    async () => ({ html: '', error: 'budget', limited: 'markup' }));
  const root = document.createElement('div'); root.innerHTML = rendered.html;
  expect(root.querySelector('[data-matrix-preview="true"]')).not.toBeNull();
  expect(root.querySelector('[data-render-error]')).toBeNull();
});
