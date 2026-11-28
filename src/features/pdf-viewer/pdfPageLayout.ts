export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 5;
export const PAGE_MARGIN = 16;
const PAGE_GAP = 16;
const MAX_FIT_WIDTH = 960;
const MAX_PAGE_HEIGHT = 32768;
const ESTIMATED_SIZE = { width: 612, height: 792 };

export interface PdfPageSize {
  width: number;
  height: number;
}

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function validPageSize({ width, height }: PdfPageSize) {
  return width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height);
}

export function createPdfPageLayout(pages: number, sizes: ReadonlyMap<number, PdfPageSize>, viewportWidth: number, zoom: number) {
  const estimate = sizes.get(1) ?? ESTIMATED_SIZE;
  let widest = estimate.width;
  for (const size of sizes.values()) widest = Math.max(widest, size.width);
  const columnWidth = clamp(viewportWidth - PAGE_MARGIN * 2, 1, MAX_FIT_WIDTH) * zoom;
  const width = Math.max(viewportWidth, columnWidth + PAGE_MARGIN * 2);
  const scaleFor = (size: PdfPageSize) => Math.min(columnWidth / widest, MAX_PAGE_HEIGHT / size.height);
  const estimatedHeight = estimate.height * scaleFor(estimate);

  // Store deviations only for visited pages. Distant jumps don't read every intervening page.
  let heightDelta = 0;
  const offsets = [...sizes.keys()].sort((a, b) => a - b).map(page => {
    const size = sizes.get(page)!;
    heightDelta += size.height * scaleFor(size) - estimatedHeight;
    return { page, heightDelta };
  });

  function pageTop(page: number) {
    let low = 0;
    let high = offsets.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (offsets[middle].page < page) low = middle + 1;
      else high = middle;
    }
    return PAGE_MARGIN + (page - 1) * (estimatedHeight + PAGE_GAP) + (offsets[low - 1]?.heightDelta ?? 0);
  }

  function pageRect(page: number) {
    const size = sizes.get(page) ?? estimate;
    const scale = scaleFor(size);
    const pageWidth = size.width * scale;
    return { left: (width - pageWidth) / 2, top: pageTop(page), width: pageWidth, height: size.height * scale, scale };
  }

  function pageAt(top: number) {
    let low = 1;
    let high = pages;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (pageTop(middle) <= top) low = middle;
      else high = middle - 1;
    }
    return low;
  }

  return { width, height: pageTop(pages + 1) - PAGE_GAP + PAGE_MARGIN, pageAt, pageRect };
}

export type PdfPageLayout = ReturnType<typeof createPdfPageLayout>;
