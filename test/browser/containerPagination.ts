import type { JSONContent } from '@tiptap/core';
import { documentParser } from '../../src/features/editor-md/documentExtensions';
import { renderDocument } from '../../src/features/export/renderDocument';
import { createLayoutSession } from '../../src/features/export/layout';
import { DEFAULT_PDF } from '../../src/features/export/model';
import '../../src/features/export/document.css';

const root = document.querySelector<HTMLElement>('#document')!;
const pageHeight = (297 - 24) * 96 / 25.4;
const paragraph = (text: string): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text }] });
function picture(tall = false) {
  const canvas = document.createElement('canvas'); canvas.width = 200; canvas.height = tall ? 900 : 160;
  const context = canvas.getContext('2d')!; context.fillStyle = '#7297c4'; context.fillRect(0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}
document.documentElement.style.cssText = '--export-font:10.5pt;--export-line:1.4;--export-width:186mm;--export-paragraph-before:0em';
Object.assign(window, { containerPaginationQA: {
  async render(kind: string, long = false) {
    const lines = Array.from({ length: long ? 95 : 1 }, (_, index) => `${kind}Line${String(index).padStart(3, '0')}End`);
    let node: JSONContent;
    if (kind === 'note') node = { type: 'githubAlert', attrs: { title: 'NoteStart' }, content: lines.map(paragraph) };
    else if (kind === 'disclosure') node = { type: 'disclosure', attrs: { title: 'DisclosureStart', open: false }, content: lines.map(paragraph) };
    else if (kind === 'code') node = { type: 'codeBlock', content: [{ type: 'text', text: ['CodeStart', ...lines].join('\n') }] };
    else if (kind === 'quote') node = { type: 'blockquote', content: [paragraph('QuoteStart'), ...lines.map(paragraph)] };
    else if (kind === 'math') node = { type: 'mathBlock', attrs: { latex: String.raw`\text{MathStart}\quad\frac{a+b}{c+d}\quad\text{MathEnd}` } };
    else if (kind === 'image' || kind === 'nestedImage') {
      node = { type: 'image', attrs: { src: picture(true), caption: 'ImageCaptionEnd' } };
      if (kind === 'nestedImage') node = { type: 'githubAlert', content: [node] };
    }
    else if (kind === 'grid') node = { type: 'imageCollection', attrs: { columns: 2 }, content: Array.from({ length: 8 }, (_, index) => ({ type: 'imageSlot', content: [{ type: 'image', attrs: { src: picture() } }, paragraph(`GridCaption${index}End`)] })) };
    else node = { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableHeader', content: [paragraph('TableStart')] }] }, ...lines.map(line => ({ type: 'tableRow', content: [{ type: 'tableCell', content: [paragraph(line)] }] }))] };
    const doc = documentParser().schema.nodeFromJSON({ type: 'doc', content: [node, paragraph('DocumentEnd')] });
    const rendered = await renderDocument('', 'Container Pagination', '', undefined, doc);
    root.innerHTML = rendered.html;
    await Promise.all(Array.from(root.querySelectorAll('img'), image => image.decode()));
    await document.fonts.ready;
    const session = createLayoutSession(root);
    const report = await session.update(DEFAULT_PDF);
    const spacer = document.createElement('div'); spacer.textContent = 'LeadingContent';
    const box = root.querySelector('article')?.firstElementChild ?? root.firstElementChild!;
    const boxHeight = box.getBoundingClientRect().height;
    spacer.style.height = `${long || kind === 'grid' ? pageHeight * .62 : Math.max(0, pageHeight - boxHeight / 2 - 5)}px`;
    root.prepend(spacer);
    return { report, lines, boxHeight, pageHeight, rules: Array.from(root.querySelectorAll<HTMLElement>('[data-export-pagination]'), element => ({ class: element.className, policy: element.dataset.exportPagination, height: element.getBoundingClientRect().height })) };
  },
} });
