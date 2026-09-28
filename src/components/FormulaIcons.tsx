import type { SVGProps } from 'react';

type Props = SVGProps<SVGSVGElement> & { size?: number };
/** The surrounding text shows whether the formula stays in a line or owns a row. */
export function InlineFormulaIcon({ size = 18, ...props }: Props) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    <path d="M2 9h4M2 15h4M18 9h4M18 15h4M9 8l6 8M15 8l-6 8"/>
  </svg>;
}
export function BlockFormulaIcon({ size = 18, ...props }: Props) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    <path d="M3 3h18M3 21h18M15 7H9l4 5-4 5h6"/>
  </svg>;
}
