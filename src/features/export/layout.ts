import { paperSize, type LayoutIssue, type LayoutReport, type PdfOptions } from './model';
import { planMath, planTableColumns, type TablePlan } from './layoutPolicy';
import { readableScale, renderedScale } from './layoutMetrics';
import { continueFraction, continueMatrix } from './mathLayout';
import { createProseOverflowCheck } from './proseOverflow';
import { allocateTableWidths, captureTablePresentation, markTableEdges, measureTableWidths, restoreTablePresentation, setAutomaticTableWidths, tableColumnWidths, type TablePresentation } from './tableLayout';
import { continueTableRows } from './tableContinuation';
import { addItemLocations, clearItemLocations } from './itemLocations';

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
  if (count < 3 || rows.some(row => Array.from(row.cells).some(cell => cell.colSpan > 1 || cell.rowSpan !== 1))) return null;
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

/** Retained layout state. Global typography changes reset all items; an item
 * override restores/reflows that item only. No document reparse or HTML reset. */
export function createLayoutSession(root: HTMLElement) {
  let previous: PdfOptions | undefined;
  const originals = new Map<string, string>(); // only tables that actually split
  const formulaOriginals = new Map<string, string>(); // only structurally continued formulas
  const itemIndex = new Map<string, HTMLElement[]>();
  const groups = new Map<string, HTMLElement>();
  const tablePresentation = new Map<string, TablePresentation>();
  const checkProseOverflow = createProseOverflowCheck(root);
  const register = (scope: HTMLElement) => {
    for (const element of scope.querySelectorAll<HTMLElement>('[data-export-item]')) {
      const id = element.dataset.exportItem!;
      if (element.tagName === 'TABLE' && !tablePresentation.has(id)) tablePresentation.set(id, captureTablePresentation(element));
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
      if (element.tagName === 'TABLE') {
        const baseline = tablePresentation.get(id);
        if (baseline) restoreTablePresentation(element, baseline);
        element.querySelectorAll('.export-tall-row').forEach(row => row.classList.remove('export-tall-row'));
      }
      element.querySelector<HTMLElement>('.katex-html')?.style.removeProperty('zoom');
      clearItemLocations(element);
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
    // Restore table structure before resetting the formulas in its restored cells.
    const tableIds = new Set([...changed].filter(id => groups.has(id) || elements(id).some(element => element.tagName === 'TABLE')));
    tableIds.forEach(reset); changed.forEach(id => { if (!tableIds.has(id)) reset(id); });
    const [paperWidth, paperHeight] = paperSize(options);
    const width = (paperWidth - options.marginMm * 2) * 96 / 25.4;
    const numberBand = options.pageNumbers ? Math.max(0, 8 - options.marginMm) : 0;
    const pageHeight = (paperHeight - options.marginMm * 2 - numberBand) * 96 / 25.4;
    const issue = (id: string, message: string, blocking = true) => { if (id) adjustable.add(id); issues.set(id, [...(issues.get(id) ?? []), { id, message, blocking }]); };
    const tables = [...changed].flatMap(elements).filter((e): e is HTMLTableElement => e.tagName === 'TABLE');
    const manualTables = new Set(tables.filter(table => {
      const manual = Array.from(table.querySelectorAll<HTMLTableColElement>(':scope > colgroup > col')).some(col => !!col.style.width);
      // Fully specified schema tables already carry their exact total width.
      // Fixed layout makes that width authoritative before formula reflow.
      if (manual && table.style.width) table.classList.add('table-wrap');
      return manual;
    }));
    const observed = tables.map(table => ({
      width: manualTables.has(table) ? table.getBoundingClientRect().width : extent(table),
      columns: tableColumnWidths(table).map(width => manualTables.has(table) ? width : Math.ceil(width) + 2),
    }));
    // A naturally narrow table already fits. Repeating intrinsic-width passes
    // adds work without changing its layout decision.
    const measured = measureTableWidths(tables.filter((table, index) => !manualTables.has(table) && observed[index].width >= width - 1), width);
    const tableWidths = tables.map((table, index) => {
      const manual = manualTables.has(table), intrinsic = measured.get(table) ?? null;
      // A scaled table rounds border/text metrics differently. A small guard on
      // natural widths prevents a final identifier character wrapping by 1 px.
      const columns = intrinsic?.natural ?? observed[index].columns;
      return { manual, intrinsic, width: Math.max(observed[index].width, columns.reduce((sum, value) => sum + value, 0)), columns };
    });
    tables.forEach((table, index) => {
      const id = table.dataset.exportItem!, mode = options.items[id] ?? 'auto';
      if (tableWidths[index].width <= width + 1 && !adjustable.has(id)) return;
      adjustable.add(id);
      if (mode === 'fit') fit(table, width, tableWidths[index].width);
      else if (mode === 'wrap') {
        const columns = tableWidths[index].columns;
        const total = columns.reduce((sum, value) => sum + value, 0);
        // An explicit wrap choice overrides fixed editor widths in this preview
        // only. Restore the original colgroup before every later mode change.
        if (total > 0) setAutomaticTableWidths(table, columns.map(value => value / total * width));
      }
      else {
        const manual = tableWidths[index].manual;
        const allocated = !manual && mode !== 'columns' && tableWidths[index].intrinsic
          ? allocateTableWidths(tableWidths[index].intrinsic!, width) : null;
        if (allocated) setAutomaticTableWidths(table, allocated);
        else if (mode === 'columns' || mode === 'auto') {
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
    for (const id of changed) for (const table of elements(id).filter((element): element is HTMLTableElement => element.tagName === 'TABLE')) {
      markTableEdges(table);
      const result = continueTableRows(table, pageHeight);
      if (result.changed) {
        markTableEdges(table);
        if (!originals.has(id)) { originals.set(id, result.original!); groups.set(id, table); }
        const scope = groups.get(id)!;
        const ids = new Set([id, ...Array.from(scope.querySelectorAll<HTMLElement>('[data-export-item]'), element => element.dataset.exportItem!)]);
        ids.forEach(key => itemIndex.delete(key)); register(scope);
        if (scope.dataset.exportItem) itemIndex.set(id, [scope]);
      }
      if (result.unsupported) issue(id, '此表含跨行合并或不可拆分的超高内容，续页保留原结构；请检查分页。', false);
    }
    if (global) {
      for (const image of root.querySelectorAll('img')) { image.style.maxHeight = `${pageHeight}px`; image.style.objectFit = 'contain'; if (!image.complete || !image.naturalWidth) issue('', '有图片未能加载，请检查图片路径'); }
    }
    for (const id of changed) for (const diagram of elements(id).filter(element => element.classList.contains('export-diagram'))) {
      if (diagram.dataset.diagramError) { issue(id, `${diagram.dataset.diagramError}。已保留源码供检查。`, false); continue; }
      const svg = diagram.querySelector<SVGSVGElement>(':scope > svg');
      if (svg) {
        svg.style.maxHeight = `${pageHeight}px`;
        const naturalWidth = parseFloat(svg.getAttribute('width') ?? ''), displayed = svg.getBoundingClientRect().width;
        // A large vector can fit geometrically while its labels become illegible.
        // The explicit fit mode remains the user's choice for that tradeoff.
        if (naturalWidth > displayed && displayed > 0 && options.items[id] !== 'fit') {
          const scale = displayed / naturalWidth;
          const labels = Array.from(svg.querySelectorAll<SVGElement>('text,.nodeLabel')).filter(label => label.textContent?.trim());
          if (labels.some(label => (parseFloat(getComputedStyle(label).fontSize) || 16) * scale < 8 * 96 / 72)) issue(id, '图表已适应页面，但文字较小；可选择适宽缩放或简化图表。');
        }
      }
      const available = availableWidth(diagram, width), measured = extent(diagram);
      if (options.items[id] === 'fit' && measured > available) fit(diagram, available, measured);
      if (extent(diagram) > available + 1) issue(id, '图表超出正文宽度，请选择适宽缩放或调整页面设置。');
    }
    // Final geometry includes prose, headings, code, and imported block markup.
    // A clipping boundary is never itself evidence that a document fits.
    const changedElements = [...changed].flatMap(elements);
    if (checkProseOverflow(!!global, changedElements)) issues.set('document-overflow', [{ id: '', message: '有正文或代码超出页面边界，请调整内容或页面设置。', blocking: true }]);
    else issues.delete('document-overflow');
    addItemLocations(changedElements, adjustable);
    previous = options;
    return { issues: [...issues.values()].flat(), adjustable: [...adjustable] };
  } };
}

export async function layoutDocument(root: HTMLElement, options: PdfOptions): Promise<LayoutIssue[]> { return (await createLayoutSession(root).update(options)).issues; }
