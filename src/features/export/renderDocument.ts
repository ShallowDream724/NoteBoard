import { DOMSerializer } from '@tiptap/pm/model';
import { convertFileSrc } from '@tauri-apps/api/core';
import { resolveRelativeDocPath } from '../../core/documentPath';
import { parseMarkdownDocument } from '../editor-md/markdownDocument';
import { renderMath } from '../editor-md/mathRendering';
import { highlightCode, codeTokensToHTML } from '../editor-md/codeHighlighting';
import type { ExportDocument, ExportItem } from './model';

export async function renderDocument(markdown: string, title: string, baseDirectory: string, signal?: AbortSignal): Promise<ExportDocument> {
  signal?.throwIfAborted();
  const doc = parseMarkdownDocument(markdown);
  const container = document.createElement('article');
  container.append(DOMSerializer.fromSchema(doc.type.schema).serializeFragment(doc.content));
  const items: ExportItem[] = [];
  let mathIndex = 0;
  for (const element of container.querySelectorAll<HTMLElement>('[data-math-inline], [data-math-block]')) {
    signal?.throwIfAborted();
    const latex = element.getAttribute('latex') ?? '';
    const display = element.hasAttribute('data-math-block') || ['$$', '\\['].includes(element.getAttribute('delimiter') ?? '');
    const id = `formula-${++mathIndex}`;
    element.dataset.exportItem = id;
    element.className = display ? 'export-math display' : 'export-math inline';
    element.dataset.latex = latex;
    const rendered = await renderMath(latex, display);
    if (rendered.error) { element.textContent = latex; element.dataset.renderError = rendered.error; }
    else element.innerHTML = rendered.html;
    items.push({ id, kind: 'formula', label: `公式 ${mathIndex} · ${latex.slice(0, 45)}` });
    if (mathIndex % 20 === 0) await new Promise(resolve => setTimeout(resolve, 0));
  }
  let tableIndex = 0;
  for (const table of container.querySelectorAll('table')) {
    const id = `table-${++tableIndex}`; table.dataset.exportItem = id;
    // The schema emits rows directly. A real thead is required for repeated print headers.
    const first = table.rows[0];
    if (first && Array.from(first.cells).every(cell => cell.tagName === 'TH')) {
      table.createTHead().append(first);
    }
    const body = document.createElement('tbody');
    Array.from(table.children).filter(child => child.tagName === 'TR').forEach(row => body.append(row));
    if (body.children.length) table.append(body);
    items.push({ id, kind: 'table', label: `表格 ${tableIndex} · ${first?.textContent?.slice(0, 40) ?? ''}` });
  }
  for (const code of container.querySelectorAll<HTMLElement>('pre > code')) {
    signal?.throwIfAborted();
    const source = code.textContent ?? '';
    const language = [...code.classList].find(name => name.startsWith('language-'))?.slice(9) ?? '';
    code.innerHTML = codeTokensToHTML(source, await highlightCode(source, language));
  }
  for (const diagram of container.querySelectorAll<HTMLElement>('[data-mermaid], [data-plantuml], [data-infographic]')) {
    const source = document.createElement('pre'); source.dataset.exportSourceOnly = 'true';
    source.textContent = diagram.getAttribute('code') ?? diagram.textContent;
    diagram.replaceWith(source);
  }
  for (const image of container.querySelectorAll('img')) {
    const source = image.getAttribute('src') ?? '';
    if (!/^(?:https?:|data:|asset:|blob:)/i.test(source) && (baseDirectory || /^(?:[A-Za-z]:|file:|\\\\)/i.test(source))) {
      image.src = convertFileSrc(resolveRelativeDocPath(baseDirectory, source));
    }
  }
  for (const item of container.querySelectorAll<HTMLElement>('li[data-type="taskItem"]')) {
    const input = item.querySelector('input');
    if (!input) continue;
    const check = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    check.setAttribute('viewBox', '0 0 20 20'); check.setAttribute('class', 'export-task-check');
    check.innerHTML = '<rect x="2" y="2" width="16" height="16" rx="3" fill="none" stroke="currentColor"/>'
      + (item.dataset.checked === 'true' ? '<path d="m5 10 3 3 7-7" fill="none" stroke="currentColor" stroke-width="1.6"/>' : '');
    input.replaceWith(check);
  }
  // Export never contains editing controls or active document scripts.
  container.querySelectorAll('script,iframe,button,input,textarea,select').forEach(node => node.remove());
  return { title, markdown, baseDirectory, html: container.innerHTML, items };
}
