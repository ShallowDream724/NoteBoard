import { describe, expect, it } from 'vitest';
import cases from '../fixtures/math/academic-math.json';
import { checkMathMarkup, checkMathSource, MATH_LIMITS } from '../../src/features/editor-md/mathLimits';
import { renderMathMarkup } from '../../src/features/editor-md/mathEngine';

describe('formula admission budgets', () => {
  it('rejects oversized input before KaTeX and bounds lexical group depth', async () => {
    expect(checkMathSource('x'.repeat(MATH_LIMITS.inputCharacters))).toBeUndefined();
    expect(await renderMathMarkup('x'.repeat(MATH_LIMITS.inputCharacters + 1), true)).toMatchObject({ html: '', limited: 'input' });
    expect(checkMathSource('{'.repeat(MATH_LIMITS.groupDepth + 1))).toMatchObject({ limited: 'depth' });
    expect(checkMathSource('\\{'.repeat(80) + '% ' + '{'.repeat(80))).toBeUndefined();
  });

  it('counts DOM nodes independently of markup size before native HTML parsing', () => {
    expect(checkMathMarkup('x'.repeat(MATH_LIMITS.markupCharacters + 1))).toMatchObject({ html: '', limited: 'markup' });
    const manySmallNodes = '<i>x</i>'.repeat(MATH_LIMITS.domNodes / 2 + 1);
    expect(manySmallNodes.length).toBeLessThan(MATH_LIMITS.markupCharacters);
    expect(checkMathMarkup(manySmallNodes)).toMatchObject({ html: '', limited: 'nodes' });
    expect(checkMathMarkup('<span><math><mi>x</mi></math></span>')).toBeUndefined();
  });

  it('rejects amplification in actual rendered output without returning a partial formula', async () => {
    const latex = '\\frac{x}{y}+'.repeat(120) + 'z';
    expect(latex.length).toBeLessThan(MATH_LIMITS.inputCharacters);
    const result = await renderMathMarkup(latex, true);
    expect(result.limited).toBeDefined(); expect(result.html).toBe(''); expect(result.error).toContain('完整源码');
  });

  it('keeps the existing academic corpus below the limits', async () => {
    for (const sample of cases) {
      const result = await renderMathMarkup(sample.latex, true);
      expect(result.limited, sample.id + ' ' + sample.title).toBeUndefined();
    }
  });
});
