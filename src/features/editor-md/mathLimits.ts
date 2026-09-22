/** UTF-16 source/markup units, as used by JS strings. These are admission limits
 * for one render, not truncation points or document-storage limits. */
export const MATH_LIMITS = {
  inputCharacters: 16_384,
  markupCharacters: 262_144,
  domNodes: 4_096,
  groupDepth: 64,
  workerMilliseconds: 2_000,
  matrixSourceCharacters: 200_000,
  matrixViewportCells: 4_096,
  matrixViewportNodes: 16_384,
} as const;
export type MathLimitReason = 'input' | 'depth' | 'markup' | 'nodes' | 'time';
export interface MathLimitFailure { html: ''; error: string; limited: MathLimitReason }
export function mathLimitFailure(limited: MathLimitReason): MathLimitFailure {
  const reason = limited === 'depth' ? '公式嵌套过深' : limited === 'time' ? '公式排版超时' : limited === 'input' ? '公式源码过长' : '公式排版结果过大';
  return { html: '', error: `${reason}，已保留完整源码，请拆分或简化后重试。`, limited };
}

/** O(min(source length, admitted limit)); no substring copy or TeX expansion. */
export function checkMathSource(latex: string, maximum: number = MATH_LIMITS.inputCharacters): MathLimitFailure | undefined {
  if (latex.length > maximum) return mathLimitFailure('input');
  let depth = 0;
  for (let at = 0; at < latex.length; at++) {
    const character = latex[at];
    if (character === '\\') { at++; continue; }
    if (character === '%') { const end = latex.indexOf('\n', at); at = end < 0 ? latex.length : end; continue; }
    if (character === '{' && ++depth > MATH_LIMITS.groupDepth) return mathLimitFailure('depth');
    if (character === '}') depth = Math.max(0, depth - 1);
  }
  return undefined;
}

/** Count generated tags/text runs before the browser constructs any DOM.
 * KaTeX escapes literal angle brackets in text/attributes. The scan allocates no
 * tokens and stops as soon as the node budget is exceeded. */
export function checkMathMarkup(html: string): MathLimitFailure | undefined {
  if (html.length > MATH_LIMITS.markupCharacters) return mathLimitFailure('markup');
  return mathMarkupNodeCount(html) > MATH_LIMITS.domNodes ? mathLimitFailure('nodes') : undefined;
}
export function mathMarkupNodeCount(html: string): number {
  let nodes = 0;
  for (let at = 0; at < html.length;) {
    if (html[at] === '<') {
      if (html[at + 1] !== '/') nodes++;
      const end = html.indexOf('>', at + 1); at = end < 0 ? html.length : end + 1;
    } else {
      nodes++;
      const end = html.indexOf('<', at); at = end < 0 ? html.length : end;
    }
    if (nodes > MATH_LIMITS.domNodes) return nodes;
  }
  return nodes;
}
