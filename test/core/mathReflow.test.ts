import { describe, expect, it } from 'vitest';
import katex from 'katex';
import { reflowMathSource } from '../../src/core/math/reflow';

const sum = (letter: string, count = 12) => Array.from({ length: count }, (_, index) => `${letter}_{${index}}^2`).join('+');
const unwrap = (source: string) => source.replace(/\\begin\{gathered\}|\\end\{gathered\}|\\\\/g, '');
function candidate(source: string, budget = 24): string {
  const result = reflowMathSource(source, budget);
  expect(result).not.toBeNull();
  expect(() => katex.renderToString(result!, { throwOnError: true, displayMode: true })).not.toThrow();
  return result!;
}

describe('conservative structured math reflow', () => {
  it('wraps both fraction arguments and retains all operands and their order', () => {
    const source = `R=\\frac{${sum('a')}}{${sum('b')}}`;
    const result = candidate(source);
    expect(result).toContain(String.raw`\frac{\begin{gathered}`);
    expect(result).toContain(String.raw`\end{gathered}}{\begin{gathered}`);
    expect(unwrap(result)).toBe(source);
  });

  it('recurses through nested fractions, roots and paired delimiters', () => {
    const source = `\\frac{\\sqrt[3]{\\left(${sum('a')}\\right)}}{(${sum('b')}+\\frac{${sum('c')}}{${sum('d')}})}`;
    const result = candidate(source);
    expect(result).toContain(String.raw`\sqrt[3]{\left(\begin{gathered}`);
    expect(result).toContain(String.raw`{(\begin{gathered}`);
    expect(result.match(/\\begin\{gathered\}/g)!.length).toBeGreaterThanOrEqual(4);
    expect(unwrap(result)).toBe(source);
  });

  it('supports known mathematical arguments without rewriting color names or text', () => {
    const source = `\\textcolor{red}{\\mathbf{${sum('a')}}}+\\overset{${sum('b')}}{\\underset{${sum('c')}}{x}}+\\text{a+b-c}+\\operatorname{a+b}`;
    const result = candidate(source);
    expect(result).toContain(String.raw`\textcolor{red}{\mathbf{\begin{gathered}`);
    expect(result).toContain(String.raw`\text{a+b-c}`);
    expect(result).toContain(String.raw`\operatorname{a+b}`);
    expect(unwrap(result)).toBe(source);
    expect(reflowMathSource(String.raw`\text{a+b+c+d+e}`, 2)).toBeNull();
  });

  it('retains unary signs and opaque subscript/superscript arguments', () => {
    const source = String.raw`-x_{-i}^{a+b+c}+y^-2+-z+w_{i+1}-q`;
    const result = candidate(source, 12);
    expect(result).toContain(String.raw`x_{-i}^{a+b+c}`);
    expect(result).toContain(String.raw`y^-2`);
    expect(result).not.toContain(String.raw`+\\-z`);
    expect(unwrap(result)).toBe(source);
    expect(reflowMathSource(String.raw`x^{a+b+c+d+e}`, 2)).toBeNull();
  });

  it('can continue relations and explicit multiplication while preserving operators', () => {
    for (const source of [String.raw`a=b=c=d=e=f=g`, String.raw`aaaa\cdot bbbb\times cccc\cdot dddd`, 'aaaa*bbbb*cccc']) {
      expect(unwrap(candidate(source, 8))).toBe(source);
    }
  });

  it('keeps explicitly paired braces, angle brackets and absolute-value delimiters around their contents', () => {
    for (const [open, close] of [[String.raw`\{`, String.raw`\}`], [String.raw`\langle`, String.raw`\rangle`], [String.raw`\lvert`, String.raw`\rvert`]]) {
      const source = `${open} ${sum('a')} ${close}`;
      const result = candidate(source);
      expect(result).toContain(`${open}\\begin{gathered}`);
      expect(unwrap(result)).toBe(source);
    }
    expect(reflowMathSource('|a+b+c+d|', 2)).toBeNull();
    expect(reflowMathSource(String.raw`\vert a+b+c+d\vert`, 2)).toBeNull();
  });

  it('reflows cells without moving matrix columns, rows or optional row gaps', () => {
    const first = sum('a'), second = sum('b');
    const source = `\\begin{bmatrix}${first}&2\\\\[2pt]\\sqrt{${second}}&\\begin{matrix}1&2\\\\3&4\\end{matrix}\\end{bmatrix}`;
    const result = candidate(source);
    expect(result).toContain(String.raw`\end{gathered}&2\\[2pt]\sqrt{`);
    expect(result).toContain(String.raw`&\begin{matrix}1&2\\3&4\end{matrix}`);
    // Generated continuations remain inside cell groups; original separators
    // and the original nested matrix are preserved byte for byte.
    expect(result.replace(/\\begin\{gathered\}[\s\S]*?\\end\{gathered\}/g, 'CELL')).toBe(
      String.raw`\begin{bmatrix}CELL&2\\[2pt]\sqrt{CELL}&\begin{matrix}1&2\\3&4\end{matrix}\end{bmatrix}`,
    );
  });

  it('supports cases, aligned, arrays and existing gathered rows', () => {
    for (const source of [
      `\\begin{cases}${sum('a')}&x>0\\\\${sum('b')}&x\\le0\\end{cases}`,
      `\\begin{aligned}f(x)&=${sum('a')}\\\\g(x)&=${sum('b')}\\end{aligned}`,
      `\\begin{array}{cc}${sum('a')}&2\\\\3&4\\end{array}`,
      `\\begin{gathered}${sum('a')}\\\\${sum('b')}\\end{gathered}`,
    ]) candidate(source);
  });

  it('leaves unknown commands, environments, definitions and stateful syntax to the full renderer', () => {
    for (const source of [
      String.raw`\frac{\unknown{a+b+c+d}+e}{x}`,
      String.raw`\begin{unknown}a+b+c+d\end{unknown}`,
      String.raw`\def\a{x}a+b+c+d`,
      String.raw`\color{red}a+b+c+d`,
      String.raw`\displaystyle a+b+c+d`,
      String.raw`a+b+c+d\tag{a+b}`,
      String.raw`\left(a+b\middle|c+d\right)`,
      'a+b% comment\nc+d',
    ]) expect(reflowMathSource(source, 2)).toBeNull();
  });

  it('returns null for atomic, malformed or over-budget structures', () => {
    for (const source of ['abcdefghijklmnopqrstuvwxyz', String.raw`\frac{a+b+c}{d`, '(a+b+c', '[a+b+c)', String.raw`\left(a+b+c`, String.raw`\begin{matrix}a+b\end{cases}`, '{'.repeat(40) + 'a+b+c' + '}'.repeat(40), 'x'.repeat(100_001)]) {
      expect(reflowMathSource(source, 2)).toBeNull();
    }
    for (const budget of [0, -1, NaN, Infinity]) expect(reflowMathSource('a+b+c', budget)).toBeNull();
    expect(reflowMathSource('a+b', 10)).toBeNull();
  });
});
