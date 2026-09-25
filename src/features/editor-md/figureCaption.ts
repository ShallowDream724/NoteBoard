export const FIGURE_CAPTION_MAX_LENGTH = 10_000;
export function normalizeFigureCaption(value: unknown): string | null {
  return typeof value === 'string' ? value.replace(/\r\n?/g, '\n').trim() || null : null;
}
export function validateFigureCaption(value: unknown): void {
  if (value !== null && (typeof value !== 'string' || value.length > FIGURE_CAPTION_MAX_LENGTH || value.includes('\0'))) throw new RangeError('Invalid figure caption');
}
/** A caption is plain text even when it contains Markdown punctuation. */
export function markdownFigureCaption(value: unknown): string {
  return (normalizeFigureCaption(value) ?? '').replace(/[\\`*_{}[\]()<>#+.!|~=-]/g, '\\$&').replace(/\n/g, '  \n');
}
