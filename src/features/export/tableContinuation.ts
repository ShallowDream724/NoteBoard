type Parts = Map<number, Node>;
interface SliceContext { top: number; height: number; part: number; oversized: boolean }
const atomic = 'img,svg,video,canvas,table,.katex-html > .base,.math-continuation-part';
const partAt = (bottom: number, context: SliceContext) => Math.max(0, Math.floor((bottom - context.top - .5) / context.height));

function textParts(node: Text, context: SliceContext): Parts {
  const result: Parts = new Map(), text = node.data;
  const range = document.createRange();
  const bottom = (start: number, end: number) => {
    // Read the last character only, never all remaining lines at every split.
    range.setStart(node, Math.max(start, end - 1)); range.setEnd(node, end);
    return range.getBoundingClientRect().bottom;
  };
  let start = 0;
  while (start < text.length) {
    const firstEnd = start + (text.codePointAt(start)! > 0xffff ? 2 : 1);
    const part = Math.max(context.part, partAt(bottom(start, firstEnd), context));
    const boundary = context.top + (part + 1) * context.height;
    let end = text.length;
    if (bottom(start, end) > boundary) {
      let low = firstEnd, high = end;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (bottom(start, middle) <= boundary) low = middle; else high = middle - 1;
      }
      end = low;
      // Never divide a UTF-16 surrogate pair at a page boundary.
      if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
      if (end <= start) end = firstEnd;
    }
    const previous = result.get(part) as Text | undefined;
    if (previous) previous.appendData(text.slice(start, end)); else result.set(part, document.createTextNode(text.slice(start, end)));
    context.part = part; start = end;
  }
  return result;
}

/** Clone every retained leaf once. Wrappers are copied only when they appear in
 * an output part, preserving links and styling without cloning the long tail. */
function sliceNode(node: Node, context: SliceContext): Parts {
  if (node.nodeType === Node.TEXT_NODE) return textParts(node as Text, context);
  if (!(node instanceof HTMLElement) && !(node instanceof SVGElement)) return new Map([[context.part, node.cloneNode(true)]]);
  const rect = node.getBoundingClientRect();
  const isAtomic = node.matches(atomic) || (node.classList.contains('export-math') && rect.height <= context.height);
  if (isAtomic || !node.childNodes.length) {
    if (rect.height > context.height + 1) context.oversized = true;
    context.part = Math.max(context.part, partAt(rect.bottom, context));
    return new Map([[context.part, node.cloneNode(true)]]);
  }
  const result: Parts = new Map();
  for (const child of node.childNodes) for (const [part, content] of sliceNode(child, context)) {
    let shell = result.get(part);
    if (!shell) { shell = node.cloneNode(false); result.set(part, shell); }
    shell.appendChild(content);
  }
  return result;
}

function shortLabel(cell: HTMLTableCellElement, height: number) {
  const text = cell.textContent?.trim() ?? '';
  const line = parseFloat(getComputedStyle(cell).lineHeight) || 20;
  if (!text || text.length > 80 || cell.querySelector('.export-math,img,svg,table,pre')) return false;
  const range = document.createRange(); range.selectNodeContents(cell);
  return range.getBoundingClientRect().height <= Math.min(height / 4, line * 2.5);
}

export interface RowContinuation { changed: boolean; original?: string; unsupported: boolean }

/** Native pagination still chooses page positions. Rows taller than a printable
 * body become bounded rows, so headers and complete bottom borders survive. */
export function continueTableRows(table: HTMLTableElement, pageHeight: number): RowContinuation {
  const headerHeight = table.tHead?.getBoundingClientRect().height ?? 0;
  const capacity = pageHeight - headerHeight - 12;
  const rows = Array.from(table.rows);
  const tall = rows.filter(row => row.parentElement !== table.tHead && row.getBoundingClientRect().height > capacity);
  if (!tall.length || capacity < 48) return { changed: false, unsupported: !!tall.length };
  // A rowspan connects multiple source rows. Do not invent a new merged grid.
  if (rows.some(row => Array.from(row.cells).some(cell => cell.rowSpan !== 1))) {
    tall.forEach(row => row.classList.add('export-tall-row'));
    return { changed: false, unsupported: true };
  }
  let original: string | undefined, unsupported = false;
  const replacements: Array<{ row: HTMLTableRowElement; fragment: DocumentFragment }> = [];
  const unresolved: HTMLTableRowElement[] = [];
  for (const row of tall) {
    const top = row.getBoundingClientRect().top;
    const cells = Array.from(row.cells);
    if (!cells.length) continue;
    const padding = Math.max(...cells.map(cell => { const style = getComputedStyle(cell); return (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0); }), 0);
    const markerHeight = (parseFloat(getComputedStyle(cells[0]).fontSize) || 16) * .85 * 1.25;
    const height = capacity - padding - markerHeight - 6;
    if (height < 24) { unresolved.push(row); unsupported = true; continue; }
    const contexts = cells.map((): SliceContext => ({ top, height, part: 0, oversized: false }));
    const pieces = cells.map((cell, index) => sliceNode(cell, contexts[index]));
    const count = Math.max(...pieces.map(parts => Math.max(0, ...parts.keys()))) + 1;
    if (count < 2 || contexts.some(context => context.oversized)) { unresolved.push(row); unsupported = true; continue; }
    original ??= table.outerHTML;
    const repeatLabel = shortLabel(cells[0], height), replacement = document.createDocumentFragment();
    for (let part = 0; part < count; part++) {
      const fragment = row.cloneNode(false) as HTMLTableRowElement;
      fragment.style.removeProperty('height'); fragment.style.removeProperty('min-height');
      fragment.classList.remove('export-tall-row');
      fragment.classList.toggle('export-row-continues', part < count - 1);
      fragment.classList.toggle('export-row-continuation', part > 0);
      fragment.dataset.exportRowPart = String(part);
      cells.forEach((cell, index) => {
        const content = (pieces[index].get(part) ?? cell.cloneNode(false)) as HTMLTableCellElement;
        if (part > 0 && index === 0) {
          if (repeatLabel) content.replaceChildren(...Array.from(cell.childNodes, child => child.cloneNode(true)));
          const marker = document.createElement('span'); marker.className = 'export-row-marker'; marker.textContent = '（续）';
          content.prepend(marker);
        }
        fragment.append(content);
      });
      replacement.append(fragment);
    }
    replacements.push({ row, fragment: replacement });
  }
  // All geometry is read before changing the live table, avoiding one full
  // table reflow per continued row. Each retained leaf is still cloned once.
  unresolved.forEach(row => row.classList.add('export-tall-row'));
  replacements.forEach(({ row, fragment }) => row.replaceWith(fragment));
  return { changed: original !== undefined, original, unsupported };
}
