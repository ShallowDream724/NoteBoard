import { invoke } from '@tauri-apps/api/core';
import { createLayoutSession } from './layout';
import { listen } from '@tauri-apps/api/event';
import { paperSize, type PdfPayload, type PdfOptions } from './model';
import './document.css';

async function render() {
  const id = location.hash.slice(1);
  try {
    const payload = await invoke<PdfPayload>('pdf_payload', { id });
    const { options } = payload;
    const style = document.createElement('style'); style.textContent = payload.fontCss; document.head.append(style);
    document.title = payload.title;
    const root = document.getElementById('document')!; root.innerHTML = payload.html;
    const layout = createLayoutSession(root);
    const update = async (options: PdfOptions, revision: number) => {
      try {
        document.documentElement.style.setProperty('--export-font', `${options.fontPt}pt`);
        document.documentElement.style.setProperty('--export-line', String(options.lineHeight));
        document.documentElement.style.setProperty('--export-width', `${paperSize(options)[0] - options.marginMm * 2}mm`);
        const report = layout.update(options);
        await invoke('pdf_ready', { id, revision, ...report, error: null });
      } catch (error) { await invoke('pdf_ready', { id, revision, issues: [], adjustable: [], error: String(error) }); }
    };
    await listen<{ options: PdfOptions; revision: number }>('export-options', ({ payload }) => void update(payload.options, payload.revision));
    await document.fonts.ready;
    await Promise.all(Array.from(root.querySelectorAll('img')).map(image => image.decode().catch(() => {})));
    await new Promise(resolve => setTimeout(resolve, 50));
    await update(options, 0);
  } catch (error) { await invoke('pdf_ready', { id, issues: [], error: String(error) }); }
}
void render();
