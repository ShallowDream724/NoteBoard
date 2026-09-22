/** Minimum scale of meaningful typography. Inspect size-changing containers,
 * not every KaTeX atom or every text cell; called only for oversized objects. */
export function renderedScale(element: HTMLElement): number {
  return element.offsetWidth ? element.getBoundingClientRect().width / element.offsetWidth : 1;
}
export function readableScale(element: HTMLElement, bodyFontPt: number): number {
  const scale = renderedScale(element);
  let minimum = Math.min(1, 8 / (bodyFontPt * scale));
  for (const child of element.querySelectorAll<HTMLElement>('.sizing,[style*="font-size"],small,sub,sup')) {
    if (!child.textContent?.trim()) continue;
    const pt = parseFloat(getComputedStyle(child).fontSize) * .75 * scale;
    if (pt > 0) minimum = Math.max(minimum, Math.min(1, 6 / pt));
  }
  for (const line of element.querySelectorAll<HTMLElement>('.frac-line,.sqrt-line,.hline')) {
    const style = getComputedStyle(line), stroke = Math.max(parseFloat(style.borderTopWidth) || 0, parseFloat(style.borderBottomWidth) || 0) * .75 * scale;
    if (stroke > 0) minimum = Math.max(minimum, Math.min(1, .25 / stroke));
  }
  return minimum;
}
