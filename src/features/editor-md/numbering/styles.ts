export const NUMBERING_STYLES = [
  { value: 'decimal', label: '数字' },
  { value: 'circle', label: '圆圈数字' },
  { value: 'box', label: '方框数字' },
  { value: 'chinese', label: '中文数字' },
  { value: 'paren', label: '括号数字' },
  { value: 'upper-roman', label: '大写罗马数字' },
  { value: 'lower-roman', label: '小写罗马数字' },
  { value: 'upper-alpha', label: '大写字母' },
  { value: 'lower-alpha', label: '小写字母' },
] as const;

export type NumberingStyle = typeof NUMBERING_STYLES[number]['value'];

export function normalizeNumberingStyle(value: unknown): NumberingStyle {
  return NUMBERING_STYLES.some(style => style.value === value) ? value as NumberingStyle : 'decimal';
}

function chinese(value: number): string {
  // Match the CSS counter style's explicit range, then fall back to decimal.
  if (!Number.isInteger(value) || value < 1 || value > 9999) return String(value);
  const digits = '零一二三四五六七八九', units = ['', '十', '百', '千'];
  let result = '', zero = false;
  for (let place = 3; place >= 0; place--) {
    const digit = Math.floor(value / 10 ** place) % 10;
    if (!digit) { if (result) zero = true; continue; }
    if (zero) result += digits[0];
    if (digit !== 1 || place !== 1 || result) result += digits[digit];
    result += units[place]; zero = false;
  }
  return result;
}

/** Visible marker text, without the layout gap. Circle/box outlines are CSS,
 * so their values remain readable and are not limited to Unicode's 1–20 set. */
export function formatNumbering(value: number, requested: string): string {
  const style = normalizeNumberingStyle(requested);
  if (style === 'circle' || style === 'box') return String(value);
  if (style === 'paren') return `(${value})`;
  if (style === 'chinese') return `${chinese(value)}、`;
  let text = String(value);
  if (Number.isSafeInteger(value) && value > 0 && style.endsWith('-alpha')) {
    text = ''; let remaining = value;
    while (remaining) { remaining--; text = String.fromCharCode(97 + remaining % 26) + text; remaining = Math.floor(remaining / 26); }
  } else if (Number.isInteger(value) && value > 0 && value < 4000 && style.endsWith('-roman')) {
    text = ''; let remaining = value;
    for (const [amount, symbol] of [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']] as const) {
      while (remaining >= amount) { text += symbol; remaining -= amount; }
    }
  }
  return `${style.startsWith('upper-') ? text.toUpperCase() : text}.`;
}
