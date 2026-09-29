import type { MatrixSource } from '../../core/math/structure';
import { SizeIndex } from '../../core/dom/sizeIndex';
import { findScrollContainer } from '../../core/dom/scrollContainer';
import { contentViewport, observeContentViewport } from '../../core/dom/contentViewport';
import { queueMath, refreshMathQueue } from './mathRenderQueue';
import { observeNearby, viewportIsScrolling } from './nearViewport';
import { mountMathReadingLayout } from './mathReadingLayout';
import { MATH_LIMITS, checkMathSource, mathLimitFailure, mathMarkupNodeCount, type MathLimitReason } from './mathLimits';
import './matrixPreview.css';

const number = /^-?\d+(?:\.\d+)?$/;
function rowGap(gap: string | undefined, font: number): number {
  const match = gap?.match(/\[(-?\d+(?:\.\d+)?)(pt|em|ex|mm|cm)\]/);
  if (!match) return 0;
  const unit: Record<string, number> = { pt: 96 / 72, em: font * 1.21, ex: font * .52, mm: 96 / 25.4, cm: 96 / 2.54 };
  return Number(match[1]) * unit[match[2]];
}
interface Cell { element: HTMLElement; row: number; column: number; source: string; ready: boolean; priority: number; nodes: number; budgetNodes?: number; cancel?: () => void }
let matrixId = 0;

/** A large matrix stays one mathematical object. Only its visible cells have
 * markup; the surrounding continuous delimiters and source remain intact. */
export function mountMatrixPreview(host: HTMLElement, source: MatrixSource) {
  const id = `matrix:${++matrixId}`;
  const scroll = findScrollContainer(host), font = parseFloat(getComputedStyle(host).fontSize) || 16;
  const gaps = source.rows.map((_, row) => rowGap(source.rowGaps[row], font));
  const rowSizes = new SizeIndex(gaps.map(gap => Math.max(font, font * 1.65 + gap)));
  const widths = new Float64Array(source.columns).fill(font * 2);
  // A bounded source sample allocates initial geometry without synchronous
  // canvas/font work across every cell. Visible cells refine their own columns.
  const samples = Math.min(source.rows.length, Math.max(1, Math.floor(2048 / source.columns)), 32);
  for (let sample = 0; sample < samples; sample++) {
    const row = source.rows[Math.floor(sample * (source.rows.length - 1) / Math.max(1, samples - 1))];
    row.forEach((cell, c) => {
      const plain = cell.slice(0, 256).replace(/\\[a-zA-Z]+/g, 'M').replace(/[{}_^]/g, '');
      widths[c] = Math.max(widths[c], Math.min(1200, plain.length * font * .65) + font);
    });
  }
  const columns = new SizeIndex(widths);
  const view = document.createElement('span'); view.className = 'math-preview nb-matrix-view';
  const prefix = document.createElement('span'); prefix.className = 'nb-matrix-prefix'; prefix.textContent = checkMathSource(source.prefix)?.error ?? source.prefix;
  const frame = document.createElement('span'); frame.className = `nb-matrix-frame nb-matrix-${source.environment}`;
  const grid = document.createElement('span'); grid.className = 'nb-matrix-grid';
  frame.append(grid); view.append(prefix, frame); host.replaceChildren(view);
  let disposed = false, scheduled = 0, firstVisibleRow = 0, near = false, visible = false, mountedNodes = 0;
  let windowNotice: HTMLElement | undefined;
  let cancelPrefix: (() => void) | undefined, prefixReady = false;
  const cells = new Map<string, Cell>();
  const reading = mountMathReadingLayout({ host, preview: view, owner: host.closest<HTMLElement>('.ProseMirror') ?? host.parentElement ?? host, display: !!host.closest('.math-node-display') });
  const geometry = () => { grid.style.width = `${columns.total}px`; grid.style.height = `${rowSizes.total}px`; };
  geometry();
  const place = (cell: Cell) => {
    cell.element.style.left = `${columns.prefix(cell.column)}px`; cell.element.style.top = `${rowSizes.prefix(cell.row)}px`;
    cell.element.style.minWidth = `${columns.at(cell.column)}px`;
  };
  const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(entries => {
    let changed = false, correction = 0;
    for (const entry of entries) {
      const cell = cells.get((entry.target as HTMLElement).dataset.matrixCell!); if (!cell || cell.element !== entry.target || !cell.ready) continue;
      const height = (entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height) + font * .3 + gaps[cell.row];
      const width = entry.borderBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;
      if (height > rowSizes.at(cell.row) + .5) { const delta = rowSizes.set(cell.row, height); if (cell.row < firstVisibleRow) correction += delta; changed = true; }
      if (width > columns.at(cell.column) + .5) { columns.set(cell.column, width); changed = true; }
    }
    if (changed) { geometry(); reading.invalidate(); cells.forEach(place); if (correction) {
      const owner = contentViewport(grid, scroll).scrollY;
      const scale = grid.getBoundingClientRect().width / (grid.offsetWidth || 1);
      const ownerScale = owner.getBoundingClientRect().width / (owner.offsetWidth || 1);
      owner.scrollTop += correction * scale / (ownerScale || 1);
    } schedule(); }
  });
  const paint = (cell: Cell, html?: string, error?: string, limited?: MathLimitReason) => {
    if (disposed || cells.get(cell.element.dataset.matrixCell!) !== cell) return;
    const desiredNodes = html ? 1 + mathMarkupNodeCount(html) : 2;
    if (mountedNodes - cell.nodes + desiredNodes > MATH_LIMITS.matrixViewportNodes) {
      cell.budgetNodes = desiredNodes;
      html = ''; limited = 'nodes'; error = mathLimitFailure(limited).error;
    } else cell.budgetNodes = undefined;
    const nodes = limited ? 2 : desiredNodes; mountedNodes += nodes - cell.nodes; cell.nodes = nodes;
    if (html) cell.element.innerHTML = html;
    else cell.element.textContent = limited ? '单元格公式过大，请编辑源码' : error ? cell.source : cell.source.replace(/^-/, '−');
    if (error) cell.element.title = error; else cell.element.removeAttribute('title');
    cell.ready = true; resize?.observe(cell.element);
  };
  const requestCell = (cell: Cell, key: string) => {
    cell.cancel = queueMath(`${id}:${key}`, { latex: cell.source, display: false, priority: () => cell.priority, isScrolling: () => viewportIsScrolling(view), done: result => { cell.cancel = undefined; paint(cell, result.html, result.error, result.limited); } });
  };
  const clearCells = () => {
    resize?.disconnect(); cells.forEach(cell => { cell.cancel?.(); cell.element.remove(); }); cells.clear(); mountedNodes = 0;
  };
  const update = () => {
    scheduled = 0; if (disposed || !near || !scroll.clientHeight) return;
    const bounds = grid.getBoundingClientRect(), viewport = contentViewport(grid, scroll).bounds;
    const scale = bounds.width / (grid.offsetWidth || 1) || 1;
    const height = viewport.height / scale, width = viewport.width / scale;
    const top = Math.max(0, (viewport.top - bounds.top) / scale), left = Math.max(0, (viewport.left - bounds.left) / scale);
    firstVisibleRow = rowSizes.indexAt(top);
    let fromRow = rowSizes.indexAt(Math.max(0, top - height / 2));
    let toRow = Math.min(source.rows.length, rowSizes.indexAt(top + height * 1.5) + 1);
    let fromColumn = columns.indexAt(Math.max(0, left - width / 2));
    let toColumn = Math.min(source.columns, columns.indexAt(left + width * 1.5) + 1);
    const lastVisibleRow = rowSizes.indexAt(top + height), firstVisibleColumn = columns.indexAt(left), lastVisibleColumn = columns.indexAt(left + width);
    if ((toRow - fromRow) * (toColumn - fromColumn) > MATH_LIMITS.matrixViewportCells) {
      fromRow = firstVisibleRow; toRow = lastVisibleRow + 1; fromColumn = firstVisibleColumn; toColumn = lastVisibleColumn + 1;
    }
    if ((toRow - fromRow) * (toColumn - fromColumn) > MATH_LIMITS.matrixViewportCells) {
      clearCells();
      if (!windowNotice) {
        windowNotice = document.createElement('span'); windowNotice.setAttribute('role', 'status');
        windowNotice.textContent = '当前矩阵窗口过大，已保留完整源码，请编辑源码以拆分矩阵。';
        windowNotice.style.cssText = 'position:absolute;max-width:320px;white-space:normal;'; grid.append(windowNotice);
      }
      windowNotice.style.left = `${left}px`; windowNotice.style.top = `${top}px`; return;
    }
    windowNotice?.remove(); windowNotice = undefined;
    for (const [key, cell] of cells) if (cell.row < fromRow || cell.row >= toRow || cell.column < fromColumn || cell.column >= toColumn) {
      cell.cancel?.(); resize?.unobserve(cell.element); cell.element.remove(); cells.delete(key); mountedNodes -= cell.nodes;
    }
    // Reserve the two-node placeholder for every newly admitted cell before any
    // completed markup is allowed to consume the rest of the window budget.
    const newCells = (toRow - fromRow) * (toColumn - fromColumn) - cells.size;
    if (mountedNodes + newCells * 2 > MATH_LIMITS.matrixViewportNodes) clearCells();
    const fragment = document.createDocumentFragment();
    for (let row = fromRow; row < toRow; row++) for (let column = fromColumn; column < toColumn; column++) {
      const key = `${row}:${column}`;
      const priority = visible && row >= firstVisibleRow && row <= lastVisibleRow && column >= firstVisibleColumn && column <= lastVisibleColumn ? 0 : 1;
      const existing = cells.get(key); if (existing) {
        existing.priority = priority;
        if (existing.budgetNodes && !existing.cancel && mountedNodes - existing.nodes + existing.budgetNodes <= MATH_LIMITS.matrixViewportNodes) requestCell(existing, key);
        continue;
      }
      const element = document.createElement('span'); element.className = 'nb-matrix-cell'; element.dataset.matrixCell = key;
      const cell: Cell = { element, row, column, source: source.rows[row][column] ?? '', ready: false, priority, nodes: 2 }; cells.set(key, cell); mountedNodes += 2; place(cell); fragment.append(element);
      if (!cell.source || (cell.source.length <= MATH_LIMITS.inputCharacters && number.test(cell.source))) paint(cell);
      else requestCell(cell, key);
    }
    grid.append(fragment); refreshMathQueue();
  };
  function schedule() { if (!scheduled && !disposed) scheduled = requestAnimationFrame(update); }
  let stopViewport = () => {};
  const stopNear = observeNearby(view, (value, isVisible) => {
    if (value && !near) stopViewport = observeContentViewport(grid, schedule, scroll);
    else if (!value && near) { stopViewport(); stopViewport = () => {}; }
    near = value; visible = isVisible;
    reading.nearby(near);
    if (near) {
      schedule();
      if (source.prefix && !prefixReady && !cancelPrefix) cancelPrefix = queueMath(`${id}:prefix`, { latex: source.prefix, display: false, priority: () => visible ? 0 : 1, done: result => { cancelPrefix = undefined; prefixReady = true; if (!result.error) prefix.innerHTML = result.html; else if (result.limited) prefix.textContent = result.error; } });
    } else {
      cancelPrefix?.(); cancelPrefix = undefined;
      clearCells(); windowNotice?.remove(); windowNotice = undefined;
    }
  });
  if (source.suffix) view.append(document.createTextNode(source.suffix));
  schedule();
  return () => { disposed = true; cancelPrefix?.(); cancelAnimationFrame(scheduled); stopNear(); stopViewport(); reading.dispose(); resize?.disconnect(); cells.forEach(cell => cell.cancel?.()); cells.clear(); view.remove(); };
}
