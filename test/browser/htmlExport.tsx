import { createRoot } from 'react-dom/client';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import '../../src/features/export/documentContent.css';
import { CodeEditor } from '../../src/features/editor-code/CodeEditor';
import { standaloneHtml } from '../../src/features/export/standaloneHtml';
import { useDocumentStore } from '../../src/stores/documentStore';
import { useWindowStore } from '../../src/stores/windowStore';
import { TooltipProvider } from '../../src/components/Tooltip';
import { HtmlViewToggle } from '../../src/components/titlebar/HtmlViewToggle';

const formula = String.raw`\begin{aligned}\mathcal{L}(\theta)&=\sum_{i=1}^{n}x_i^2\\
f(x)&=\begin{cases}x^2,&x>0\\0,&x\le0\end{cases}\end{aligned}`;
const math = katex.renderToString(formula, { displayMode: true, throwOnError: true });
const icon = (name: string, color: string) => `<img alt="${name}" src="data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="${color}"/></svg>`)}">`;
const content = `<article><section class="export-math display">${math}</section><section class="export-image-collection export-image-carousel" aria-label="图片轮播"><figure class="export-image-slot">${icon('甲', '#cf4545')}</figure><figure class="export-image-slot">${icon('乙', '#4590cf')}</figure></section></article>`;
document.querySelector('#reference')!.innerHTML = `<section class="export-math display">${math}</section>`;
const exported = await standaloneHtml(content, 'HTML 浏览器回归');
(window as typeof window & { htmlExportHtml?: string }).htmlExportHtml = exported;
// An edited export must not be able to run its own script in the app preview.
const preview = exported.replace('</body>', '<script>window.__authoredScriptRan=true</script></body>');
const key = 'C:\\notes\\html-export-qa.html';
useDocumentStore.getState().upsertFromPayload({ key, displayName: 'html-export-qa.html', dirPath: 'C:\\notes', kind: 'code', language: 'html', content: preview, encoding: 'utf8', eol: 'lf', size: preview.length, mtime: 1, readonly: false });
useWindowStore.getState().openTab({ key, path: key, displayName: 'html-export-qa.html', kind: 'code', language: 'html',
  isDirty: false, isPreview: false, viewMode: 'visual', externalStatus: null, isDetached: false });
createRoot(document.querySelector('#app')!).render(<TooltipProvider><HtmlViewToggle docKey={key}/><CodeEditor docKey={key}/></TooltipProvider>);
(window as typeof window & { htmlExportReady?: boolean }).htmlExportReady = true;
