import { paperSize, type LayoutIssue, type LayoutReport, type PdfOptions } from './model';
import { planMath, planTableColumns, type TablePlan } from './layoutPolicy';
import { readableScale, renderedScale } from './layoutMetrics';
import { continueFraction, continueMatrix } from './mathLayout';
import { createProseOverflowCheck } from './proseOverflow';

const ITEM_URI = 'https://noteboard.invalid/export-item/';
function extent(element: HTMLElement) {
  return Math.max(element.scrollWidth * renderedScale(element), element.getBoundingClientRect().width);
}
function fit(element: HTMLElement, width: number, measured: number) {
  const scale = Math.min(1, width / measured);
  if (scale < .999) element.style.zoom = String(scale);
}
function availableWidth(element: HTMLElement, width: number) {
  const cell = element.closest<HTMLElement>('th,td');
  return cell ? Math.max(1, (cell.clientWidth - parseFloat(getComputedStyle(cell).paddingLeft) - parseFloat(getComputedStyle(cell).paddingRight)) * renderedScale(cell)) : width;
}

/** Clone only retained cells. Work is proportional to output size, not to
 * original cells multiplied by every continuation group. */
function splitColumns(table: HTMLTableElement, columnWidths: number[], plan: TablePlan): { group: HTMLElement; original: string } | null {
  const rows = Array.from(table.rows), count = rows[0]?.cells.length ?? 0;
  if (count < 3 || rows.some(row => Array.from(row.cells).some(cell => cell.colSpan > 1 || cell.rowSpan > 1))) return null;
  const group = document.createElement('div'); group.dataset.exportTableGroup = table.dataset.exportItem;
  for (const [part, band] of plan.bands.entries()) {
    const start = band.from, end = band.to, used = columnWidths[0] + columnWidths.slice(start, end).reduce((sum, width) => sum + width, 0);
    const clone = table.cloneNode(false) as HTMLTableElement;
    // Preserve the measured/user-adjusted column widths. A short continuation
    // must not stretch merely because the paper has space left over.
    clone.classList.add('table-wrap'); clone.style.width = `${used}px`; clone.style.minWidth = '';
    if (plan.scale < 1) clone.style.zoom = String(plan.scale);
    const columns = document.createElement('colgroup');
    for (const index of [0, ...Array.from({ length: end - start }, (_, i) => start + i)]) {
      const column = document.createElement('col'); column.style.width = `${columnWidths[index]}px`; columns.append(column);
    }
    clone.append(columns);
    const head = clone.createTHead(), body = clone.createTBody();
    for (const row of rows) {
      const rowClone = row.cloneNode(false) as HTMLTableRowElement;
      rowClone.append(row.cells[0].cloneNode(true));
      for (let column = start; column < end; column++) if (row.cells[column]) rowClone.append(row.cells[column].cloneNode(true));
      (row.parentElement?.tagName === 'THEAD' ? head : body).append(rowClone);
    }
    const caption = document.createElement('div'); caption.className = 'table-continuation'; caption.textContent = `续表 ${part + 1}`;
    group.append(caption, clone);
  }
  const original = table.outerHTML;
  table.replaceWith(group); return { group, original };
}

function itemLinks(elements: Iterable<HTMLElement>, adjustable: Set<string>) {
  for (const element of elements) {
    const id = element.dataset.exportItem!;
    if (!adjustable.has(id) || element.querySelector(':scope > a.export-item-link')) continue;
    const wrap = (target: HTMLElement) => {
      if (target.querySelector(':scope > a.export-item-link')) return;
      // Preserve actual document links and nested formula hit areas. Never nest anchors.
      if (target.querySelector('a,.export-math')) {
        for (const child of Array.from(target.childNodes)) {
          if (child instanceof HTMLElement) { if (child.tagName !== 'A' && !child.classList.contains('export-math')) wrap(child); }
          else if (child.nodeType === Node.TEXT_NODE && child.textContent?.trim()) {
            const link = document.createElement('a'); link.href = ITEM_URI + id; link.className = 'export-item-link'; child.replaceWith(link); link.append(child);
          }
        }
        return;
      }
      const link = document.createElement('a'); link.href = ITEM_URI + id; link.className = 'export-item-link';
      while (target.firstChild) link.append(target.firstChild);
      target.append(link);
    };
    if (element.tagName === 'TABLE') {
      for (const row of Array.from((element as HTMLTableElement).rows)) {
        // Separate, non-nested link geometry survives cells containing only
        // formulas, document links, images, or no text at all.
        for (const cell of [row.cells[0], ...(row.cells.length > 1 ? [row.cells[row.cells.length - 1]] : [])]) {
          if (!cell || cell.querySelector(':scope > .export-table-location')) continue;
          const link = document.createElement('a'); link.href = ITEM_URI + id;
          link.className = 'export-item-link export-table-location'; link.setAttribute('aria-hidden', 'true');
          link.textContent = '\u00a0'; cell.append(link);
        }
      }
    } else wrap(element);
  }
}

/** Retained layout state. Global typography changes reset all items; an item
 * override restores/reflows that item only. No document reparse or HTML reset. */
export function createLayoutSession(root: HTMLElement) {
  let previous: PdfOptions | undefined;
  const originals = new Map<string, string>(); // only tables that actually split
  const formulaOriginals = new Map<string, string>(); // only structurally continued formulas
  const itemIndex = new Map<string, HTMLElement[]>();
  const groups = new Map<string, HTMLElement>();
  const checkProseOverflow = createProseOverflowCheck(root);
  const register = (scope: HTMLElement) => {
    for (const element of scope.querySelectorAll<HTMLElement>('[data-export-item]')) {
      const id = element.dataset.exportItem!;
      const list = itemIndex.get(id) ?? []; list.push(element); itemIndex.set(id, list);
    }
  };
  register(root);
  const adjustable = new Set<string>();
  const issues = new Map<string, LayoutIssue[]>();
  const elements = (id: string) => itemIndex.get(id) ?? [];
  const replaceTable = (id: string, replacement: HTMLElement, original: HTMLElement) => {
    // Remove only the replaced subtree's entries. Nested formulas can occur in tables.
    const ids = new Set([id, ...Array.from(original.querySelectorAll<HTMLElement>('[data-export-item]'), e => e.dataset.exportItem!)]);
    ids.forEach(key => itemIndex.delete(key));
    original.replaceWith(replacement); register(replacement);
    if (replacement.dataset.exportItem) itemIndex.set(id, [replacement]);
  };
  const reset = (id: string) => {
    const group = groups.get(id);
    if (group && originals.has(id)) {
      const template = document.createElement('template'); template.innerHTML = originals.get(id)!;
      replaceTable(id, template.content.firstElementChild as HTMLElement, group); groups.delete(id); originals.delete(id);
    }
    elements(id).forEach(element => {
      if (element.classList.contains('export-math') && formulaOriginals.has(id)) { element.innerHTML = formulaOriginals.get(id)!; delete element.dataset.mathContinued; }
      element.style.removeProperty('zoom'); element.classList.remove('wrap', 'table-wrap');
      element.querySelector<HTMLElement>('.katex-html')?.style.removeProperty('zoom');
      element.querySelectorAll('a.export-item-link').forEach(link => {
        if (link.classList.contains('export-table-location')) link.remove(); else link.replaceWith(...link.childNodes);
      });
    });
    issues.delete(id);
  };
  return { async update(options: PdfOptions): Promise<LayoutReport> {
    const numberBandChanged = previous && previous.marginMm < 8 && previous.pageNumbers !== options.pageNumbers;
    const global = !previous || numberBandChanged || ['paper', 'landscape', 'marginMm', 'fontPt', 'lineHeight'].some(key => options[key as keyof PdfOptions] !== previous![key as keyof PdfOptions]);
    const changed = new Set<string>();
    if (global) { itemIndex.forEach((_elements, id) => changed.add(id)); adjustable.clear(); issues.clear(); }
    else for (const id of new Set([...Object.keys(previous!.items), ...Object.keys(options.items)])) if (previous!.items[id] !== options.items[id]) changed.add(id);
    // A formula can change its containing table's intrinsic width. Recompute that
    // table and its cells together, without querying/scanning the other document blocks.
    for (const id of changed) for (const element of elements(id)) {
      const table = element.closest<HTMLTableElement>('table[data-export-item]');
      if (table) changed.add(table.dataset.exportItem!);
      if (element.tagName === 'TABLE') element.querySelectorAll<HTMLElement>('.export-math[data-export-item]').forEach(math => changed.add(math.dataset.exportItem!));
    }
    changed.forEach(reset);
    const [paperWidth, paperHeight] = paperSize(options);
    const width = (paperWidth - options.marginMm * 2) * 96 / 25.4;
    const numberBand = options.pageNumbers ? Math.max(0, 8 - options.marginMm) : 0;
    const pageHeight = (paperHeight - options.marginMm * 2 - numberBand) * 96 / 25.4;
    const issue = (id: string, message: string, blocking = true) => { if (id) adjustable.add(id); issues.set(id, [...(issues.get(id) ?? []), { id, message, blocking }]); };
    const tables = [...changed].flatMap(elements).filter((e): e is HTMLTableElement => e.tagName === 'TABLE');
    const tableWidths = tables.map(table => {
      const manual = Array.from(table.querySelectorAll<HTMLTableColElement>('colgroup > col')).some(col => !!col.style.width);
      // A scaled table rounds border/text metrics differently. A small guard on
      // natural widths prevents a final identifier character wrapping by 1 px.
      return { manual, width: extent(table), columns: Array.from(table.rows[0]?.cells ?? [], cell => manual ? cell.getBoundingClientRect().width : Math.ceil(cell.getBoundingClientRect().width) + 2) };
    });
    tables.forEach((table, index) => {
      const id = table.dataset.exportItem!, mode = options.items[id] ?? 'auto';
      if (tableWidths[index].width <= width + 1 && !adjustable.has(id)) return;
      adjustable.add(id);
      if (mode === 'fit') fit(table, width, tableWidths[index].width);
      else {
        const manual = tableWidths[index].manual;
        if (mode === 'columns' || mode === 'auto') {
          const plan = planTableColumns(tableWidths[index].columns, width, mode === 'columns' ? 1 : readableScale(table, options.fontPt));
          if (plan?.bands.length === 1) { fit(table, width, tableWidths[index].width); return; }
          const split = plan && splitColumns(table, tableWidths[index].columns, plan);
          if (split) {
            const { group, original } = split;
            originals.set(id, original); groups.set(id, group);
            const ids = new Set([id, ...Array.from(table.querySelectorAll<HTMLElement>('[data-export-item]'), e => e.dataset.exportItem!)]);
            ids.forEach(key => itemIndex.delete(key)); register(group);
          } else if (!manual) { table.classList.add('table-wrap'); if (mode === 'columns') issue(id, '当前列组无法分栏，请选择换行或缩到正文宽度'); }
          else issue(id, '手动列宽超出可用空间，请调整列宽或选择缩到正文宽度');
        } else table.classList.add('table-wrap');
      }
      // Formula widths in changed table cells also need to be checked.
      elements(id).forEach(e => e.querySelectorAll<HTMLElement>('.export-math[data-export-item]').forEach(math => changed.add(math.dataset.exportItem!)));
    });
    const formulas = [...changed].flatMap(elements).filter(e => e.classList.contains('export-math'));
    for (const element of formulas) {
      if (element.dataset.matrixPreview !== 'true') continue;
      const id = element.dataset.exportItem!;
      if (!formulaOriginals.has(id)) formulaOriginals.set(id, element.innerHTML);
      adjustable.add(id);
      const result = await continueMatrix(element, availableWidth(element, width), pageHeight, options.fontPt, options.items[id] === 'fit');
      if (result.issue) issue(id, result.issue);
    }
    const measures = formulas.map(element => {
      const math = element.dataset.mathContinued ? null : element.querySelector<HTMLElement>('.katex-html');
      const available = availableWidth(element, width);
      const measured = math ? extent(math) : 0;
      const bases = math ? Array.from(math.children).filter(child => child.classList.contains('base')) : [];
      return { math, available, measured, height: math?.getBoundingClientRect().height ?? 0, wide: measured > available + 1,
        canContinue: bases.length > 1 && bases.every(base => base.getBoundingClientRect().height <= pageHeight) };
    });
    formulas.forEach((element, index) => {
      const id = element.dataset.exportItem!, mode = options.items[id] ?? 'auto';
      if (element.dataset.renderError) { issue(id, element.dataset.renderError); return; }
      const { math, available, measured, wide } = measures[index]; if (!math) return;
      if (wide || measures[index].height > pageHeight || adjustable.has(id)) {
        adjustable.add(id);
        if (mode === 'fit') fit(math, available, measured);
        else element.classList.add('wrap');
      }
    });
    // Measure all wrapped candidates in one read phase, then choose locally.
    const plans = formulas.map((element, i) => {
      const { math, available, measured, height } = measures[i];
      if (!math || options.items[element.dataset.exportItem!] === 'fit' || !element.classList.contains('wrap')) return null;
      return planMath({ width: measured, height, wrappedWidth: extent(math), wrappedHeight: math.getBoundingClientRect().height,
        availableWidth: available, availableHeight: measures[i].canContinue ? Infinity : pageHeight, minimumScale: readableScale(math, options.fontPt) });
    });
    plans.forEach((plan, i) => {
      if (!plan) return;
      formulas[i].classList.toggle('wrap', plan.wrap);
      if (plan.readable && plan.scale < 1) measures[i].math!.style.zoom = String(plan.scale);
    });
    // Reflow only the formulas that remain unreadable at ordinary break points.
    for (let i = 0; i < formulas.length; i++) {
      const plan = plans[i], element = formulas[i], id = element.dataset.exportItem!;
      if (!plan || plan.readable) continue;
      if (!formulaOriginals.has(id)) formulaOriginals.set(id, element.innerHTML);
      const matrix = await continueMatrix(element, measures[i].available, pageHeight, options.fontPt, false);
      if (matrix.issue) issue(id, matrix.issue);
      if (!matrix.handled) {
        await continueFraction(element, measures[i].available, options.fontPt);
        measures[i].math = element.querySelector<HTMLElement>('.katex-html');
        const math = measures[i].math;
        if (math) measures[i].canContinue = Array.from(math.children).filter(child => child.classList.contains('base')).every(base => base.getBoundingClientRect().height <= pageHeight);
        if (math && extent(math) > measures[i].available + 1) {
          const scale = measures[i].available / extent(math);
          if (scale >= readableScale(math, options.fontPt)) math.style.zoom = String(scale);
        }
      }
    }
    // Validate after the write phase, avoiding a forced full layout per formula.
    formulas.forEach((element, i) => {
      const { math, available } = measures[i], id = element.dataset.exportItem!;
      if (element.dataset.mathContinued) return;
      if (math && extent(math) > available + 1) issue(id, '换行后仍超宽，继续缩小会影响阅读；可手动选择适宽缩放。');
      if (element.getBoundingClientRect().height > pageHeight && !(element.classList.contains('wrap') && measures[i].canContinue)) issue(id, '此公式整体高于一页，需分段排版或调整源码。');
    });
    for (const id of changed) for (const table of elements(id).filter(e => e.tagName === 'TABLE'))
      if (extent(table) > width + 1) issue(id, '表格仍超出正文宽度，可选择缩放');
    for (const id of changed) for (const table of elements(id).filter(e => e.tagName === 'TABLE'))
      for (const row of table.querySelectorAll('tr')) row.classList.toggle('export-tall-row', row.getBoundingClientRect().height > pageHeight);
    if (global) {
      for (const image of root.querySelectorAll('img')) { image.style.maxHeight = `${pageHeight}px`; image.style.objectFit = 'contain'; if (!image.complete || !image.naturalWidth) issue('', '有图片未能加载，请检查图片路径'); }
      if (root.querySelector('[data-export-source-only]')) issue('', '此图表暂按源码导出', false);
    }
    // Final geometry includes prose, headings, code, and imported block markup.
    // A clipping boundary is never itself evidence that a document fits.
    const changedElements = [...changed].flatMap(elements);
    if (checkProseOverflow(!!global, changedElements)) issues.set('document-overflow', [{ id: '', message: '有正文或代码超出页面边界，请调整内容或页面设置。', blocking: true }]);
    else issues.delete('document-overflow');
    itemLinks(changedElements, adjustable);
    previous = options;
    return { issues: [...issues.values()].flat(), adjustable: [...adjustable] };
  } };
}

export async function layoutDocument(root: HTMLElement, options: PdfOptions): Promise<LayoutIssue[]> { return (await createLayoutSession(root).update(options)).issues; }
