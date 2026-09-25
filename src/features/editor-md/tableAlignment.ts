export type TableAlignment = 'left' | 'center' | 'right';

export function tableAlignment(value: unknown): TableAlignment | null {
  return value === 'left' || value === 'center' || value === 'right' ? value : null;
}

/** Horizontal margins position the table without changing column sizing. */
export function tableAlignmentMargins(value: unknown) {
  const alignment = tableAlignment(value);
  return { marginLeft: alignment === 'center' || alignment === 'right' ? 'auto' : '0px',
    marginRight: alignment === 'center' || alignment === 'left' ? 'auto' : '0px' };
}

export function tableAlignmentStyle(value: unknown): string {
  if (!tableAlignment(value)) return '';
  const { marginLeft, marginRight } = tableAlignmentMargins(value);
  return `margin-left: ${marginLeft}; margin-right: ${marginRight}`;
}
