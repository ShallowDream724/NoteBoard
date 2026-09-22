import { renderMath } from '../editor-md/mathRendering';
import { matrixSource, matrixPart, reflowFractions } from '../../core/math/structure';
import { readableScale, renderedScale } from './layoutMetrics';

function width(element: HTMLElement) { return Math.max(element.getBoundingClientRect().width, element.scrollWidth * renderedScale(element)); }
interface Region { r0: number; r1: number; c0: number; c1: number }
export interface MathLayoutResult { handled: boolean; issue?: string }
const MAX_PARTS = 4096;
const MAX_MARKUP_BYTES = 16 * 1024 * 1024;

/** Only hard cases reach this path. TeX rendering stays in the shared worker;
 * parts are rendered and measured in small batches, never cloned full matrices. */
export async function continueMatrix(element: HTMLElement, available: number, pageHeight: number, bodyFontPt: number, manualFit: boolean): Promise<MathLayoutResult> {
  let source;
  try { source = matrixSource(element.dataset.latex ?? ''); }
  catch (error) { return { handled: false, issue: String(error) }; }
  if (!source) return { handled: false };
  const original = element.querySelector<HTMLElement>('.katex-html');
  if (!original) return { handled: false };
  const minimum = manualFit ? .001 : readableScale(original, bodyFontPt);
  const sampled = element.dataset.matrixPreview === 'true';
  const columnWidth = width(original) / (sampled ? Math.min(8, source.columns) : source.columns);
  const rowHeight = original.getBoundingClientRect().height / (sampled ? Math.min(4, source.rows.length) : source.rows.length);
  const maxColumns = manualFit ? source.columns : Math.max(1, Math.min(source.columns, Math.floor(available / minimum / Math.max(1, columnWidth))));
  const estimatedScale = Math.min(1, available / Math.max(1, columnWidth * maxColumns));
  const maxRows = Math.max(1, Math.min(64, Math.floor((pageHeight - 40) / estimatedScale / Math.max(1, rowHeight))));
  const pending: Region[] = [];
  for (let r0 = 0; r0 < source.rows.length; r0 += maxRows) for (let c0 = 0; c0 < source.columns; c0 += maxColumns)
    pending.push({ r0, r1: Math.min(source.rows.length, r0 + maxRows), c0, c1: Math.min(source.columns, c0 + maxColumns) });
  if (pending.length > MAX_PARTS) return { handled: false, issue: '矩阵分段超过 4096 段，请拆分后导出。' };
  const container = document.createElement('div'); container.className = 'math-continuation';
  element.replaceChildren(container); element.dataset.mathContinued = 'true'; element.classList.remove('wrap');
  const name = source.prefix.trim().replace(/=\s*$/, '').trim();
  const nameHtml = name ? (await renderMath(name, false)).html : '';
  let issue: string | undefined, count = 0, markupBytes = 0;
  // Regions remain data until the batch is rendered. No whole-matrix duplicate DOM.
  for (let offset = 0; offset < pending.length;) {
    const batch = pending.slice(offset, offset + 8);
    const rendered = await Promise.all(batch.map(region => renderMath(matrixPart(source!, region.r0, region.r1, region.c0, region.c1), true)));
    markupBytes += rendered.reduce((sum, value) => sum + value.html.length * 2, 0);
    if (markupBytes > MAX_MARKUP_BYTES) {
      issue = `矩阵排版超过容量限制，第 ${batch[0].r0 + 1} 行、第 ${batch[0].c0 + 1} 列起未完整显示，请拆分后导出。`;
      const message = document.createElement('p'); message.textContent = issue; container.append(message); break;
    }
    const parts = batch.map((region, index) => {
      const part = document.createElement('div'); part.className = 'math-continuation-part';
      part.dataset.row = String(region.r0); part.dataset.column = String(region.c0);
      const caption = document.createElement('div'); caption.className = 'math-continuation-caption';
      if (nameHtml) { const label = document.createElement('span'); label.innerHTML = nameHtml; caption.append(label, ' · '); }
      caption.append(`第 ${region.r0 + 1}–${region.r1} 行，第 ${region.c0 + 1}–${region.c1} 列`);
      const math = document.createElement('div'); math.className = 'math-continuation-content'; math.innerHTML = rendered[index].html;
      if (rendered[index].error) { math.textContent = rendered[index].error!; issue = `矩阵第 ${region.r0 + 1} 行附近无法渲染`; }
      part.append(caption, math); container.append(part); return { part, math, region };
    });
    await document.fonts.ready;
    // Read every part before changing any geometry.
    const measures = parts.map(({ math }) => { const content = math.querySelector<HTMLElement>('.katex-html') ?? math; return { width: width(content), height: content.getBoundingClientRect().height }; });
    parts.forEach(({ part, math, region }, index) => {
      const measure = measures[index], scale = Math.min(1, available / Math.max(1, measure.width), (pageHeight - 40) / Math.max(1, measure.height));
      if (scale < minimum - .001 && pending.length + 2 <= MAX_PARTS && (region.c1 - region.c0 > 1 || region.r1 - region.r0 > 1)) {
        const horizontal = measure.width / available > measure.height / (pageHeight - 40) && region.c1 - region.c0 > 1;
        if (horizontal) { const middle = (region.c0 + region.c1) >> 1; pending.push({ ...region, c1: middle }, { ...region, c0: middle }); }
        else if (region.r1 - region.r0 > 1) { const middle = (region.r0 + region.r1) >> 1; pending.push({ ...region, r1: middle }, { ...region, r0: middle }); }
        else { const middle = (region.c0 + region.c1) >> 1; pending.push({ ...region, c1: middle }, { ...region, c0: middle }); }
        part.remove(); return;
      }
      if (scale < minimum - .001) issue = `矩阵第 ${region.r0 + 1} 行、第 ${region.c0 + 1} 列的内容过大，可手动选择适宽缩放。`;
      else if (scale < 1) math.style.zoom = String(scale);
      count++;
    });
    offset += batch.length;
  }
  // Refinements were queued at the end; restore source row/column reading order.
  const ordered = Array.from(container.children).sort((a, b) => Number((a as HTMLElement).dataset.row) - Number((b as HTMLElement).dataset.row) || Number((a as HTMLElement).dataset.column) - Number((b as HTMLElement).dataset.column));
  container.replaceChildren(...ordered);
  if (source.suffix.trim()) container.append(document.createTextNode(source.suffix.trim()));
  return { handled: count > 0, issue };
}

export async function continueFraction(element: HTMLElement, available: number, bodyFontPt: number): Promise<boolean> {
  const latex = element.dataset.latex ?? '';
  // A bounded pair of candidates, independent of document size.
  const budget = Math.max(12, Math.floor(available / (bodyFontPt * 1.333 * .55)));
  for (const factor of [1, .6]) {
    const candidate = reflowFractions(latex, Math.round(budget * factor)); if (!candidate) return false;
    const result = await renderMath(candidate, true); if (result.error) continue;
    element.innerHTML = result.html; element.classList.add('wrap');
    const math = element.querySelector<HTMLElement>('.katex-html');
    if (math && width(math) <= available + 1) return true;
  }
  return false;
}
