/** Presentation-only TeX reflow. This reader never expands macros: unsupported
 * syntax stays with the complete renderer. Work is bounded by source size and
 * nesting depth, independently of the number of possible line breaks. */
const MAX_SOURCE = 100_000;
const MAX_OUTPUT = 200_000;
const MAX_DEPTH = 32;
const MAX_WRAPS = 1_024;

interface Piece { tex: string; width: number; operator?: boolean; space?: boolean }
type Boundary = '}' | ')' | ']' | 'right' | 'cell' | 'eof' | `command:${string}`;
class Unsupported extends Error {}

const mathArguments: Readonly<Record<string, number>> = {
  frac: 2, dfrac: 2, tfrac: 2, binom: 2, dbinom: 2, tbinom: 2,
  overset: 2, underset: 2, stackrel: 2,
  mathrm: 1, mathit: 1, mathbf: 1, mathnormal: 1, mathcal: 1, mathbb: 1,
  mathfrak: 1, mathsf: 1, mathtt: 1, boldsymbol: 1, bm: 1,
  overline: 1, underline: 1, overbrace: 1, underbrace: 1,
  hat: 1, widehat: 1, bar: 1, vec: 1, tilde: 1, widetilde: 1,
  dot: 1, ddot: 1, breve: 1, check: 1, acute: 1, grave: 1,
  cancel: 1, bcancel: 1, xcancel: 1,
};
const opaqueArguments = new Set('text textrm textnormal textbf textit texttt textsf textsc operatorname phantom hphantom vphantom'.split(' '));
const environments = new Set('matrix pmatrix bmatrix Bmatrix vmatrix Vmatrix smallmatrix cases dcases rcases drcases aligned alignedat gathered split array'.split(' '));
const operators = new Set('pm mp cdot times div ast star circ bullet otimes odot oplus ominus le ge leq geq leqslant geqslant neq ne approx sim simeq cong equiv propto in notin ni subset supset subseteq supseteq cup cap land lor wedge vee to rightarrow leftarrow leftrightarrow Rightarrow Leftarrow Leftrightarrow implies iff'.split(' '));
const symbols = new Set(('alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi pi varpi rho varrho sigma varsigma tau upsilon phi varphi chi psi omega Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega ' +
  'sum prod coprod int iint iiint oint lim limsup liminf sin cos tan cot sec csc sinh cosh tanh log ln exp min max arg det gcd inf sup Pr ' +
  'infty partial nabla ell hbar imath jmath Re Im aleph beth emptyset varnothing forall exists nexists neg lnot top bot angle triangle prime ' +
  'ldots cdots vdots ddots dots dotsc dotsb dotsm dotsi dotso lvert rvert lVert rVert vert Vert langle rangle lceil rceil lfloor rfloor backslash').split(' '));
const spacing = new Set('quad qquad enspace thinspace medspace thickspace negthinspace negmedspace negthickspace'.split(' '));
const delimiters = new Set('langle rangle lceil rceil lfloor rfloor lbrace rbrace lvert rvert lVert rVert vert Vert backslash uparrow downarrow updownarrow Uparrow Downarrow Updownarrow'.split(' '));
const pairedDelimiters: Readonly<Record<string, string>> = { '{': '}', lbrace: 'rbrace', langle: 'rangle', lceil: 'rceil', lfloor: 'rfloor', lvert: 'rvert', lVert: 'rVert' };
const closingDelimiters = new Set(Object.values(pairedDelimiters));

class Reader {
  at = 0;
  wraps = 0;
  added = 0;
  constructor(private readonly source: string, private readonly budget: number) {}

  private fail(): never { throw new Unsupported(); }
  private depth(depth: number): void { if (depth > MAX_DEPTH) this.fail(); }
  private command(): string {
    if (this.source[this.at++] !== '\\' || this.at >= this.source.length) return this.fail();
    const start = this.at;
    if (/[A-Za-z]/.test(this.source[this.at])) while (/[A-Za-z]/.test(this.source[this.at] ?? '') && this.at < this.source.length) this.at++;
    else this.at++;
    return this.source.slice(start, this.at);
  }
  private commandAhead(name: string): boolean {
    return this.source.startsWith(`\\${name}`, this.at) && (!/[A-Za-z]$/.test(name) || !/[A-Za-z]/.test(this.source[this.at + name.length + 1] ?? ''));
  }
  private whitespace(): void { while (this.at < this.source.length && /\s/.test(this.source[this.at])) this.at++; }

  /** Read arguments whose syntax is deliberately opaque, still checking braces
   * and depth so an unsupported or pathological input cannot partially reflow. */
  private opaque(depth: number, open = '{', close = '}'): string {
    this.depth(depth);
    this.whitespace();
    if (this.source[this.at] !== open) return this.fail();
    const start = this.at++;
    let nested = 1, braces = 0;
    while (this.at < this.source.length) {
      const char = this.source[this.at++];
      if (char === '\\') { if (this.at >= this.source.length) this.fail(); this.at++; continue; }
      if (char === '%') this.fail();
      if (open !== '{') {
        if (char === '{') braces++;
        if (char === '}' && --braces < 0) this.fail();
        if (braces) { this.depth(depth + braces); continue; }
      }
      if (char === open) { nested++; this.depth(depth + nested - 1); }
      else if (char === close && --nested === 0) return this.source.slice(start, this.at);
    }
    return this.fail();
  }

  private argument(depth: number): Piece {
    const start = this.at;
    this.whitespace();
    if (this.source[this.at++] !== '{') return this.fail();
    const prefix = this.source.slice(start, this.at), body = this.sequence(depth + 1, '}');
    if (this.source[this.at++] !== '}') return this.fail();
    return { tex: prefix + body.tex + '}', width: body.width };
  }

  private delimiter(): void {
    this.whitespace();
    const char = this.source[this.at];
    if (char === '\\') {
      const name = this.command();
      if (!delimiters.has(name) && !'{}|'.includes(name)) this.fail();
    } else if (char && '()[]|./<>'.includes(char)) this.at++;
    else this.fail();
  }

  private environment(depth: number, start: number): Piece {
    const name = this.opaque(depth).slice(1, -1);
    if (!environments.has(name)) return this.fail();
    if (name === 'array' || name === 'alignedat') this.opaque(depth);
    let tex = this.source.slice(start, this.at), width = 0, rowWidth = 0;
    while (this.at < this.source.length) {
      const cell = this.sequence(depth + 1, 'cell');
      tex += cell.tex; rowWidth += cell.width;
      if (this.source[this.at] === '&') { tex += '&'; this.at++; rowWidth++; continue; }
      if (this.commandAhead('end')) {
        const endStart = this.at;
        this.command();
        if (this.opaque(depth).slice(1, -1) !== name) return this.fail();
        tex += this.source.slice(endStart, this.at);
        return { tex, width: Math.max(width, rowWidth) + 2 };
      }
      const rowStart = this.at, command = this.command();
      if (command !== '\\' && command !== 'cr') return this.fail();
      if (this.source[this.at] === '*') this.at++;
      const afterCommand = this.at;
      this.whitespace();
      if (this.source[this.at] === '[') this.opaque(depth, '[', ']');
      else this.at = afterCommand;
      tex += this.source.slice(rowStart, this.at);
      width = Math.max(width, rowWidth); rowWidth = 0;
    }
    return this.fail();
  }

  private atom(depth: number): Piece {
    const start = this.at, char = this.source[this.at];
    if (char === '{') return this.argument(depth);
    if (char === '(' || char === '[') {
      this.at++;
      const close = char === '(' ? ')' : ']', body = this.sequence(depth + 1, close);
      if (this.source[this.at++] !== close) return this.fail();
      return { tex: char + body.tex + close, width: body.width + 2 };
    }
    if (char === '^' || char === '_') {
      this.at++; this.whitespace();
      if (this.source[this.at] === '{') this.opaque(depth + 1);
      else if (this.source[this.at] === '\\') {
        const command = this.command();
        if (!symbols.has(command) && !operators.has(command)) this.fail();
      } else if (!this.source[this.at] || /[{}_^%&]/.test(this.source[this.at])) this.fail();
      else this.at++;
      return { tex: this.source.slice(start, this.at), width: this.at - start };
    }
    if (char === '\\') {
      const name = this.command();
      if (pairedDelimiters[name]) {
        const prefix = this.source.slice(start, this.at), closing = pairedDelimiters[name];
        const body = this.sequence(depth + 1, `command:${closing}`), endStart = this.at;
        if (!this.commandAhead(closing)) return this.fail();
        this.command();
        return { tex: prefix + body.tex + this.source.slice(endStart, this.at), width: body.width + 2 };
      }
      if (closingDelimiters.has(name) || name === 'vert' || name === 'Vert' || name === '|') return this.fail();
      if (name === 'begin') return this.environment(depth + 1, start);
      if (name === 'left') {
        this.delimiter();
        const prefix = this.source.slice(start, this.at), body = this.sequence(depth + 1, 'right'), endStart = this.at;
        if (!this.commandAhead('right')) return this.fail();
        this.command(); this.delimiter();
        return { tex: prefix + body.tex + this.source.slice(endStart, this.at), width: body.width + 2 };
      }
      if (name === 'sqrt') {
        const afterCommand = this.at;
        this.whitespace();
        if (this.source[this.at] === '[') this.opaque(depth + 1, '[', ']');
        else this.at = afterCommand;
        const prefix = this.source.slice(start, this.at), body = this.argument(depth);
        return { tex: prefix + body.tex, width: body.width + 2 };
      }
      if (name === 'textcolor') {
        this.opaque(depth + 1);
        const prefix = this.source.slice(start, this.at), body = this.argument(depth);
        return { tex: prefix + body.tex, width: body.width };
      }
      if (mathArguments[name]) {
        let tex = this.source.slice(start, this.at), width = 0;
        for (let n = 0; n < mathArguments[name]; n++) {
          const value = this.argument(depth); tex += value.tex; width = Math.max(width, value.width);
        }
        return { tex, width: width + (mathArguments[name] === 2 ? 2 : 0) };
      }
      if (opaqueArguments.has(name)) {
        if (name === 'operatorname' && this.source[this.at] === '*') this.at++;
        const body = this.opaque(depth + 1);
        return { tex: this.source.slice(start, this.at), width: body.length - 2 };
      }
      if (operators.has(name)) return { tex: this.source.slice(start, this.at), width: 1, operator: true };
      if (symbols.has(name)) return { tex: this.source.slice(start, this.at), width: 1 };
      if (spacing.has(name) || name === 'limits' || name === 'nolimits' || name === ' ' || ',;!:'.includes(name))
        return { tex: this.source.slice(start, this.at), width: 0, space: true };
      if (name.length === 1 && '{}%&#_$|'.includes(name)) return { tex: this.source.slice(start, this.at), width: 1 };
      // Unknown arity, assignments, styles and macro definitions are never
      // guessed. In particular, do not descend into an unknown macro's groups.
      return this.fail();
    }
    if ('})]%&|'.includes(char) || char === '$' || char === '#') return this.fail();
    if (/\s/.test(char)) {
      this.whitespace(); return { tex: this.source.slice(start, this.at), width: 0, space: true };
    }
    this.at++;
    return { tex: char, width: 1, operator: '+-=<>*×÷≤≥≠≈∼∈'.includes(char) };
  }

  sequence(depth: number, boundary: Boundary): Piece {
    this.depth(depth);
    const terms: Piece[] = [];
    let current: Piece = { tex: '', width: 0 }, canEnd = false;
    while (this.at < this.source.length) {
      if ((boundary === '}' || boundary === ')' || boundary === ']') && this.source[this.at] === boundary) break;
      if (boundary.startsWith('command:') && this.commandAhead(boundary.slice(8))) break;
      if (boundary === 'right' && this.commandAhead('right')) break;
      if (boundary === 'cell' && (this.source[this.at] === '&' || this.source.startsWith('\\\\', this.at) || this.commandAhead('cr') || this.commandAhead('end'))) break;
      const atom = this.atom(depth);
      if (atom.operator && canEnd) { terms.push(current); current = { tex: '', width: 0 }; }
      current.tex += atom.tex; current.width += atom.width;
      if (!atom.space) canEnd = !atom.operator;
    }
    if (boundary !== 'eof' && this.at === this.source.length) return this.fail();
    terms.push(current);
    const lines: Piece[] = [];
    let line: Piece = { tex: '', width: 0 };
    for (const term of terms) {
      // Keep a short leading label/coefficient with its operand (R=, 1+sqrt…)
      // instead of creating a nearly empty first row. Real geometry decides fit.
      if (line.tex && line.width > Math.min(4, this.budget / 4) && line.width + term.width > this.budget) { lines.push(line); line = { tex: '', width: 0 }; }
      line.tex += term.tex; line.width += term.width;
    }
    lines.push(line);
    if (lines.length === 1) return lines[0];
    if (++this.wraps > MAX_WRAPS) return this.fail();
    const tex = `\\begin{gathered}${lines.map(value => value.tex).join('\\\\')}\\end{gathered}`;
    this.added += 30 + (lines.length - 1) * 2;
    if (this.source.length + this.added > MAX_OUTPUT) return this.fail();
    return { tex, width: Math.max(...lines.map(value => value.width)) };
  }
}

/** Return one conservative layout candidate, or null when no safe change can
 * be made. characterBudget is an approximate source-character width; callers
 * must measure the rendered candidate before selecting it. Limits: 100k input
 * characters, 200k output characters, 32 nested structures and 1024 wraps. */
export function reflowMathSource(latex: string, characterBudget: number): string | null {
  if (!latex || latex.length > MAX_SOURCE || !Number.isFinite(characterBudget) || characterBudget < 1) return null;
  if (/\\(?:def|gdef|edef|xdef|let|futurelet|global|newcommand|renewcommand|providecommand|color|displaystyle|textstyle|scriptstyle|scriptscriptstyle|hline|hdashline|cline)\b/.test(latex)) return null;
  const reader = new Reader(latex, Math.floor(characterBudget));
  try {
    const result = reader.sequence(0, 'eof');
    return reader.wraps && result.tex.length <= MAX_OUTPUT ? result.tex : null;
  } catch (error) {
    if (error instanceof Unsupported) return null;
    throw error;
  }
}
