import { invoke } from '@tauri-apps/api/core';
import { layoutDocument } from './layout';
import { paperSize, type PdfPayload } from './model';
import './document.css';

async function render() {
  const id = location.hash.slice(1);
  try {
    const payload = await invoke<PdfPayload>('pdf_payload', { id });
    const { options } = payload;
    const style = document.createElement('style'); style.textContent = payload.fontCss; document.head.append(style);
    document.title = payload.title;
    document.documentElement.style.setProperty('--export-font', `${options.fontPt}pt`);
    document.documentElement.style.setProperty('--export-line', String(options.lineHeight));
    document.documentElement.style.setProperty('--export-width', `${paperSize(options)[0] - options.marginMm * 2}mm`);
    const root = document.getElementById('document')!; root.innerHTML = payload.html;
    await document.fonts.ready;
    await Promise.all(Array.from(root.querySelectorAll('img')).map(image => image.decode().catch(() => {})));
    await new Promise(resolve => setTimeout(resolve, 50));
    const issues = layoutDocument(root, options);
    await invoke('pdf_ready', { id, issues, error: null });
  } catch (error) { await invoke('pdf_ready', { id, issues: [], error: String(error) }); }
}
void render();
