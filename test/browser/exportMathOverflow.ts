import katex from 'katex';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { createLayoutSession } from '../../src/features/export/layout';
import { ExportSidebarFeedback } from '../../src/features/export/ExportDiagnostics';
import { DEFAULT_PDF, paperSize, type ExportItem, type PdfOptions } from '../../src/features/export/model';
import '../../src/features/export/document.css';
import '../../src/features/export/export.css';

const loss = String.raw`\mathcal{L}(\theta)=\frac{1}{n}\sum_{i=1}^{n}\left(y_i-f_{\theta}(x_i)\right)^2+\lambda\lVert\theta\rVert_2^2`;
const root = document.querySelector<HTMLElement>('#document')!;
const metrics = () => Array.from(root.querySelectorAll<HTMLElement>('.export-math'), host => {
  const math = host.querySelector<HTMLElement>('.katex-html')!;
  const box = host.getBoundingClientRect(), content = math.getBoundingClientRect();
  const bases = Array.from(math.children).filter(child => child.classList.contains('base')).map(child => child.getBoundingClientRect());
  return { id: host.dataset.exportItem, align: host.style.textAlign, zoom: math.style.zoom, wrap: host.classList.contains('wrap'),
    width: box.width, left: box.left, right: box.right, mathWidth: content.width, mathLeft: content.left, mathRight: content.right,
    scrollWidth: math.scrollWidth, offsetWidth: math.offsetWidth, baseLeft: Math.min(...bases.map(base => base.left)), baseRight: Math.max(...bases.map(base => base.right)) };
});
const qa = {
  sidebar() {
    root.hidden = true;
    document.documentElement.style.cssText = '--ui-font-family:Segoe UI,Microsoft YaHei,sans-serif;--editor-bg:#fff;--editor-surface:#f6f7f9;--editor-text:#20252d;--editor-text-secondary:#505968;--editor-text-muted:#6b7280;--editor-border:#dce0e5;--editor-accent:#5264d8;--toolbar-hover:#eceef3;--export-font:13px;--export-line:1.4';
    const dialog = document.createElement('div'); dialog.className = 'export-dialog'; dialog.style.cssText = 'width:260px;height:auto;margin:24px;font-family:var(--ui-font-family);font-size:13px';
    const body = document.createElement('div'); body.className = 'export-body';
    const sidebar = document.createElement('aside'); body.append(sidebar); dialog.append(body); document.body.append(dialog);
    createRoot(sidebar).render(createElement(ExportSidebarFeedback, {
      issues: [{ id: 'formula-1', blocking: true, message: '换行后仍超宽，继续缩小会影响阅读；可手动选择适宽缩放。' }],
      items: new Map<string, ExportItem>([['formula-1', { id: 'formula-1', kind: 'formula', label: String.raw`公式 1 · \mathcal{L}(\theta)=\frac{1}{n}\sum_{i=1}` }]]),
      notes: ['1 组图片轮播已展开为完整图片。', '2 处折叠内容已展开。'], accepted: false,
      onNavigate: () => {}, onAccept: () => {},
    }));
  },
  async render({ source = loss, fontPt = DEFAULT_PDF.fontPt, marginMm = DEFAULT_PDF.marginMm, mode = 'auto' }: { source?: string; fontPt?: number; marginMm?: number; mode?: 'auto' | 'fit' } = {}) {
    const options: PdfOptions = { ...DEFAULT_PDF, fontPt, marginMm, horizontalMarginMm: marginMm, items: {} };
    const [paperWidth] = paperSize(options);
    document.documentElement.style.cssText = `--export-font:${fontPt}pt;--export-line:1.4;--export-width:${paperWidth - marginMm * 2}mm`;
    const article = document.createElement('article'); article.dataset.exportMode = 'print';
    for (const align of ['left', 'center', 'right']) {
      const host = document.createElement('div'); host.className = 'export-math display';
      host.dataset.exportItem = `formula-${align}`; host.dataset.latex = source; host.dataset.mathAlign = align;
      host.dataset.blockBackground = '#f5aa42'; host.style.cssText = `text-align:${align};background:#f5aa42`;
      host.innerHTML = katex.renderToString(source, { displayMode: true, throwOnError: false }); article.append(host);
      options.items[host.dataset.exportItem] = mode;
    }
    root.replaceChildren(article); root.getBoundingClientRect(); await document.fonts.ready;
    const before = metrics(), report = await createLayoutSession(root).update(options);
    return { before, report, after: metrics() };
  },
};
declare global { interface Window { exportMathOverflowQA: typeof qa } }
window.exportMathOverflowQA = qa;
