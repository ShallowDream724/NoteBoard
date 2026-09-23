import { DOMSerializer, type Node } from '@tiptap/pm/model';
import { resolveRelativeDocPath } from '../../core/documentPath';
import { parseMarkdownDocument } from '../editor-md/documentExtensions';
import { renderMath } from '../editor-md/mathRendering';
import type { MathRendering } from '../editor-md/mathRendering';
import { codeTokensToHTML } from '../editor-md/codeTokens';
import type { ExportDocument, ExportItem } from './model';
import { documentTableStyle } from '../editor-md/documentPresentation';
import { matrixSource, matrixPart, type MatrixSource } from '../../core/math/structure';
import { MATH_LIMITS } from '../editor-md/mathLimits';

export async function renderDocument(markdown: string, title: string, baseDirectory: string, signal?: AbortSignal, snapshot?: Node | null,
  math = renderMath, assetUrls: (paths: string[]) => string[] | Promise<string[]> = paths => paths): Promise<ExportDocument> {
  signal?.throwIfAborted();
  const doc = snapshot ?? parseMarkdownDocument(markdown);
  const container = document.createElement('article');
  container.dataset.tableStyle = documentTableStyle(doc);
  container.append(DOMSerializer.fromSchema(doc.type.schema).serializeFragment(doc.content));
  container.querySelectorAll('[data-document-presentation]').forEach(element => element.remove());
  const items: ExportItem[] = [];
  let mathIndex = 0;
  // A short-lived export cache avoids repeated KaTeX work without retaining an atlas forever.
  const mathCache = new Map<string, MathRendering>();
  let mathBytes = 0;
  for (const element of container.querySelectorAll<HTMLElement>('[data-math-inline], [data-math-block]')) {
    signal?.throwIfAborted();
    const latex = element.getAttribute('latex') ?? '';
    const display = element.hasAttribute('data-math-block') || ['$$', '\\['].includes(element.getAttribute('delimiter') ?? '');
    const id = `formula-${++mathIndex}`;
    element.dataset.exportItem = id;
    element.className = display ? 'export-math display' : 'export-math inline';
    element.dataset.latex = latex;
    element.removeAttribute('latex');
    let renderSource = latex;
    let matrix: MatrixSource | null = null;
    try {
      matrix = matrixSource(latex);
      if (matrix && (matrix.rows.length > 64 || matrix.columns > 64 || latex.length > MATH_LIMITS.inputCharacters)) {
        element.dataset.matrixPreview = 'true';
        renderSource = matrixPart(matrix, 0, Math.min(4, matrix.rows.length), 0, Math.min(8, matrix.columns));
      }
    } catch (error) {
      element.dataset.renderError = String(error); element.textContent = String(error);
      element.dataset.latex = ''; items.push({ id, kind: 'formula', label: `公式 ${mathIndex} · 矩阵过大` }); continue;
    }
    const key = String(display) + ':' + renderSource;
    let rendered = mathCache.get(key);
    if (!rendered) {
      rendered = await math(renderSource, display);
      const bytes = 2 * (key.length + rendered.html.length);
      if (bytes < 262144) {
        while (mathCache.size && mathBytes + bytes > 4 * 1024 * 1024) {
          const oldest = mathCache.keys().next().value!;
          mathBytes -= 2 * (oldest.length + mathCache.get(oldest)!.html.length); mathCache.delete(oldest);
        }
        mathCache.set(key, rendered); mathBytes += bytes;
      }
    }
    if (rendered.limited && matrix) {
      // Admission failure of a full/sample matrix is a request for bounded
      // continuation, not a syntax error or permission to mount huge markup.
      element.dataset.matrixPreview = 'true'; element.textContent = '矩阵需要分段排版。';
    } else if (rendered.error) { element.textContent = rendered.limited ? rendered.error : latex; element.dataset.renderError = rendered.error; }
    else element.innerHTML = rendered.html;
    items.push({ id, kind: 'formula', label: `公式 ${mathIndex} · ${latex.slice(0, 45)}` });
    if (mathIndex % 20 === 0) await new Promise(resolve => setTimeout(resolve, 0));
  }
  let tableIndex = 0;
  for (const table of container.querySelectorAll('table')) {
    const id = `table-${++tableIndex}`; table.dataset.exportItem = id;
    // The schema emits rows directly. A real thead is required for repeated print headers.
    const first = table.querySelector('tr');
    if (first && Array.from(first.children).every(cell => cell.tagName === 'TH') && first.parentElement?.tagName !== 'THEAD') {
      const head = document.createElement('thead'); head.append(first); table.prepend(head);
    }
    const body = document.createElement('tbody');
    Array.from(table.children).filter(child => child.tagName === 'TR').forEach(row => body.append(row));
    if (body.children.length) table.append(body);
    items.push({ id, kind: 'table', label: `表格 ${tableIndex} · ${first?.textContent?.slice(0, 40) ?? ''}` });
  }
  let codeEngine: typeof import('../editor-md/codeHighlightEngine') | undefined;
  for (const code of container.querySelectorAll<HTMLElement>('pre > code')) {
    signal?.throwIfAborted();
    const source = code.textContent ?? '';
    const language = [...code.classList].find(name => name.startsWith('language-'))?.slice(9) ?? '';
    // Conversion already owns a disposable worker. Use the pure engine here;
    // importing the editor scheduler would add a second worker and UI lifetime.
    codeEngine ??= await import('../editor-md/codeHighlightEngine');
    code.innerHTML = codeTokensToHTML(source, codeEngine.tokenizeCode(source, language));
  }
  for (const diagram of container.querySelectorAll<HTMLElement>('[data-mermaid], [data-plantuml], [data-infographic]')) {
    const source = document.createElement('pre'); source.dataset.exportSourceOnly = 'true';
    source.textContent = diagram.getAttribute('code') ?? diagram.textContent;
    diagram.replaceWith(source);
  }
  const localImages: Array<{ image: HTMLImageElement; path: string }> = [];
  for (const image of container.querySelectorAll('img')) {
    const source = image.getAttribute('src') ?? '';
    if (!/^(?:https?:|data:|asset:|blob:)/i.test(source) && (baseDirectory || /^(?:[A-Za-z]:|file:|\\\\)/i.test(source))) {
      localImages.push({ image, path: resolveRelativeDocPath(baseDirectory, source) });
    }
  }
  if (localImages.length) {
    // Keep the original element references while the host maps paths to its
    // asset scheme. Only these attributes change, before the sole serialization.
    const urls = await assetUrls(localImages.map(({ path }) => path)); signal?.throwIfAborted();
    if (urls.length !== localImages.length || urls.some(url => typeof url !== 'string')) throw new Error('图片资源地址映射不完整');
    localImages.forEach(({ image }, index) => image.setAttribute('src', urls[index]));
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
  return { title, markdown, baseDirectory, html: container.outerHTML, items };
}
