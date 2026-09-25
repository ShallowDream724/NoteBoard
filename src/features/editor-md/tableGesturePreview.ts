let nextId = 0;

/** One table owns the gesture's CSSOM. Pointer frames change only two numeric
 * column rules or one row height, without DOM mutations or editor transactions.
 * Column variables must not be inherited by thousands of descendant cells. */
export function tableGesturePreview(table: HTMLTableElement, row?: HTMLTableRowElement) {
  const bounds = table.getBoundingClientRect(), scale = bounds.width / table.offsetWidth || 1;
  const widths = Array.from(table.querySelectorAll<HTMLTableColElement>(':scope > colgroup > col'), col => col.getBoundingClientRect().width / scale);
  if (!widths.length || widths.some(width => width <= 0)) return null;
  const id = `nb-table-preview-${++nextId}`, style = table.ownerDocument.createElement('style');
  if (row) {
    const heightProperty = table.classList.contains('nb-isolated-rows') ? 'min-height' : 'height';
    // Row resizing must not change column layout or replace native row display.
    style.textContent = `tr.${id}-row { ${heightProperty}:${row.offsetHeight}px !important; }`;
    table.ownerDocument.head.append(style); row.classList.add(`${id}-row`);
    const rule = style.sheet!.cssRules[0] as CSSStyleRule;
    return { widths, scale,
      rowHeight(height: number) { rule.style.setProperty(heightProperty, `${height}px`, 'important'); },
      columns(_index: number, _width: number, _adjacent?: number) {},
      dispose() { row.classList.remove(`${id}-row`); style.remove(); },
    };
  }
  const large = table.parentElement?.classList.contains('nb-large-table');
  const isolateRows = large && !table.querySelector('[rowspan]:not([rowspan="1"]),[colspan]:not([colspan="1"])');
  const sum = widths.reduce((a, b) => a + b, 0);
  style.textContent = `
    table.${id} { table-layout:fixed !important; width:${sum}px !important; min-width:0 !important; }
    ${widths.map((width, i) => `table.${id}>colgroup>col:nth-child(${i + 1})${isolateRows ? `,table.${id} tr>:nth-child(${i + 1})` : ''} { width:${width}px !important; min-width:0 !important; }`).join('\n')}
    ${isolateRows && !table.classList.contains('nb-isolated-rows') ? `table.${id} { display:block !important; }
      table.${id}>colgroup { display:none; }
      table.${id}>tbody,table.${id}>thead,table.${id}>tfoot { display:block; }
      table.${id} tr { display:flex; content-visibility:auto; contain-intrinsic-size:auto 44px; }
      table.${id} tr+tr { margin-top:-1px; }
      table.${id} td,table.${id} th { display:block; flex:0 0 auto; min-width:0; box-sizing:border-box; }
      table.${id} td+td,table.${id} th+th { margin-left:-1px; }` : ''}
  `;
  table.ownerDocument.head.append(style);
  const rule = style.sheet!.cssRules[0] as CSSStyleRule;
  const columnRules = widths.map((_, index) => style.sheet!.cssRules[index + 1] as CSSStyleRule);
  table.classList.add(id);
  return { widths, scale,
    rowHeight(_height: number) {},
    columns(index: number, width: number, adjacent?: number) {
      columnRules[index].style.setProperty('width', `${width}px`, 'important');
      if (adjacent !== undefined) columnRules[index + 1].style.setProperty('width', `${adjacent}px`, 'important');
      else rule.style.setProperty('width', `${sum + width - widths[index]}px`, 'important');
    },
    dispose() { table.classList.remove(id); style.remove(); },
  };
}
