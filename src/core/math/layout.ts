import { reflowMathSource } from './reflow';

/** Measure TeX groups, excluding alignment whitespace and invisible vlist struts. */
export function mathContentWidth(element: HTMLElement): number {
  let left = Infinity, right = -Infinity;
  for (const child of element.children) {
    if (!child.classList.contains('base') && !child.classList.contains('tag')) continue;
    const box = child.getBoundingClientRect();
    left = Math.min(left, box.left); right = Math.max(right, box.right);
  }
  return Number.isFinite(left) ? right - left : element.getBoundingClientRect().width;
}

export interface MathMarkup { html: string; error?: string }
/** Shared screen/print candidate policy. Source is immutable; render admission,
 * cancellation and residency remain the consumer's responsibility. Two bounded
 * attempts are measured against the real font/layout, not source length alone. */
export async function reflowMathToWidth(options: {
  element: HTMLElement; latex: string; available: number; fontPixels: number;
  render: (source: string) => Promise<MathMarkup | null>;
  apply?: (result: MathMarkup) => boolean;
  current?: () => boolean;
}): Promise<boolean> {
  const { element, latex, available, fontPixels, render } = options;
  const budget = Math.max(12, Math.floor(available / (fontPixels * .55)));
  let previous = '';
  for (const factor of [1, .6]) {
    if (options.current && !options.current()) return false;
    const candidate = reflowMathSource(latex, Math.round(budget * factor));
    if (!candidate || candidate === previous) continue;
    previous = candidate;
    const result = await render(candidate);
    if (!result || result.error || options.current && !options.current()) continue;
    if (options.apply) { if (!options.apply(result)) return false; }
    else element.innerHTML = result.html;
    const math = element.querySelector<HTMLElement>('.katex-html');
    if (math && mathContentWidth(math) <= available + 1) return true;
  }
  return false;
}
