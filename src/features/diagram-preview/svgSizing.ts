export interface DiagramSvgSize { width: number; height: number }

export function diagramSvgSize(svg: Element): DiagramSvgSize | null {
  const box = svg.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
  if (box?.length === 4 && box.every(Number.isFinite) && box[2] > 0 && box[3] > 0) return { width: box[2], height: box[3] };
  const length = (name: string) => {
    const value = svg.getAttribute(name)?.trim();
    return value && /^\d*\.?\d+(?:px)?$/i.test(value) ? parseFloat(value) : 0;
  };
  const width = length('width'), height = length('height');
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 ? { width, height } : null;
}

/** Mermaid often emits width="100%". Keep its coordinate-space size and only
 * shrink to the containing page; simple diagrams must not be stretched. */
export function sizeDiagramSvg(svg: Element): void {
  const size = diagramSvgSize(svg);
  if (!size) return;
  const element = svg as SVGElement;
  element.setAttribute('width', String(size.width));
  element.setAttribute('height', String(size.height));
  element.style.width = `${size.width}px`;
  element.style.maxWidth = '100%';
  element.style.height = 'auto';
  element.style.display = 'block';
}
