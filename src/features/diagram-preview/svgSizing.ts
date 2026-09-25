/** Mermaid often emits width="100%". Keep its coordinate-space size and only
 * shrink to the containing page; simple diagrams must not be stretched. */
export function sizeDiagramSvg(svg: Element): void {
  const box = svg.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
  if (!box || box.length !== 4 || !box.every(Number.isFinite) || box[2] <= 0 || box[3] <= 0) return;
  const element = svg as SVGElement;
  element.setAttribute('width', String(box[2]));
  element.setAttribute('height', String(box[3]));
  element.style.width = `${box[2]}px`;
  element.style.maxWidth = '100%';
  element.style.height = 'auto';
}
