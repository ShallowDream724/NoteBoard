/** Conservative evidence shared by cleanup and restoration. A null normalized
 * value means decoding was uncertain and must never authorize deletion. Matching
 * filenames intentionally over-retains (including prose/reference definitions).
 * Keep the native scanner's normalize_reference_text semantics in sync. */
export function normalizeImageReferenceText(content: string, nativeDocument = false): string | null {
  if (nativeDocument) {
    try { content = JSON.stringify(JSON.parse(content)); } catch { return null; }
  }
  let uncertain = false;
  const entities: Record<string, string> = {
    amp: '&', AMP: '&', quot: '"', QUOT: '"', apos: "'", lt: '<', LT: '<', gt: '>', GT: '>',
    sol: '/', bsol: '\\', period: '.', colon: ':', percnt: '%', lowbar: '_', hyphen: '-',
    num: '#', quest: '?', equals: '=', Tab: '\t', NewLine: '\n', nbsp: '\u00a0',
  };
  const unescaped = content.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])/g, '$1')
    .replace(/&(#(?:[xX][\da-fA-F]+|\d+)|[a-zA-Z][a-zA-Z\d]*);?/g, (entity, name: string) => {
      if (name.startsWith('#')) {
        const hex = name[1]?.toLowerCase() === 'x';
        const point = Number.parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10);
        if (point > 0 && point <= 0x10ffff && !(point >= 0x80 && point <= 0x9f)
          && !(point >= 0xd800 && point <= 0xdfff)) return String.fromCodePoint(point);
      } else if (Object.hasOwn(entities, name)) return entities[name];
      uncertain = true;
      return entity;
    });
  let decoded = unescaped;
  try { decoded = decodeURIComponent(unescaped); } catch { uncertain = true; }
  return uncertain ? null : decoded.toLowerCase();
}

export function mayReferenceImage(normalized: string | null, imagePath: string): boolean {
  const filename = imagePath.split(/[\\/]/).pop();
  return normalized === null || !filename || normalized.includes(filename.toLowerCase());
}
