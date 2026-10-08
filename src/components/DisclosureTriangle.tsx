import type { SVGProps } from 'react';

const TRIANGLE_PATH = 'M3 1.5 9 6 3 10.5Z';
const CHEVRON_PATH = 'M4.25 2.75 7.5 6 4.25 9.25';

/** Shared disclosure geometry; file navigation opts into the lighter chevron. */
export function DisclosureTriangle({ expanded = false, size = 12, variant = 'filled', style, ...props }: SVGProps<SVGSVGElement> & { expanded?: boolean; size?: number | string; variant?: 'filled' | 'chevron' }) {
  const chevron = variant === 'chevron';
  return <svg width={size} height={size} viewBox="0 0 12 12" fill={chevron ? 'none' : 'currentColor'} stroke={chevron ? 'currentColor' : 'none'} strokeWidth={chevron ? 1.25 : undefined} strokeLinecap={chevron ? 'round' : undefined} strokeLinejoin={chevron ? 'round' : undefined} aria-hidden="true" focusable="false" style={{ transform: expanded ? 'rotate(90deg)' : undefined, ...style }} {...props}>
    <path d={chevron ? CHEVRON_PATH : TRIANGLE_PATH}/>
  </svg>;
}

/** DOM counterpart for editor widgets; the caller controls expanded rotation. */
export function createDisclosureTriangle(doc: Document = document): SVGSVGElement {
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 12 12');
  svg.setAttribute('width', '12');
  svg.setAttribute('height', '12');
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('stroke', 'none');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', TRIANGLE_PATH);
  svg.appendChild(path);
  return svg;
}
