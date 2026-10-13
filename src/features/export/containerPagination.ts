/** Page-local presentation only; never changes the source document or retains
 * another tree. Text containers may split once keeping them would waste more
 * than half a page. Media stays with its caption whenever it fits one page. */
const TEXT_CONTAINERS = '.github-alert,.export-disclosure,blockquote,pre';
const MEDIA_CONTAINERS = '.export-image-slot,figure[data-nb-image],.export-math.display,.export-diagram';
const CONTAINERS = `${TEXT_CONTAINERS},${MEDIA_CONTAINERS}`;

export function fitPageImages(root: HTMLElement, pageHeight: number) {
  const images = Array.from(root.querySelectorAll('img'));
  const insets = new Map<HTMLElement, number>();
  const ancestorInsets = (element: HTMLElement) => {
    let total = 0;
    for (let parent = element.parentElement; parent && parent !== root; parent = parent.parentElement) {
      let inset = insets.get(parent);
      if (inset === undefined) {
        const style = getComputedStyle(parent);
        inset = [style.paddingTop, style.paddingBottom, style.borderTopWidth, style.borderBottomWidth].reduce((sum, value) => sum + (parseFloat(value) || 0), 0);
        const heading = parent.matches('.github-alert,.export-disclosure') ? parent.querySelector<HTMLElement>(':scope > .alert-title,:scope > summary') : null;
        if (heading) {
          const headingStyle = getComputedStyle(heading);
          const headingHeight = heading.getBoundingClientRect().height + (parseFloat(headingStyle.marginTop) || 0) + (parseFloat(headingStyle.marginBottom) || 0);
          if (headingHeight <= pageHeight / 2) inset += headingHeight;
        }
        insets.set(parent, inset);
      }
      total += inset;
    }
    return total;
  };
  // Restore the full budget first: a larger paper/font revision must not retain
  // an earlier, smaller image limit. All reads precede the final write phase.
  images.forEach(image => { image.style.maxHeight = `${pageHeight}px`; image.style.objectFit = 'contain'; });
  const limits = images.map(image => {
    const owner = image.closest<HTMLElement>('.export-image-slot') ?? image.closest<HTMLElement>('figure[data-nb-image]');
    const budget = Math.max(1, pageHeight - ancestorInsets(owner ?? image));
    if (!owner) return budget;
    const style = getComputedStyle(owner);
    const captionHeight = Math.max(0, owner.getBoundingClientRect().height - image.getBoundingClientRect().height)
      + (parseFloat(style.marginTop) || 0) + (parseFloat(style.marginBottom) || 0);
    // A caption longer than half a page is prose, not a reason to crush an
    // image to a sliver. Its owner is allowed to continue on the following page.
    return captionHeight <= budget / 2 ? Math.max(1, budget - captionHeight - 2) : budget;
  });
  images.forEach((image, index) => { image.style.maxHeight = `${limits[index]}px`; });
  return images;
}

export function updateContainerPagination(root: HTMLElement, pageHeight: number, changed?: readonly HTMLElement[]) {
  const containers = new Set<HTMLElement>();
  if (!changed) root.querySelectorAll<HTMLElement>(CONTAINERS).forEach(element => containers.add(element));
  else for (const element of changed) {
    if (element.matches(CONTAINERS)) containers.add(element);
    element.querySelectorAll<HTMLElement>(CONTAINERS).forEach(child => containers.add(child));
    for (let parent = element.parentElement; parent && root.contains(parent); parent = parent.parentElement)
      if (parent.matches(CONTAINERS)) containers.add(parent);
  }
  const plans = Array.from(containers, element => {
    const limit = element.matches(TEXT_CONTAINERS) ? pageHeight / 2 : pageHeight;
    // Structural formula continuations already own atomic pieces. Keeping the
    // wrapper together would undo that layout decision.
    const continued = element.hasAttribute('data-math-continued');
    return { element, keep: !continued && element.getBoundingClientRect().height <= limit - 2 };
  });
  plans.forEach(({ element, keep }) => { element.dataset.exportPagination = keep ? 'keep' : 'split'; });
}
