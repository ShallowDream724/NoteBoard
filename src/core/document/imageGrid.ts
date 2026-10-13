/** Geometry shared by editing, public HTML and all export projections. */
export const IMAGE_GRID_MAX_COLUMNS = 6;
export const IMAGE_GRID_MAX_CELLS = 96;
export const isImageGridColumns = (value: unknown): value is number =>
  Number.isInteger(value) && Number(value) >= 1 && Number(value) <= IMAGE_GRID_MAX_COLUMNS;
export const imageGridColumns = (value: unknown): number => isImageGridColumns(value) ? value : 2;

/** Keep each surviving cell at its row/column, rather than reflowing the flat
 * sequence when a right column or bottom row is removed. Old ragged grids pad
 * only when the user explicitly edits their shape. */
export function resizeImageGridItems<T>(
  items: readonly T[], oldColumns: number, columns: number, rows: number, empty: () => T,
): T[] | null {
  if (!isImageGridColumns(columns) || !Number.isInteger(rows) || rows < 1 || rows * columns > IMAGE_GRID_MAX_CELLS) return null;
  const before = imageGridColumns(oldColumns), result: T[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      result.push(col < before ? items[row * before + col] ?? empty() : empty());
    }
  }
  return result;
}
