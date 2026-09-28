import type { MathRendering } from './mathRendering';
import { checkMathMarkup, checkMathSource } from './mathLimits';
import { mathSourceErrorHint } from './mathDiagnostics';

let loading: Promise<typeof import('katex')> | undefined;
let chemistry: Promise<unknown> | undefined;

/** DOM-free renderer, shared by the worker and non-worker test environments. */
export async function renderMathMarkup(latex: string, displayMode: boolean): Promise<MathRendering> {
  const refused = checkMathSource(latex); if (refused) return refused;
  try {
    loading ??= import('katex').catch(error => { loading = undefined; throw error; });
    const katex = await loading;
    if (/\\(?:ce|pu)\s*\{/.test(latex)) {
      chemistry ??= import('katex/contrib/mhchem').catch(error => { chemistry = undefined; throw error; });
      await chemistry;
    }
    const html = katex.renderToString(latex, {
      displayMode, throwOnError: true, trust: false, strict: false, maxExpand: 1000, maxSize: 100,
    });
    // Reject oversized markup here, before a Worker posts it or export parses it.
    return checkMathMarkup(html) ?? { html };
  } catch (error) {
    const detail = error instanceof Error ? error.message.replace(/^KaTeX parse error: /, '') : '公式暂时无法排版';
    const hint = mathSourceErrorHint(latex, detail);
    const message = hint ? `${hint}\n${detail}` : detail;
    return { html: '', error: message.length > 512 ? message.slice(0, 512) + '…' : message };
  }
}
