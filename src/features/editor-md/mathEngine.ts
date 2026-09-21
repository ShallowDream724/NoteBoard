import type { MathRendering } from './mathRendering';

let loading: Promise<typeof import('katex')> | undefined;
let chemistry: Promise<unknown> | undefined;

/** DOM-free renderer, shared by the worker and non-worker test environments. */
export async function renderMathMarkup(latex: string, displayMode: boolean): Promise<MathRendering> {
  try {
    loading ??= import('katex').catch(error => { loading = undefined; throw error; });
    const katex = await loading;
    if (/\\(?:ce|pu)\s*\{/.test(latex)) {
      chemistry ??= import('katex/contrib/mhchem').catch(error => { chemistry = undefined; throw error; });
      await chemistry;
    }
    return { html: katex.renderToString(latex, {
      displayMode, throwOnError: true, trust: false, strict: false, maxExpand: 1000, maxSize: 100,
    }) };
  } catch (error) {
    return { html: '', error: error instanceof Error ? error.message.replace(/^KaTeX parse error: /, '') : '公式暂时无法排版' };
  }
}
