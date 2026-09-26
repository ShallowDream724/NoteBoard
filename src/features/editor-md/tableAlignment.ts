export type TableAlignment = 'left' | 'center' | 'right';

export function tableAlignment(value: unknown): TableAlignment | null {
  return value === 'left' || value === 'center' || value === 'right' ? value : null;
}

/** An unspecified position is a centered presentation default, not an NB-only
 * document attribute. Ordinary MD tables therefore stay portable and insertable. */
export function tableAlignmentMargins(value: unknown) {
  const alignment = tableAlignment(value) ?? 'center';
  return { marginLeft: alignment === 'center' || alignment === 'right' ? 'auto' : '0px',
    marginRight: alignment === 'center' || alignment === 'left' ? 'auto' : '0px' };
}

export function tableAlignmentStyle(value: unknown): string {
  const { marginLeft, marginRight } = tableAlignmentMargins(value);
  return `margin-left: ${marginLeft}; margin-right: ${marginRight}`;
}
