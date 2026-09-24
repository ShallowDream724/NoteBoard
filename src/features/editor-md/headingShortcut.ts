/** Physical digits keep Markdown commands stable across keyboard layouts and IME modes. */
export function headingShortcut(event: KeyboardEvent): 0 | 1 | 2 | 3 | 4 | 5 | 6 | null {
  if (event.defaultPrevented || event.isComposing || event.altKey || event.shiftKey || !(event.ctrlKey || event.metaKey)) return null;
  const digit = /^Digit([0-6])$/.exec(event.code)?.[1] ?? (/^[0-6]$/.test(event.key) ? event.key : undefined);
  return digit === undefined ? null : Number(digit) as 0 | 1 | 2 | 3 | 4 | 5 | 6;
}
