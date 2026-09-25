import type { JSONContent } from '@tiptap/core';

export type ExportProjection = 'portable' | 'html' | 'print';
export interface RichExportSummary { grids: number; carousels: number; disclosures: number; concealed: number; annotations: number; recovered?: number }
const knownNodes = new Set(['doc', 'text', 'paragraph', 'heading', 'hardBreak', 'codeBlock', 'blockquote', 'horizontalRule',
  'bulletList', 'orderedList', 'listItem', 'taskList', 'taskItem', 'table', 'tableRow', 'tableCell', 'tableHeader',
  'image', 'mathInline', 'mathBlock', 'mermaidBlock', 'plantumlBlock', 'infographicBlock', 'githubAlert', 'documentPresentation',
  'imageCollection', 'imageSlot', 'disclosure', 'annotationStore', 'annotationBody', 'nativeError']);
const knownMarks = new Set(['bold', 'italic', 'strike', 'underline', 'code', 'link', 'highlight', 'textColor', 'conceal', 'annotationReference']);
const paragraph = (content: JSONContent[] = []): JSONContent => ({ type: 'paragraph', content });
const text = (value: string, bold = false): JSONContent => ({ type: 'text', text: value, ...(bold ? { marks: [{ type: 'bold' }] } : {}) });
const referenceId = (value: JSONContent) => value.marks?.find(mark => mark.type === 'annotationReference')?.attrs?.id as string | undefined;

/** Index entities once, then project each node once. No per-anchor document scans. */
export function projectRichContent(source: JSONContent, mode: ExportProjection) {
  const bodies = new Map<string, JSONContent>();
  const references = new Set<string>();
  const summary: RichExportSummary = { grids: 0, carousels: 0, disclosures: 0, concealed: 0, annotations: 0 };
  const index = (value: JSONContent, path: string) => {
    // An unknown block has an explicit, lossless portable representation. The
    // native error block already carries the exact original source fragment.
    if (!knownNodes.has(value.type ?? '') || value.type === 'nativeError') { summary.recovered = (summary.recovered ?? 0) + 1; return; }
    for (const mark of value.marks ?? []) {
      if (!knownMarks.has(mark.type)) throw new Error(`无法导出标记 ${mark.type}（${path}），请保留原生文档。`);
      if (mark.type === 'conceal') summary.concealed++;
      if (mark.type === 'annotationReference' && mark.attrs?.id) references.add(String(mark.attrs.id));
    }
    if (value.attrs?.concealed) summary.concealed++;
    if (value.attrs?.annotationId) references.add(String(value.attrs.annotationId));
    if (value.type === 'imageCollection') summary[value.attrs?.layout === 'carousel' ? 'carousels' : 'grids']++;
    if (value.type === 'disclosure') summary.disclosures++;
    if (value.type === 'annotationBody') {
      const id = String(value.attrs?.id ?? '');
      if (!id || bodies.has(id)) throw new Error(`补充说明 ID 缺失或重复（${path}）。`);
      bodies.set(id, value);
    }
    value.content?.forEach((child, childIndex) => index(child, `${path}/${childIndex + 1}`));
  };
  index(source, '正文');
  for (const id of references) if (!bodies.has(id)) throw new Error(`补充说明 ${id} 缺少正文，无法完整导出。`);
  const ids = [...references, ...[...bodies.keys()].filter(id => !references.has(id))];
  const numbers = new Map(ids.map((id, index) => [id, index + 1]));
  summary.annotations = ids.length;
  const reference = (id: string): JSONContent => ({ type: 'text', text: `[${numbers.get(id)}]`,
    ...(mode !== 'portable' ? { marks: [{ type: 'link', attrs: { href: `#export-note-${numbers.get(id)}` } }] } : {}) });
  const project = (value: JSONContent): JSONContent[] => {
    if (!knownNodes.has(value.type ?? '') || value.type === 'nativeError') {
      const raw = typeof value.attrs?.raw === 'string' ? value.attrs.raw : JSON.stringify(value);
      return [{ type: 'codeBlock', content: raw ? [text(raw)] : [] }];
    }
    if (value.type === 'annotationStore' || value.type === 'annotationBody') return [];
    const content: JSONContent[] = [];
    value.content?.forEach((child, index) => {
      content.push(...project(child));
      const id = referenceId(child);
      if (id && referenceId(value.content![index + 1] ?? {}) !== id) content.push(reference(id));
    });
    if (mode !== 'portable' && value.type === 'imageSlot') {
      const captions = content.filter(child => child.type === 'paragraph');
      if (captions.length > 1) {
        const caption = paragraph(captions.flatMap((child, index) => [...(index ? [{ type: 'hardBreak' }] : []), ...(child.content ?? [])]));
        content.splice(0, content.length, ...content.filter(child => child.type !== 'paragraph'), caption);
      }
    }
    const attrs = { ...value.attrs };
    delete attrs.annotationId;
    if (mode !== 'html') delete attrs.concealed;
    const marks = value.marks?.filter(mark => mark.type !== 'annotationReference' && (mode === 'html' || mark.type !== 'conceal'));
    const clean: JSONContent = { ...value, attrs, ...(marks ? { marks } : {}), ...(value.content ? { content } : {}) };
    const anchor = value.attrs?.annotationId ? reference(String(value.attrs.annotationId)) : null;
    if (anchor && ['paragraph', 'heading'].includes(value.type!)) { content.push(anchor); clean.content = content; }
    let result: JSONContent[];
    if (mode === 'portable' && value.type === 'imageSlot') {
      result = [{ type: 'tableCell', content: content.length ? content : [paragraph()] }];
    } else if (mode === 'portable' && value.type === 'imageCollection') {
      const columns = value.attrs?.columns === 3 ? 3 : 2, rows: JSONContent[] = [];
      for (let start = 0; start < content.length; start += columns) {
        const cells = content.slice(start, start + columns);
        while (cells.length < columns) cells.push({ type: 'tableCell', content: [paragraph()] });
        rows.push({ type: 'tableRow', content: cells });
      }
      result = [{ type: 'table', content: rows }];
    } else if (mode === 'portable' && value.type === 'disclosure') {
      result = [paragraph([text(String(value.attrs?.title || '折叠内容'), true)]), ...content];
    } else {
      if (mode === 'print' && value.type === 'disclosure') attrs.open = true;
      if (mode === 'print' && value.type === 'imageCollection') attrs.layout = 'grid';
      result = [clean];
    }
    if (anchor && !['paragraph', 'heading'].includes(value.type!)) {
      if (['listItem', 'taskItem', 'tableCell', 'tableHeader', 'blockquote', 'githubAlert', 'disclosure'].includes(value.type!) && mode !== 'portable') content.push(paragraph([anchor]));
      else result.push(paragraph([anchor]));
    }
    return result;
  };
  const document = project(source)[0];
  if (ids.length) {
    const notes = ids.map(id => ({ ...bodies.get(id)!, content: bodies.get(id)!.content?.flatMap(project) ?? [paragraph()] }));
    if (mode === 'portable') {
      document.content ??= [];
      document.content.push({ type: 'heading', attrs: { level: 2 }, content: [text('补充说明')] });
      for (const note of notes) document.content.push(paragraph([text(`[${numbers.get(String(note.attrs?.id))}]`, true)]), ...(note.content ?? []));
    } else document.content?.push({ type: 'annotationStore', content: notes });
  }
  return { document, summary, annotationNumbers: numbers };
}

export function richExportDiagnostics(summary: RichExportSummary | undefined, target: string): string[] {
  if (!summary || target === 'noteboard') return [];
  const result: string[] = [];
  const portable = ['md', 'docx', 'latex'].includes(target);
  if (portable && summary.grids) result.push(`${summary.grids} 组图片拼图已保留为完整网格，包含全部图片、图注与空槽。`);
  if (target !== 'html5' && summary.carousels) result.push(`${summary.carousels} 组图片轮播已展开为完整网格。`);
  if (target !== 'html5' && summary.disclosures) result.push(`${summary.disclosures} 个折叠块已展开，标题与正文完整保留。`);
  if (target !== 'html5' && summary.concealed) result.push(`${summary.concealed} 处模糊效果已移除，内容完整保留。`);
  if (summary.annotations) result.push(`${summary.annotations} 处补充说明已${['docx', 'latex'].includes(target) ? '转换为脚注' : '编号并附于文末'}。`);
  if (summary.recovered) result.push(`${summary.recovered} 处无法解析的内容已按原文保留为代码块。`);
  return result;
}
