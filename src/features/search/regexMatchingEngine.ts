import { checkRegexSearchRequest, regexSearchFailure, REGEX_SEARCH_LIMITS, type RegexSearchRequest, type RegexSearchResult } from './regexProtocol';

/** This module runs only in the worker (and focused tests). Never use it as a
 * main-thread fallback: one native RegExp.exec call can take unbounded time. */
export function collectRegexMatches(request: RegexSearchRequest): RegexSearchResult {
  const refused = checkRegexSearchRequest(request);
  if (refused) return refused;
  if (!request.pattern) return { ranges: new Uint32Array() };
  let expression: RegExp;
  try {
    expression = new RegExp(request.wholeWord ? `\\b(?:${request.pattern})\\b` : request.pattern, `gu${request.multiline ? 'm' : ''}${request.caseSensitive ? '' : 'i'}`);
  } catch (error) {
    const detail = error instanceof Error ? error.message.slice(0, 512) : '';
    return regexSearchFailure('pattern', `正则表达式格式错误${detail ? `：${detail}` : ''}`);
  }
  let ranges = new Uint32Array(256), count = 0, replacementCharacters = 0;
  const replacements: string[] | undefined = request.replacement ? [] : undefined;
  const template = request.replacement?.syntax === 'codemirror'
    ? request.replacement.text.replace(/\\([nrt\\])/g, (_, character: string) => character === 'n' ? '\n' : character === 'r' ? '\r' : character === 't' ? '\t' : '\\')
    : request.replacement?.text;
  for (const segment of request.segments) {
    expression.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = expression.exec(segment.text))) {
      if (!request.ignoreWhitespace || match[0].trim()) {
        if (count >= REGEX_SEARCH_LIMITS.matches) return regexSearchFailure('results');
        if (request.replacement && template !== undefined) {
          const remaining = REGEX_SEARCH_LIMITS.replacementOutputCharacters - replacementCharacters;
          const replacement = request.replacement.syntax === 'literal'
            ? template.length <= remaining ? template : undefined
            : expandCodeMirrorReplacement(template, match, remaining);
          if (replacement === undefined) return regexSearchFailure('replacement');
          replacementCharacters += replacement.length; replacements!.push(replacement);
        }
        if ((count + 1) * 2 > ranges.length) {
          const grown = new Uint32Array(Math.min(REGEX_SEARCH_LIMITS.matches * 2, ranges.length * 2));
          grown.set(ranges); ranges = grown;
        }
        ranges[count * 2] = segment.from + match.index;
        ranges[count * 2 + 1] = segment.from + match.index + match[0].length;
        count++;
      }
      // RegExp.exec does not advance after an empty match. MatchAll's Unicode
      // AdvanceStringIndex semantics keep emoji intact and guarantee progress.
      if (!match[0].length) {
        const point = segment.text.codePointAt(expression.lastIndex);
        expression.lastIndex += point !== undefined && point > 0xffff ? 2 : 1;
      }
    }
  }
  return { ranges: ranges.slice(0, count * 2), ...(replacements ? { replacements } : {}) };
}

/** CodeMirror's $&, $$ and numbered-capture semantics, without rerunning RegExp
 * on the main thread. Count every piece before joining to bound amplification. */
function expandCodeMirrorReplacement(template: string, match: RegExpExecArray, maximum: number): string | undefined {
  const pieces: string[] = [];
  let length = 0, at = 0;
  const append = (piece: string) => { length += piece.length; if (length > maximum) return false; pieces.push(piece); return true; };
  for (const token of template.matchAll(/\$([$&]|\d+)/g)) {
    if (!append(template.slice(at, token.index))) return undefined;
    const value = token[1];
    let replacement = token[0];
    if (value === '$') replacement = '$';
    else if (value === '&') replacement = match[0];
    else {
      // Leading zeroes can be arbitrarily long. Examine only the bounded
      // significant prefix rather than repeatedly parsing every long suffix.
      let first = 0;
      while (value[first] === '0') first++;
      for (let end = Math.min(value.length, first + String(match.length - 1).length); end > first; end--) {
        const capture = Number(value.slice(first, end));
        if (capture > 0 && capture < match.length) {
          replacement = String(match[capture]) + value.slice(end); break;
        }
      }
    }
    if (!append(replacement)) return undefined;
    at = token.index! + token[0].length;
  }
  return append(template.slice(at)) ? pieces.join('') : undefined;
}
