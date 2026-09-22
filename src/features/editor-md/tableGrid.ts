/** A sparse table grid: one placement per real cell, never one object per covered slot. */
export interface TableCellPlacement<T> {
  cell: T;
  row: number;
  column: number;
  cellIndex: number;
  colspan: number;
  rowspan: number;
}

const spanSize = (value: unknown) => typeof value === 'number' && Number.isFinite(value)
  ? Math.max(1, Math.min(10000, Math.floor(value))) : 1;

export function buildLogicalTableGrid<T>(
  rows: readonly (readonly T[])[],
  spans: (cell: T) => { colspan?: unknown; rowspan?: unknown },
): { width: number; rows: TableCellPlacement<T>[][] } {
  type Occupied = { start: number; end: number; until: number };
  let occupied: Occupied[] = [];
  let width = 0;
  const placements = rows.map((cells, row) => {
    occupied = occupied.filter(interval => interval.until > row);
    const added: Occupied[] = [];
    let column = 0, cursor = 0;
    const result = cells.map((cell, cellIndex) => {
      const attrs = spans(cell), colspan = spanSize(attrs.colspan), rowspan = spanSize(attrs.rowspan);
      while (cursor < occupied.length) {
        const interval = occupied[cursor];
        if (interval.end <= column) { cursor++; continue; }
        if (interval.start >= column + colspan) break;
        column = interval.end;
        cursor++;
      }
      const placement = { cell, row, column, cellIndex, colspan, rowspan };
      if (rowspan > 1) added.push({ start: column, end: column + colspan, until: row + rowspan });
      column += colspan;
      width = Math.max(width, column);
      return placement;
    });
    // Both lists are already sorted by column; merge without re-sorting each cell.
    const merged: Occupied[] = [];
    let oldIndex = 0, newIndex = 0;
    while (oldIndex < occupied.length || newIndex < added.length) {
      if (newIndex >= added.length || (oldIndex < occupied.length && occupied[oldIndex].start < added[newIndex].start)) {
        merged.push(occupied[oldIndex++]);
      } else merged.push(added[newIndex++]);
    }
    occupied = merged;
    return result;
  });
  return { width, rows: placements };
}
