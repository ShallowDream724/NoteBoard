import type { JSONContent } from '@tiptap/core';
import { isDisplayMath, readMath } from '../mathSyntax';

/** Read one semantic formula, never the duplicate visual/accessible KaTeX trees. */
export function clipboardMathElement(element: Element): JSONContent | null {
  const tag = element.tagName.toUpperCase(), classes = element.classList;
  const ownInline = element.hasAttribute('data-math-inline'), ownBlock = element.hasAttribute('data-math-block');
  const script = tag === 'SCRIPT' && /^math\/tex(?:\s*;|$)/i.test(element.getAttribute('type') ?? '');
  const rendered = tag === 'MATH' || classes.contains('katex') || classes.contains('katex-display');
  if (!ownInline && !ownBlock && !script && !rendered) return null;
  const latex = ownInline || ownBlock ? element.getAttribute('latex') ?? element.getAttribute('data-latex')
    : script ? element.textContent : Array.from(element.querySelectorAll('annotation')).find(node => /^application\/x-(?:tex|latex)$/i.test(node.getAttribute('encoding')?.trim() ?? ''))?.textContent;
  if (latex == null) return null;
  const block = ownBlock || classes.contains('katex-display') || element.getAttribute('display') === 'block'
    || script && /mode\s*=\s*display/i.test(element.getAttribute('type') ?? '');
  const rawDelimiter = element.getAttribute('delimiter');
  const delimiter = block ? rawDelimiter === '\\[' ? '\\[' : '$$' : rawDelimiter === '\\(' ? '\\(' : '$';
  return { type: block ? 'mathBlock' : 'mathInline', attrs: { latex, delimiter } };
}

/** Parse only adjacent ordinary text; preserve its marks and all non-math nodes.
 * HTML can split a delimiter/payload across styled spans. Code and links form
 * hard boundaries. Work stays linear even for repeated unclosed delimiters. */
export function clipboardTextMath(content: JSONContent[]): JSONContent[] {
  const output: JSONContent[] = []; let run: JSONContent[] = [];
  const flush = () => {
    if (!run.some(node => /[\\$]/.test(node.text ?? ''))) { for (const node of run) output.push(node); run = []; return; }
    const pieces = run.map(node => node.type === 'hardBreak' ? '\n' : node.text ?? '');
    const source = pieces.join(''), budget = { remaining: source.length * 4 };
    const candidates = /\\[([]|\${1,2}/g;
    let index = 0, offset = 0, within = 0;
    const advance = (end: number, emit: boolean) => {
      while (offset < end && index < run.length) {
        const length = Math.min(end - offset, pieces[index].length - within);
        if (emit && length) output.push(run[index].type === 'hardBreak' ? run[index] : { ...run[index], text: pieces[index].slice(within, within + length) });
        offset += length; within += length;
        if (within === pieces[index].length) { index++; within = 0; }
      }
    };
    let candidate: RegExpExecArray | null;
    while (budget.remaining > 0 && (candidate = candidates.exec(source))) {
      const match = readMath(source, candidate.index, false, budget); if (!match) continue;
      advance(match.start, true);
      const display = isDisplayMath(match.delimiter), marks = run[index]?.marks;
      output.push({ type: display ? 'mathBlock' : 'mathInline', attrs: { latex: display ? match.latex.trim() : match.latex, delimiter: match.delimiter }, ...(!display && marks?.length ? { marks } : {}) });
      advance(match.end, false); candidates.lastIndex = match.end;
    }
    advance(source.length, true); run = [];
  };
  for (const node of content) {
    if ((node.type === 'text' || node.type === 'hardBreak') && !node.marks?.some(mark => mark.type === 'code' || mark.type === 'link')) run.push(node);
    else { flush(); output.push(node); }
  }
  flush(); return output;
}
