/** Explain only a diagnosed missing TeX group terminator. Full-width braces
 * remain ordinary source text; this helper never repairs or rerenders them. */
export function mathSourceErrorHint(latex: string, message: string): string | undefined {
  if (!/^(?:Unexpected end of input in a macro argument, expected '\}'|Expected '\}', got 'EOF')/.test(message)) return;
  if (!latex.includes('｝')) return;
  const groups: boolean[] = [];
  for (let at = 0; at < latex.length; at++) {
    const character = latex[at];
    if (character === '\\') { at++; continue; }
    if (character === '%') { const end = latex.indexOf('\n', at); at = end < 0 ? latex.length : end; continue; }
    if (character === '{') groups.push(false);
    else if (character === '}') groups.pop();
    else if (character === '｝' && groups.length) groups[groups.length - 1] = true;
  }
  // Discard full-width text inside groups already closed by an ASCII brace,
  // such as \text{中文｝}, even when a different group later fails to close.
  if (groups.some(Boolean)) return '公式中有全角右花括号“｝”，它不能闭合半角左花括号“{”。请检查对应位置是否应改为半角“}”。';
}
