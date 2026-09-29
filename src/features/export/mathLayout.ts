import { renderMath } from '../editor-md/mathRendering';
import { matrixSource, matrixPart } from '../../core/math/structure';
import { reflowMathToWidth } from '../../core/math/layout';
import { mathContentWidth, readableScale } from './layoutMetrics';

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
  const sampled = element.dataset.matrixPreview === 'true';
  if (!original && !sampled) return { handled: false };
  const minimum = manualFit ? .001 : original ? readableScale(original, bodyFontPt) : Math.min(1, 8 / bodyFontPt);
  // A sample can itself exceed one-render admission limits. Start from coarse
  // dimensions in that case; actual bounded candidates establish fit/readability.
  const columnWidth = original ? mathContentWidth(original) / (sampled ? Math.min(8, source.columns) : source.columns) : bodyFontPt * 4;
  const rowHeight = original ? original.getBoundingClientRect().height / (sampled ? Math.min(4, source.rows.length) : source.rows.length) : bodyFontPt * 2;
  const maxColumns = manualFit ? source.columns : Math.max(1, Math.min(source.columns, Math.floor(available / minimum / Math.max(1, columnWidth))));
  const estimatedScale = Math.min(1, available / Math.max(1, columnWidth * maxColumns));
  const maxRows = Math.max(1, Math.min(64, Math.floor((pageHeight - 40) / estimatedScale / Math.max(1, rowHeight))));
  const pending: Region[] = [];
  for (let r0 = 0; r0 < source.rows.length; r0 += maxRows) for (let c0 = 0; c0 < source.columns; c0 += maxColumns) {
    if (pending.length === MAX_PARTS) return { handled: false, issue: '矩阵分段超过 4096 段，请拆分后导出。' };
    pending.push({ r0, r1: Math.min(source.rows.length, r0 + maxRows), c0, c1: Math.min(source.columns, c0 + maxColumns) });
  }
  const subdivide = (region: Region, horizontal = region.c1 - region.c0 >= region.r1 - region.r0) => {
    if (pending.length + 2 > MAX_PARTS || (region.c1 - region.c0 <= 1 && region.r1 - region.r0 <= 1)) return false;
    if ((horizontal && region.c1 - region.c0 > 1) || region.r1 - region.r0 <= 1) {
      const middle = (region.c0 + region.c1) >> 1; pending.push({ ...region, c1: middle }, { ...region, c0: middle });
    } else { const middle = (region.r0 + region.r1) >> 1; pending.push({ ...region, r1: middle }, { ...region, r0: middle }); }
    return true;
  };
  const container = document.createElement('div'); container.className = 'math-continuation';
  element.replaceChildren(container); element.dataset.mathContinued = 'true'; element.classList.remove('wrap');
  const name = source.prefix.trim().replace(/=\s*$/, '').trim();
  const nameResult = name ? await renderMath(name, false) : undefined, nameHtml = nameResult?.html ?? '';
  let issue: string | undefined = nameResult?.error ? `矩阵名称未完整显示：${nameResult.error}` : undefined;
  let count = 0, markupBytes = 0;
  // Regions remain data until the batch is rendered. No whole-matrix duplicate DOM.
  for (let offset = 0; offset < pending.length;) {
    const batch = pending.slice(offset, offset + 8);
    const rendered = await Promise.all(batch.map(region => renderMath(matrixPart(source!, region.r0, region.r1, region.c0, region.c1), true)));
    markupBytes += rendered.reduce((sum, value) => sum + value.html.length * 2, 0);
    if (markupBytes > MAX_MARKUP_BYTES) {
      issue = `矩阵排版超过容量限制，第 ${batch[0].r0 + 1} 行、第 ${batch[0].c0 + 1} 列起未完整显示，请拆分后导出。`;
      const message = document.createElement('p'); message.textContent = issue; container.append(message); break;
    }
    const parts = batch.flatMap((region, index) => {
      const result = rendered[index];
      // Reject oversized markup before creating any DOM, then retry smaller
      // source regions. A single unrenderable cell remains an explicit omission.
      if (result.limited && subdivide(region)) return [];
      const part = document.createElement('div'); part.className = 'math-continuation-part';
      part.dataset.row = String(region.r0); part.dataset.column = String(region.c0);
      const caption = document.createElement('div'); caption.className = 'math-continuation-caption';
      if (nameHtml) { const label = document.createElement('span'); label.innerHTML = nameHtml; caption.append(label, ' · '); }
      caption.append(`第 ${region.r0 + 1}–${region.r1} 行，第 ${region.c0 + 1}–${region.c1} 列`);
      const math = document.createElement('div'); math.className = 'math-continuation-content';
      if (result.limited) {
        issue = `矩阵第 ${region.r0 + 1}–${region.r1} 行、第 ${region.c0 + 1}–${region.c1} 列超出排版预算，未完整显示；请拆分或简化该范围。`;
        math.textContent = issue;
      } else if (result.error) { math.textContent = result.error; issue = `矩阵第 ${region.r0 + 1} 行附近无法渲染`; }
      else math.innerHTML = result.html;
      part.append(caption, math); container.append(part); return [{ part, math, region, failed: !!result.error || !!result.limited }];
    });
    await document.fonts.ready;
    // Read every part before changing any geometry.
    const measures = parts.map(({ math }) => {
      const content = math.querySelector<HTMLElement>('.katex-html') ?? math;
      return { width: mathContentWidth(content), height: content.getBoundingClientRect().height, minimum: manualFit ? .001 : readableScale(content, bodyFontPt) };
    });
    parts.forEach(({ part, math, region, failed }, index) => {
      if (failed) { count++; return; }
      const measure = measures[index], scale = Math.min(1, available / Math.max(1, measure.width), (pageHeight - 40) / Math.max(1, measure.height));
      if (scale < measure.minimum - .001) {
        const horizontal = measure.width / available > measure.height / (pageHeight - 40) && region.c1 - region.c0 > 1;
        if (subdivide(region, horizontal)) { part.remove(); return; }
      }
      if (scale < measure.minimum - .001) issue = `矩阵第 ${region.r0 + 1} 行、第 ${region.c0 + 1} 列无法在保持文字与线条可读的情况下适应页面，可调整源码或手动选择适宽缩放。`;
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

export async function continueFormula(element: HTMLElement, available: number, bodyFontPt: number): Promise<boolean> {
  element.classList.add('wrap');
  return reflowMathToWidth({ element, latex: element.dataset.latex ?? '', available, fontPixels: bodyFontPt * 96 / 72, render: source => renderMath(source, true) });
}
