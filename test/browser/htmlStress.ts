import type { JSONContent } from '@tiptap/core';

const ordinary = String.raw`\begin{aligned}
s(t)&=\begin{cases}0,&t\le0,\\3t^2-2t^3,&0<t<1,\\1,&t\ge1,\end{cases}\\
s'(0)&=s'(1)=0,\quad\int_0^1s(t)\,dt=\frac12.
\end{aligned}`;
const long = 'F(x)=' + Array.from({ length: 24 }, (_, index) => String.raw`\frac{a_{${index + 1}}x^{${index + 1}}}{1+b_{${index + 1}}}`).join('+');
const paragraph = (text: string): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const cell = (text: string, header = false): JSONContent => ({ type: header ? 'tableHeader' : 'tableCell', content: [paragraph(text)] });
const row = (index: number): JSONContent => ({ type: 'tableRow', content: [cell(`R${index}`), cell(`第 ${index} 行`), cell(index === 1000 ? 'END-OF-TABLE-1000' : `数值 ${index * 7}`)] });
const documentJson: JSONContent = { type: 'doc', content: [
  paragraph('独立 HTML 压力回归'),
  { type: 'paragraph', content: [{ type: 'text', text: '这里可以就地查看说明', marks: [{ type: 'annotationReference', attrs: { id: 'note' } }] }] },
  { type: 'codeBlock', attrs: { language: 'py', annotationId: 'note' }, content: [{ type: 'text', text: 'print("<tag>")\n  # keep spaces' }] },
  { type: 'mathBlock', attrs: { latex: ordinary, textAlign: 'left', annotationId: 'note' } },
  { type: 'mathBlock', attrs: { latex: ordinary, textAlign: 'center' } },
  { type: 'mathBlock', attrs: { latex: ordinary, textAlign: 'right' } },
  { type: 'mathBlock', attrs: { latex: long, textAlign: 'left' } },
  { type: 'table', attrs: { annotationId: 'note' }, content: [{ type: 'tableRow', content: [cell('编号', true), cell('说明', true), cell('数值', true)].map((node, index) => ({ ...node, attrs: { colwidth: [[220], [360], [500]][index] } })) },
    ...Array.from({ length: 1000 }, (_, index) => row(index + 1))] },
  { type: 'annotationStore', content: [{ type: 'annotationBody', attrs: { id: 'note' }, content: [paragraph('这段说明保留在内容旁边，可使用鼠标或键盘打开。')] }] },
] };

type WorkerMessage = { type: 'result'; result: string } | { type: 'error'; error: string } | { type: 'assets' | 'diagrams' };
const started = performance.now();
const worker = new Worker(new URL('../../src/features/export/documentWorker.ts', import.meta.url), { type: 'module' });
try {
  const html = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('实际导出超时')), 180_000);
    worker.onmessage = ({ data }: MessageEvent<WorkerMessage>) => {
      if (data.type === 'result') { clearTimeout(timer); resolve(data.result); }
      else if (data.type === 'error') { clearTimeout(timer); reject(new Error(data.error)); }
      else { clearTimeout(timer); reject(new Error(`意外的导出握手：${data.type}`)); }
    };
    worker.onerror = event => { clearTimeout(timer); reject(new Error(event.message)); };
    worker.postMessage({ type: 'convert', format: 'standalone-html', title: '独立 HTML 压力回归', directory: '', markdown: documentJson });
  });
  (window as typeof window & { htmlStressHtml?: string; htmlStressReady?: boolean; htmlStressElapsed?: number }).htmlStressHtml = html;
  (window as typeof window & { htmlStressReady?: boolean }).htmlStressReady = true;
  (window as typeof window & { htmlStressElapsed?: number }).htmlStressElapsed = performance.now() - started;
  document.querySelector('#status')!.textContent = '导出完成';
} catch (error) {
  (window as typeof window & { htmlStressError?: string }).htmlStressError = String(error);
  document.querySelector('#status')!.textContent = String(error);
} finally { worker.terminate(); }
