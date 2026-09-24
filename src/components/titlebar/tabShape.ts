import type { CSSProperties } from 'react';
import { TAB_EDGE_INSET } from './tabEdge';

const height = 32;
const topRadius = 10;
const shoulderRadius = TAB_EDGE_INSET;
// One flat pixel overlaps the center mask, preventing seams at fractional DPI.
const capWidth = shoulderRadius + topRadius + 1;
const profile = `M0 ${height} A${shoulderRadius} ${shoulderRadius} 0 0 0 ${shoulderRadius} ${height - shoulderRadius} V${topRadius} A${topRadius} ${topRadius} 0 0 1 ${shoulderRadius + topRadius} 0 H${capWidth} V${height} Z`;

function capMask(mirror: boolean) {
  const transform = mirror ? ` transform="translate(${capWidth} 0) scale(-1 1)"` : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${capWidth} ${height}"><path${transform} d="${profile}"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** Fixed vector end profiles + a flexible middle; no per-tab path measurements.
 * Equal-axis arcs meet vertical sides tangentially, without flattened radial fills. */
export const TAB_SHAPE_STYLE = {
  '--tab-edge-inset': `${shoulderRadius}px`,
  '--tab-active-height': `${height}px`,
  '--tab-top-radius': `${topRadius}px`,
  '--tab-cap-width': `${capWidth}px`,
  '--tab-cap-total': `${2 * (capWidth - 1)}px`,
  '--tab-mask-left': capMask(false),
  '--tab-mask-right': capMask(true),
} as CSSProperties;
