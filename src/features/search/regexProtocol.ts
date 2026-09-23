/** Budgets cover a complete query, never a silently truncated result set.
 * Offsets are UTF-16 editor positions and fit the transferable Uint32 index. */
export const REGEX_SEARCH_LIMITS = {
  inputCharacters: 16 * 1024 * 1024,
  segments: 100_000,
  patternCharacters: 4_096,
  matches: 100_000,
  replacementCharacters: 16_384,
  replacementOutputCharacters: 4 * 1024 * 1024,
  workerMilliseconds: 1_000,
} as const;

export interface RegexSearchSegment { text: string; from: number }
export interface RegexSearchRequest {
  segments: readonly RegexSearchSegment[];
  pattern: string;
  caseSensitive: boolean;
  /** CodeMirror uses multiline anchors; ProseMirror searches separate runs. */
  multiline?: boolean;
  /** JS word boundaries, as used by the existing ProseMirror search. CodeMirror
   * instead filters the returned ranges with its language's charCategorizer. */
  wholeWord?: boolean;
  /** Preserve ProseMirror's exclusion of whitespace-only and zero-width hits. */
  ignoreWhitespace?: boolean;
  /** Only replacement commands request expansion; navigation receives offsets. */
  replacement?: { text: string; syntax: 'literal' | 'codemirror' };
}
export type RegexSearchLimit = 'input' | 'pattern' | 'results' | 'replacement' | 'time' | 'unavailable' | 'worker';
export interface RegexSearchResult {
  /** Interleaved [from, to, from, to, ...]. No editor or DOM objects cross threads. */
  ranges: Uint32Array;
  replacements?: string[];
  error?: string;
  limited?: RegexSearchLimit;
}

export function regexSearchFailure(limited: RegexSearchLimit, message?: string): RegexSearchResult {
  const messages: Record<RegexSearchLimit, string> = {
    input: '搜索文本超出正则搜索范围，请缩小文档或使用普通文本搜索。',
    pattern: '正则表达式格式错误或过长，请检查表达式。',
    results: '正则匹配超过 100,000 处，请缩小搜索范围后重试。',
    replacement: '正则替换结果过大，请缩小搜索范围或减少替换文本。',
    time: '正则搜索超过 1 秒，已停止计算；请简化表达式或使用普通文本搜索。',
    unavailable: '当前环境无法启动正则搜索，请使用普通文本搜索。',
    worker: '正则搜索未能完成，请重试或简化表达式。',
  };
  return { ranges: new Uint32Array(), error: message ?? messages[limited], limited };
}

/** Admission does not compile or execute the user's regular expression. */
export function checkRegexSearchRequest(request: RegexSearchRequest): RegexSearchResult | undefined {
  if (request.pattern.length > REGEX_SEARCH_LIMITS.patternCharacters) return regexSearchFailure('pattern');
  if (request.segments.length > REGEX_SEARCH_LIMITS.segments) return regexSearchFailure('input');
  if (request.replacement && request.replacement.text.length > REGEX_SEARCH_LIMITS.replacementCharacters) return regexSearchFailure('replacement');
  let characters = 0, previousEnd = 0;
  for (const segment of request.segments) {
    characters += segment.text.length;
    const end = segment.from + segment.text.length;
    if (characters > REGEX_SEARCH_LIMITS.inputCharacters || !Number.isSafeInteger(segment.from) || segment.from < previousEnd || end > 0xffff_ffff) return regexSearchFailure('input');
    previousEnd = end;
  }
  return undefined;
}
