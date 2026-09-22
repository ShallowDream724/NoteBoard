import type { MatrixSource } from '../../core/math/structure';
import { SizeIndex } from '../../core/dom/sizeIndex';
import { findScrollContainer } from '../../core/dom/scrollContainer';
import { renderMath } from './mathRendering';
import { observeNearby } from './nearViewport';
import './matrixPreview.css';

const number = /^-?\d+(?:\.\d+)?$/;
function rowGap(gap: string | undefined, font: number): number {
  const match = gap?.match(/\[(-?\d+(?:\.\d+)?)(pt|em|ex|mm|cm)\]/);
  if (!match) return 0;
  const unit: Record<string, number> = { pt: 96 / 72, em: font * 1.21, ex: font * .52, mm: 96 / 25.4, cm: 96 / 2.54 };
  return Number(match[1]) * unit[match[2]];
}
interface Cell { element: HTMLElement; row: number; column: number; source: string; ready: boolean }

/** A large matrix stays one mathematical object. Only its visible cells have
 * markup; the surrounding continuous delimiters and source remain intact. */
export function mountMatrixPreview(host: HTMLElement, source: MatrixSource) {
  const scroll = findScrollContainer(host), font = parseFloat(getComputedStyle(host).fontSize) || 16;
  const gaps = source.rows.map((_, row) => rowGap(source.rowGaps[row], font));
  const rowSizes = new SizeIndex(gaps.map(gap => Math.max(font, font * 1.65 + gap)));
  const widths = new Float64Array(source.columns).fill(font * 2);
  const canvas = document.createElement('canvas'), context = canvas.getContext('2d');
  if (context) context.font = `${font * 1.21}px KaTeX_Main, serif`;
  // Cheap intrinsic estimate, one linear source pass. Exact visible-cell sizes
  // refine it later; no KaTeX/DOM construction for distant cells.
  for (const row of source.rows) row.forEach((cell, c) => {
    const plain = cell.replace(/\\[a-zA-Z]+/g, 'M').replace(/[{}_^]/g, '');
    widths[c] = Math.max(widths[c], Math.min(1200, context?.measureText(plain).width ?? plain.length * font * .65) + font);
  });
  const columns = new SizeIndex(widths);
  const view = document.createElement('span'); view.className = 'math-preview nb-matrix-view';
  const prefix = document.createElement('span'); prefix.className = 'nb-matrix-prefix'; prefix.textContent = source.prefix;
  const frame = document.createElement('span'); frame.className = `nb-matrix-frame nb-matrix-${source.environment}`;
  const grid = document.createElement('span'); grid.className = 'nb-matrix-grid';
  frame.append(grid); view.append(prefix, frame); host.replaceChildren(view);
  let disposed = false, scheduled = 0, pumping = false, firstVisibleRow = 0, near = false;
  const cells = new Map<string, Cell>(), pending = new Map<string, Cell>();
  const geometry = () => { grid.style.width = `${columns.total}px`; grid.style.height = `${rowSizes.total}px`; };
  geometry();
  const place = (cell: Cell) => {
    cell.element.style.left = `${columns.prefix(cell.column)}px`; cell.element.style.top = `${rowSizes.prefix(cell.row)}px`;
    cell.element.style.minWidth = `${columns.at(cell.column)}px`;
  };
  const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(entries => {
    let changed = false, correction = 0;
    for (const entry of entries) {
      const cell = cells.get((entry.target as HTMLElement).dataset.matrixCell!); if (!cell || !cell.ready) continue;
      const height = (entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height) + font * .3 + gaps[cell.row];
      const width = entry.borderBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;
      if (height > rowSizes.at(cell.row) + .5) { const delta = rowSizes.set(cell.row, height); if (cell.row < firstVisibleRow) correction += delta; changed = true; }
      if (width > columns.at(cell.column) + .5) { columns.set(cell.column, width); changed = true; }
    }
    if (changed) { geometry(); cells.forEach(place); if (correction) scroll.scrollTop += correction; schedule(); }
  });
  const paint = (cell: Cell, html?: string, error?: string) => {
    if (disposed || cells.get(cell.element.dataset.matrixCell!) !== cell) return;
    if (html) cell.element.innerHTML = html;
    else cell.element.textContent = error ? cell.source : cell.source.replace(/^-/, '−');
    if (error) cell.element.title = error;
    cell.ready = true; resize?.observe(cell.element);
  };
  const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  const pump = async () => {
    if (pumping) return; pumping = true;
    try {
      while (!disposed && pending.size) {
        const batch = [...pending.entries()].slice(0, 16); batch.forEach(([key]) => pending.delete(key));
        const rendered = await Promise.all(batch.map(async ([,cell]) => ({ cell, result: await renderMath(cell.source, false) })));
        await nextFrame(); if (disposed) break;
        for (const { cell, result } of rendered) paint(cell, result.html, result.error);
      }
    } finally { pumping = false; }
  };
  const update = () => {
    scheduled = 0; if (disposed || !near || !scroll.clientHeight) return;
    const bounds = grid.getBoundingClientRect(), viewport = scroll.getBoundingClientRect();
    const top = Math.max(0, viewport.top - bounds.top), left = Math.max(0, viewport.left - bounds.left);
    firstVisibleRow = rowSizes.indexAt(top);
    const fromRow = rowSizes.indexAt(Math.max(0, top - scroll.clientHeight / 2));
    const toRow = Math.min(source.rows.length, rowSizes.indexAt(top + scroll.clientHeight * 1.5) + 1);
    const fromColumn = columns.indexAt(Math.max(0, left - scroll.clientWidth / 2));
    const toColumn = Math.min(source.columns, columns.indexAt(left + scroll.clientWidth * 1.5) + 1);
    for (const [key, cell] of cells) if (cell.row < fromRow || cell.row >= toRow || cell.column < fromColumn || cell.column >= toColumn) {
      resize?.unobserve(cell.element); cell.element.remove(); cells.delete(key); pending.delete(key);
    }
    const fragment = document.createDocumentFragment();
    for (let row = fromRow; row < toRow; row++) for (let column = fromColumn; column < toColumn; column++) {
      const key = `${row}:${column}`; if (cells.has(key)) continue;
      const element = document.createElement('span'); element.className = 'nb-matrix-cell'; element.dataset.matrixCell = key;
      const cell: Cell = { element, row, column, source: source.rows[row][column] ?? '', ready: false }; cells.set(key, cell); place(cell); fragment.append(element);
      if (!cell.source || number.test(cell.source)) paint(cell);
      else pending.set(key, cell);
    }
    grid.append(fragment); void pump();
  };
  function schedule() { if (!scheduled && !disposed) scheduled = requestAnimationFrame(update); }
  const viewportResize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule);
  viewportResize?.observe(scroll);
  const stopNear = observeNearby(view, value => {
    near = value;
    if (near) { scroll.addEventListener('scroll', schedule, { passive: true }); schedule(); }
    else { scroll.removeEventListener('scroll', schedule); resize?.disconnect(); cells.forEach(cell => cell.element.remove()); cells.clear(); pending.clear(); }
  });
  if (source.prefix) void renderMath(source.prefix, false).then(value => { if (!disposed && !value.error) prefix.innerHTML = value.html; });
  if (source.suffix) view.append(document.createTextNode(source.suffix));
  schedule();
  return () => { disposed = true; cancelAnimationFrame(scheduled); stopNear(); scroll.removeEventListener('scroll', schedule); resize?.disconnect(); viewportResize?.disconnect(); cells.clear(); pending.clear(); view.remove(); };
}
