const ITEM_URI = 'https://noteboard.invalid/export-item/';

function marker(target: HTMLElement, id: string, table: boolean) {
  if (target.querySelector(':scope > .export-item-link')) return;
  const link = document.createElement('a');
  link.href = ITEM_URI + id;
  link.className = `export-item-link ${table ? 'export-table-location' : 'export-math-location'}`;
  link.setAttribute('aria-hidden', 'true');
  link.textContent = '\u00a0';
  if (!table) target.classList.add('export-location-host');
  target.append(link);
}

/** Each marker owns one box and no document text. Wrapping a KaTeX subtree in
 * an anchor makes Chromium emit an annotation for nearly every glyph, which
 * inflates printing, PDF parsing and navigation work. Bases already represent
 * indivisible line fragments; continued matrices have bounded block parts. */
export function addItemLocations(elements: Iterable<HTMLElement>, adjustable: ReadonlySet<string>) {
  for (const element of elements) {
    const id = element.dataset.exportItem;
    if (!id || !adjustable.has(id)) continue;
    if (element instanceof HTMLTableElement) {
      for (const row of Array.from(element.rows)) {
        const first = row.cells[0], last = row.cells[row.cells.length - 1];
        if (first) marker(first, id, true);
        if (last && last !== first) marker(last, id, true);
      }
    } else if (element.classList.contains('export-math')) {
      const targets = element.querySelectorAll<HTMLElement>(element.dataset.mathContinued
        ? '.math-continuation-part' : '.katex-html > .base');
      for (const target of targets) marker(target, id, false);
      // Admission/syntax errors have text in place of KaTeX. Keep those issues
      // reachable from the preview too, without wrapping their diagnostic text.
      if (!targets.length) marker(element, id, false);
    } else if (element.classList.contains('export-diagram')) marker(element, id, false);
  }
}

export function clearItemLocations(element: HTMLElement) {
  element.querySelectorAll('.export-item-link').forEach(link => link.remove());
  element.classList.remove('export-location-host');
  element.querySelectorAll('.export-location-host').forEach(host => host.classList.remove('export-location-host'));
}
