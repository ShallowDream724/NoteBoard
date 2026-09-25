import type { SVGProps } from 'react';

/** Small numerals need a lighter stroke than the list lines to stay legible. */
export function OrderedListIcon({ size = 18, strokeWidth = 1.8, ...props }: SVGProps<SVGSVGElement> & { size?: number | string }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    <path d="M2.8 4.4 4.6 3v7M2.8 10h3.8M2.2 15.5c.15-1.15 1.1-1.85 2.25-1.85 1.35 0 2.3.85 2.3 2 0 .8-.45 1.4-1.3 2.1L2.4 21h4.5" strokeWidth="1.55"/>
    <path d="M11 6.5h10M11 17.5h10" strokeWidth={strokeWidth}/>
  </svg>;
}
