import type { SVGProps } from 'react';

const TRIANGLE_PATH = 'M3 1.5 9 6 3 10.5Z';

/** Shared filled indicator: right when collapsed and down when expanded. */
export function DisclosureTriangle({ expanded = false, size = 12, style, ...props }: SVGProps<SVGSVGElement> & { expanded?: boolean; size?: number | string }) {
  return <svg width={size} height={size} viewBox="0 0 12 12" fill="currentColor" stroke="none" aria-hidden="true" focusable="false" style={{ transform: expanded ? 'rotate(90deg)' : undefined, ...style }} {...props}>
    <path d={TRIANGLE_PATH}/>
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
