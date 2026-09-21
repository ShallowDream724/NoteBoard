import { paperSize, type LayoutIssue, type LayoutReport, type PdfOptions } from './model';

const ITEM_URI = 'https://noteboard.invalid/export-item/';
function extent(element: HTMLElement) {
  const scale = Number(element.style.zoom) || 1;
  return Math.max(element.scrollWidth * scale, element.getBoundingClientRect().width);
}
function fit(element: HTMLElement, width: number, measured: number) {
  const scale = Math.min(1, width / measured);
  if (scale < .999) element.style.zoom = String(scale);
}

/** Clone only retained cells. Work is proportional to output size, not to
 * original cells multiplied by every continuation group. */
function splitColumns(table: HTMLTableElement, width: number, firstColumnWidth: number): HTMLElement | null {
  const rows = Array.from(table.rows), count = rows[0]?.cells.length ?? 0;
  if (count < 3 || rows.some(row => Array.from(row.cells).some(cell => cell.colSpan > 1 || cell.rowSpan > 1))) return null;
  const keyWidth = Math.min(width * .3, Math.max(70, firstColumnWidth));
  const perGroup = Math.max(1, Math.floor((width - keyWidth) / 85));
  const group = document.createElement('div'); group.dataset.exportTableGroup = table.dataset.exportItem;
  for (let start = 1, part = 1; start < count; start += perGroup, part++) {
    const clone = table.cloneNode(false) as HTMLTableElement;
    clone.classList.add('table-wrap'); clone.style.removeProperty('width'); clone.style.removeProperty('min-width');
    const head = clone.createTHead(), body = clone.createTBody();
    for (const row of rows) {
      const rowClone = row.cloneNode(false) as HTMLTableRowElement;
      rowClone.append(row.cells[0].cloneNode(true));
      for (let column = start; column < Math.min(count, start + perGroup); column++) if (row.cells[column]) rowClone.append(row.cells[column].cloneNode(true));
      (row.parentElement?.tagName === 'THEAD' ? head : body).append(rowClone);
    }
    const caption = document.createElement('div'); caption.className = 'table-continuation'; caption.textContent = `续表 ${part}`;
    group.append(caption, clone);
  }
  table.replaceWith(group); return group;
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
        if (row.cells[0]) wrap(row.cells[0]);
        if (row.cells.length > 1) wrap(row.cells[row.cells.length - 1]);
      }
    } else wrap(element);
  }
}

/** Retained layout state. Global typography changes reset all items; an item
 * override restores/reflows that item only. No document reparse or HTML reset. */
export function createLayoutSession(root: HTMLElement) {
  let previous: PdfOptions | undefined;
  const originals = new Map<string, string>(); // only tables that actually split
  const itemIndex = new Map<string, HTMLElement[]>();
  const groups = new Map<string, HTMLElement>();
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
      element.style.removeProperty('zoom'); element.classList.remove('wrap', 'table-wrap');
      element.querySelector<HTMLElement>('.katex-html')?.style.removeProperty('zoom');
      element.querySelectorAll('a.export-item-link').forEach(link => link.replaceWith(...link.childNodes));
    });
    issues.delete(id);
  };
  return { update(options: PdfOptions): LayoutReport {
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
    const issue = (id: string, message: string, blocking = true) => { issues.set(id, [...(issues.get(id) ?? []), { id, message, blocking }]); };
    const tables = [...changed].flatMap(elements).filter((e): e is HTMLTableElement => e.tagName === 'TABLE');
    const tableWidths = tables.map(table => ({ width: extent(table), first: table.rows[0]?.cells[0]?.getBoundingClientRect().width ?? 70 }));
    tables.forEach((table, index) => {
      const id = table.dataset.exportItem!, mode = options.items[id] ?? 'auto';
      if (tableWidths[index].width <= width + 1 && !adjustable.has(id)) return;
      adjustable.add(id);
      if (mode === 'fit') fit(table, width, tableWidths[index].width);
      else {
        const columns = table.rows[0]?.cells.length ?? 0;
        if (mode === 'columns' || (mode === 'auto' && columns * 85 > width)) {
          const original = table.outerHTML;
          const group = splitColumns(table, width, tableWidths[index].first);
          if (group) {
            originals.set(id, original); groups.set(id, group);
            const ids = new Set([id, ...Array.from(table.querySelectorAll<HTMLElement>('[data-export-item]'), e => e.dataset.exportItem!)]);
            ids.forEach(key => itemIndex.delete(key)); register(group);
          } else { table.classList.add('table-wrap'); if (mode === 'columns') issue(id, '合并单元格无法分栏，请选择换行或缩到正文宽度'); }
        } else table.classList.add('table-wrap');
      }
      // Formula widths in changed table cells also need to be checked.
      elements(id).forEach(e => e.querySelectorAll<HTMLElement>('.export-math[data-export-item]').forEach(math => changed.add(math.dataset.exportItem!)));
    });
    const formulas = [...changed].flatMap(elements).filter(e => e.classList.contains('export-math'));
    const measures = formulas.map(element => {
      const math = element.querySelector<HTMLElement>('.katex-html'); const cell = element.closest<HTMLElement>('th,td');
      const available = cell ? Math.max(1, cell.clientWidth - parseFloat(getComputedStyle(cell).paddingLeft) - parseFloat(getComputedStyle(cell).paddingRight)) : width;
      const measured = math ? extent(math) : 0;
      return { math, available, measured, wide: measured > available + 1 };
    });
    formulas.forEach((element, index) => {
      const id = element.dataset.exportItem!, mode = options.items[id] ?? 'auto';
      if (element.dataset.renderError) { issue(id, '公式语法有误，请返回正文修改'); return; }
      const { math, available, measured, wide } = measures[index]; if (!math) return;
      if (wide || adjustable.has(id)) {
        adjustable.add(id);
        if (mode === 'fit') fit(math, available, measured);
        else element.classList.add('wrap');
      }
    });
    // Validate after the write phase, avoiding a forced full layout per formula.
    formulas.forEach((element, i) => {
      const { math, available } = measures[i], id = element.dataset.exportItem!;
      if (math && extent(math) > available + 1) issue(id, '此公式无法在安全边界换行，可选择缩到正文宽度');
      if (element.getBoundingClientRect().height > pageHeight) issue(id, '公式高于一页，请拆成多个公式');
    });
    for (const id of changed) for (const table of elements(id).filter(e => e.tagName === 'TABLE'))
      if (extent(table) > width + 1) issue(id, '表格仍超出正文宽度，可选择缩放');
    for (const id of changed) for (const table of elements(id).filter(e => e.tagName === 'TABLE'))
      for (const row of table.querySelectorAll('tr')) row.classList.toggle('export-tall-row', row.getBoundingClientRect().height > pageHeight);
    if (global) {
      for (const image of root.querySelectorAll('img')) { image.style.maxHeight = `${pageHeight}px`; image.style.objectFit = 'contain'; if (!image.complete || !image.naturalWidth) issue('', '有图片未能加载，请检查图片路径'); }
      if (root.querySelector('[data-export-source-only]')) issue('', '此图表暂按源码导出', false);
    }
    itemLinks([...changed].flatMap(elements), adjustable);
    previous = options;
    return { issues: [...issues.values()].flat(), adjustable: [...adjustable] };
  } };
}

export function layoutDocument(root: HTMLElement, options: PdfOptions): LayoutIssue[] { return createLayoutSession(root).update(options).issues; }
