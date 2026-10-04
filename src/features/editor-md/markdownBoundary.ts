/** CJK writing does not use spaces as word boundaries. Treat its letters as
 * boundaries for paired formatting, while retaining Latin identifier rules.
 * This changes classification only: no spaces, escapes or hidden characters
 * are inserted into the user's source. */
export const CJK_BOUNDARY_CLASS = String.raw`\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}`;
const cjk = new RegExp(`[${CJK_BOUNDARY_CLASS}]`, 'u');
export const isCjkBoundary = (character: string) => cjk.test(character);

/** Keep the upstream delimiter-run/escape algorithm; extend its Unicode
 * punctuation class rather than maintaining another emphasis parser. */
export function withCjkBoundaries(rule: RegExp): RegExp {
  return new RegExp(rule.source.replaceAll(String.raw`\p{P}\p{S}`, String.raw`\p{P}\p{S}` + CJK_BOUNDARY_CLASS), rule.flags);
}
