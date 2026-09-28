import { describe, expect, it } from 'vitest';
import katex from 'katex';
import { renderMathMarkup } from '../../src/features/editor-md/mathEngine';
import { clearKatexCache, renderMath } from '../../src/features/editor-md/mathRendering';

describe('inline formula source fidelity', () => {
  it.each([
    String.raw`\textbf{why}\\ \mathrm{L}`,
    String.raw`\textbf{why} \mathbf{L}`,
    String.raw`\textbf{why}\\[2pt] \mathrm{L}\\ \frac{a}{b}`,
    String.raw`\textbf{why}
\mathrm{L}`,
    String.raw`\frac{
  a+b
}{c+d}`,
    String.raw`\begin{aligned}a&=b+c\\d&=e+f\end{aligned}`,
  ])('passes complete macros and line breaks unchanged: %s', async source => {
    const expected = katex.renderToString(source, {
      displayMode: false, throwOnError: true, trust: false, strict: false, maxExpand: 1000, maxSize: 100,
    });
    const direct = await renderMathMarkup(source, false);
    expect(direct.error).toBeUndefined();
    expect(direct.html).toBe(expected);
    const host = document.createElement('span'); host.innerHTML = direct.html;
    expect(host.querySelector('annotation[encoding="application/x-tex"]')?.textContent).toBe(source);
    expect(await renderMath(source, false)).toEqual(direct);
  });

  it('retains explicit inline line breaks in rendered markup', async () => {
    const source = String.raw`\textbf{why}\\ \mathrm{L}\\ \mathbf{x}`;
    const result = await renderMathMarkup(source, false);
    const host = document.createElement('span'); host.innerHTML = result.html;
    expect(result.error).toBeUndefined();
    expect(host.querySelectorAll('.katex-html > .mspace.newline')).toHaveLength(2);
  });

  it('reports an incomplete macro and renders the repaired source independently', async () => {
    clearKatexCache();
    const incomplete = String.raw`\textbf{why\\ \mathrm{L}`;
    const complete = String.raw`\textbf{why}\\ \mathrm{L}`;
    expect((await renderMath(incomplete, false)).error).toContain("expected '}'");
    const result = await renderMath(complete, false);
    expect(result.error).toBeUndefined();
    expect(result.html).toContain('class="mspace newline"');
    expect((await renderMath(incomplete, false)).error).toContain("expected '}'");
  });

  it('explains the full-width closing brace in the reported formula without repairing its source', async () => {
    const source = String.raw`\textbf{why}\mathbf{L｝`;
    const result = await renderMathMarkup(source, false);
    expect(result.html).toBe('');
    expect(result.error).toContain('全角右花括号“｝”');
    expect(result.error).toContain('不能闭合半角左花括号“{”');
    expect(result.error).toContain("expected '}'");
    expect(result.error).toContain(String.raw`\mathbf{L｝`);
    expect((await renderMathMarkup(String.raw`\textbf{why}\mathbf{L}`, false)).error).toBeUndefined();
  });

  it('retains legitimate full-width text and does not blame it for another incomplete group', async () => {
    const source = String.raw`\text{中文｝}`;
    const result = await renderMathMarkup(source, false);
    expect(result.error).toBeUndefined();
    const host = document.createElement('span'); host.innerHTML = result.html;
    expect(host.querySelector('annotation')?.textContent).toBe(source);
    const otherError = await renderMathMarkup(source + String.raw` + \frac{x}{y`, false);
    expect(otherError.error).toContain("expected '}'");
    expect(otherError.error).not.toContain('全角右花括号');
  });

  it('does not diagnose full-width braces in comments or unrelated parse errors', async () => {
    const commented = await renderMathMarkup(String.raw`\mathbf{L % ｝`, false);
    expect(commented.error).toContain("expected '}'");
    expect(commented.error).not.toContain('全角右花括号');
    const unrelated = await renderMathMarkup(String.raw`\unknown{｝}`, false);
    expect(unrelated.error).toContain('Undefined control sequence');
    expect(unrelated.error).not.toContain('全角右花括号');
  });
});
