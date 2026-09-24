export interface TableWidths { natural: number[]; minimum: number[] }

/** Preserve compact columns before distributing the remaining space. Long
 * content has a bounded claim on the page; math resolves its own safe breaks. */
export function allocateTableWidths({ natural, minimum }: TableWidths, available: number): number[] | null {
  if (!natural.length || natural.length !== minimum.length || available <= 0) return null;
  if (natural.reduce((sum, value) => sum + value, 0) <= available) return [...natural];
  const compactLimit = Math.min(available / 3, 160);
  const compact = natural.map(value => value <= compactLimit);
  const fixed = natural.reduce((sum, value, index) => sum + (compact[index] ? value : 0), 0);
  const flexible = compact.filter(value => !value).length;
  if (!flexible || fixed + flexible * 48 > available) return null;
  const budget = available - fixed;
  const floors = minimum.map((value, index) => compact[index] ? natural[index] : Math.min(value, budget / flexible));
  let remainder = available - floors.reduce((sum, value) => sum + value, 0);
  const result = [...floors];
  const demand = natural.map((value, index) => compact[index] ? 0 : Math.max(0, value - floors[index]));
  const total = demand.reduce((sum, value) => sum + value, 0);
  if (total > 0) result.forEach((value, index) => { result[index] = value + remainder * demand[index] / total; });
  else { remainder /= flexible; result.forEach((value, index) => { if (!compact[index]) result[index] = value + remainder; }); }
  return result;
}

/** Measure only width-constrained automatic tables. Each bounded batch performs
 * a natural-width read, then (only if useful) a minimum-width read. Grouping the
 * writes avoids forcing document layout twice for every table. Temporary DOM
 * is bounded by 10k nodes or one larger table, never a full document copy. */
export function measureTableWidths(tables: readonly HTMLTableElement[], available: number): Map<HTMLTableElement, TableWidths> {
  const result = new Map<HTMLTableElement, TableWidths>();
  let batch: Array<{ table: HTMLTableElement; clone: HTMLTableElement }> = [], nodes = 0;
  const widths = (table: HTMLTableElement) => Array.from(table.rows[0].cells, cell => Math.ceil(cell.getBoundingClientRect().width) + 2);
  const flush = () => {
    try {
      const natural = batch.map(({ clone }) => widths(clone));
      const needsMinimum = natural.map(columns => columns.reduce((sum, width) => sum + width, 0) > available
        && columns.some(width => width > Math.min(available / 3, 160)));
      batch.forEach(({ clone }, index) => {
        if (needsMinimum[index]) { clone.style.width = 'min-content'; clone.classList.add('export-table-measure-min'); }
      });
      batch.forEach(({ table, clone }, index) => {
        if (natural[index].every(value => value > 2)) result.set(table, {
          natural: natural[index], minimum: needsMinimum[index] ? widths(clone) : natural[index],
        });
      });
    } finally { batch.forEach(({ clone }) => clone.remove()); batch = []; nodes = 0; }
  };
  try {
    for (const table of tables) {
      const rows = Array.from(table.rows), count = rows[0]?.cells.length ?? 0;
      if (!count || rows.some(row => row.cells.length !== count || Array.from(row.cells).some(cell => cell.colSpan > 1 || cell.rowSpan !== 1))) continue;
      const cost = table.getElementsByTagName('*').length;
      if (batch.length && nodes + cost > 10_000) flush();
      const clone = table.cloneNode(true) as HTMLTableElement;
      batch.push({ table, clone }); nodes += cost;
      clone.removeAttribute('data-export-item'); clone.classList.add('export-table-measure');
      clone.style.cssText = 'position:absolute;visibility:hidden;left:0;top:0;width:max-content;max-width:none;min-width:0;table-layout:auto;zoom:1';
      clone.querySelectorAll('colgroup').forEach(group => group.remove());
      table.parentElement!.append(clone);
    }
    if (batch.length) flush();
  } finally { batch.forEach(({ clone }) => clone.remove()); }
  return result;
}

export function setAutomaticTableWidths(table: HTMLTableElement, widths: readonly number[]) {
  // Any explicit width makes the caller retain the complete manual colgroup.
  // Empty automatic colgroups must not add phantom columns beside ours.
  table.querySelectorAll(':scope > colgroup').forEach(group => group.remove());
  const columns = document.createElement('colgroup'); columns.dataset.exportColumns = 'true';
  for (const width of widths) { const column = document.createElement('col'); column.style.width = `${width}px`; columns.append(column); }
  table.prepend(columns); table.classList.add('table-wrap');
  table.style.setProperty('--export-table-width', `${widths.reduce((sum, width) => sum + width, 0)}px`);
}

export function resetAutomaticTableWidths(table: HTMLElement) {
  table.querySelectorAll('colgroup[data-export-columns]').forEach(group => group.remove());
  table.style.removeProperty('--export-table-width');
}

/** Cell-owned outer rules stop at real row boundaries when a table fragments.
 * Only the first logical column needs occupancy tracking; a spanning left cell
 * already owns that edge on the following rows. Rowspans stop at their section. */
export function markTableEdges(table: HTMLTableElement) {
  const rows = Array.from(table.rows);
  let start = 0;
  while (start < rows.length) {
    let end = start + 1;
    while (end < rows.length && rows[end].parentElement === rows[start].parentElement) end++;
    let leftSpan = 0;
    for (let index = start; index < end; index++) {
      const row = rows[index];
      for (const [column, cell] of Array.from(row.cells).entries()) {
        const span = cell.rowSpan === 0 ? end - index : Math.min(cell.rowSpan, end - index);
        const edges: string[] = [];
        if (column === 0 && leftSpan === 0) { edges.push('left'); leftSpan = span; }
        if (index === 0) edges.push('top');
        if (end === rows.length && index + span === end) edges.push('bottom');
        if (edges.length) cell.dataset.exportEdge = edges.join(' '); else delete cell.dataset.exportEdge;
      }
      leftSpan = Math.max(0, leftSpan - 1);
    }
    start = end;
  }
}
