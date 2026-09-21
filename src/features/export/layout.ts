import { paperSize, type LayoutIssue, type PdfOptions } from './model';

const PX_PER_PT = 96 / 72;
function zoom(element: HTMLElement) {
  let scale = 1;
  for (let current: HTMLElement | null = element; current; current = current.parentElement) scale *= Number(current.style.zoom) || 1;
  return scale;
}
function extent(element: HTMLElement) { return Math.max(element.scrollWidth * zoom(element), element.getBoundingClientRect().width); }
function smallestText(element: HTMLElement): number {
  let minimum = Infinity;
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let text: Node | null;
  while ((text = walker.nextNode())) {
    if (!text.textContent?.trim() || text.parentElement?.closest('.katex-mathml')) continue;
    const parent = text.parentElement!;
    if (!parent.getClientRects().length) continue;
    minimum = Math.min(minimum, Number.parseFloat(getComputedStyle(parent).fontSize) * zoom(parent));
  }
  return Number.isFinite(minimum) ? minimum : Number.parseFloat(getComputedStyle(element).fontSize);
}
function fit(element: HTMLElement, width: number, minimumPt: number): boolean {
  const scale = Math.min(1, width / extent(element));
  if (scale >= .995) return true;
  if (smallestText(element) * scale < minimumPt * PX_PER_PT) return false;
  element.style.zoom = String((Number(element.style.zoom) || 1) * scale);
  return true;
}

/** Split columns into continuation tables; repeat the first column as the row key. */
function splitColumns(table: HTMLTableElement, width: number) {
  const rows = Array.from(table.rows);
  const count = rows[0]?.cells.length ?? 0;
  if (count < 3 || rows.some(row => Array.from(row.cells).some(cell => cell.colSpan > 1 || cell.rowSpan > 1))) return false;
  const keyWidth = Math.min(width * .3, Math.max(60, rows[0].cells[0].getBoundingClientRect().width));
  const columnsPerGroup = Math.max(1, Math.floor((width - keyWidth) / 100));
  const fragment = document.createDocumentFragment();
  for (let start = 1, group = 1; start < count; start += columnsPerGroup, group++) {
    const clone = table.cloneNode(true) as HTMLTableElement;
    clone.classList.add('table-wrap'); clone.removeAttribute('data-export-item');
    clone.querySelectorAll('colgroup').forEach(group => group.remove());
    clone.style.removeProperty('width'); clone.style.removeProperty('min-width');
    for (const row of Array.from(clone.rows)) {
      Array.from(row.cells).forEach((cell, index) => { if (index !== 0 && (index < start || index >= start + columnsPerGroup)) cell.remove(); });
    }
    const caption = document.createElement('div'); caption.className = 'table-continuation'; caption.textContent = `续表 ${group} · 首列重复`;
    fragment.append(caption, clone);
  }
  table.replaceWith(fragment); return true;
}

export function layoutDocument(root: HTMLElement, options: PdfOptions): LayoutIssue[] {
  const [paperWidth, paperHeight] = paperSize(options);
  const width = (paperWidth - options.marginMm * 2) * 96 / 25.4;
  const pageHeight = (paperHeight - options.marginMm * 2) * 96 / 25.4;
  const issues: LayoutIssue[] = [];
  for (const element of root.querySelectorAll<HTMLTableElement>('table[data-export-item]')) {
    const id = element.dataset.exportItem!;
    const mode = options.items[id] ?? 'auto';
      if (mode === 'columns') {
        if (!splitColumns(element, width)) issues.push({ id, message: '合并单元格不支持分栏续表，请选换行或横向纸张', blocking: true });
        continue;
      }
      if (mode === 'wrap') element.classList.add('table-wrap');
      if (extent(element) > width + 1 && !fit(element, width, options.minimumPt)) {
        if (mode === 'auto') element.classList.add('table-wrap');
      }
      if (extent(element) > width + 1) issues.push({ id, message: '表格仍超出页宽，可选择分栏续表', blocking: true });
  }
  for (const element of root.querySelectorAll<HTMLElement>('.export-math[data-export-item]')) {
      const id = element.dataset.exportItem!;
      const mode = options.items[id] ?? 'auto';
      if (element.dataset.renderError) { issues.push({ id, message: '公式语法有误，请返回正文修改', blocking: true }); continue; }
      const math = element.querySelector<HTMLElement>('.katex-html');
      if (!math) continue;
      const cell = element.closest('th,td') as HTMLElement | null;
      const available = cell ? Math.max(1, cell.getBoundingClientRect().width - (Number.parseFloat(getComputedStyle(cell).paddingLeft) + Number.parseFloat(getComputedStyle(cell).paddingRight)) * zoom(cell)) : width;
      if (mode === 'wrap') element.classList.add('wrap');
      if (extent(math) > available + 1 && !fit(math, available, options.minimumPt) && mode === 'auto') element.classList.add('wrap');
      // An indivisible fraction/matrix cannot safely be split by a text regexp.
      if (extent(math) > available + 1) {
        issues.push({ id, message: '公式仍超出页宽，可调整纸张或在源码中用 aligned 分行', blocking: true });
      }
      if (element.getBoundingClientRect().height > pageHeight) issues.push({ id, message: '公式高于一页，请在源码中拆成多个公式', blocking: true });
  }
  for (const row of root.querySelectorAll('tr')) if (row.getBoundingClientRect().height > pageHeight) row.classList.add('export-tall-row');
  for (const image of root.querySelectorAll('img')) {
    image.style.maxHeight = `${pageHeight}px`; image.style.objectFit = 'contain';
    if (!image.complete || image.naturalWidth === 0) issues.push({ id: '', message: '有图片未能加载，请检查图片路径', blocking: true });
  }
  for (const _ of root.querySelectorAll('[data-export-source-only]')) issues.push({ id: '', message: '此图表暂按源码导出', blocking: false });
  return issues;
}
