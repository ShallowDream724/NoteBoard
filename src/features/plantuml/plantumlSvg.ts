import DOMPurify from 'dompurify';

const forbidden = ['script', 'foreignObject', 'iframe', 'object', 'embed', 'style', 'a', 'animate', 'animateColor', 'animateMotion', 'animateTransform', 'set', 'discard'];
const safeStyles = new Set(['fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'color', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'background-color', 'width', 'height']);
const safeFunctions = new Set(['url', 'rgb', 'rgba', 'hsl', 'hsla', 'matrix', 'translate', 'scale', 'rotate', 'skewx', 'skewy']);
const localRef = /^#[A-Za-z_][\w:.-]*$/;
function safeValue(value: string): boolean {
  if (value.includes('\\') || /@import|(?:expression|var|env|attr)\s*\(/i.test(value)) return false;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) return false;
  }
  if ([...value.matchAll(/([\w-]+)\s*\(/g)].some(match => !safeFunctions.has(match[1].toLowerCase()))) return false;
  const urls = value.match(/url\s*\([^)]*\)/gi) ?? [];
  if (/url/i.test(value) && !urls.length) return false;
  return urls.every(url => localRef.test(url.replace(/^url\s*\(\s*['"]?|['"]?\s*\)$/gi, '').trim()));
}

/** Remote diagrams may contain links, scripts and CSS fetches. Preserve only static local SVG. */
export function sanitizePlantUmlSvg(source: string): string {
  const fragment = DOMPurify.sanitize(source, { USE_PROFILES: { svg: true, svgFilters: true }, ADD_TAGS: ['use'], FORBID_TAGS: forbidden, RETURN_DOM_FRAGMENT: true });
  const roots = fragment.children;
  if (roots.length !== 1 || roots[0].localName !== 'svg' || roots[0].namespaceURI !== 'http://www.w3.org/2000/svg') throw new Error('渲染服务返回了无效的 SVG。');
  const root = roots[0] as SVGSVGElement;
  for (const element of [root, ...root.querySelectorAll('*')]) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase(), value = attribute.value;
      if (name.startsWith('on') || ['href', 'xlink:href', 'src'].includes(name) && !localRef.test(value.trim()) || !safeValue(value)) {
        element.removeAttribute(attribute.name);
      }
    }
    if (element.hasAttribute('style')) {
      const declaration = (element as SVGElement).style;
      for (const property of Array.from({ length: declaration.length }, (_, index) => declaration.item(index))) if (!safeStyles.has(property) || !safeValue(declaration.getPropertyValue(property))) declaration.removeProperty(property);
      if (!declaration.cssText) element.removeAttribute('style');
    }
  }
  return root.outerHTML;
}
