const punctuation = new Set([..."!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~"]);
const delimiters = new Set(['`', '*', '_', '[', ']', '~', '=', '$']);
// Escaping a closing bracket already prevents links. Leaving opening brackets
// and parentheses bare avoids creating our backslash-based TeX delimiters.
const literalPunctuation = new Set([...punctuation].filter(character => !'[()'.includes(character)));

/** Default document escaping keeps safe path backslashes. Literal code being
 * unwrapped also escapes punctuation that could create block/HTML/inline syntax. */
export function escapeMarkdownText(text: string, literal = false): string {
  let output = '';
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === '\\') {
      const next = text[index + 1];
      output += next === undefined || next === '\n' || punctuation.has(next) ? '\\\\' : '\\';
    } else output += (literal ? literalPunctuation : delimiters).has(character) ? `\\${character}` : character;
  }
  return output;
}
