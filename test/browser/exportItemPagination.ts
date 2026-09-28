import { addItemLocations } from '../../src/features/export/itemLocations';
import '../../src/features/export/document.css';

const source = String.raw`\textbf{why} \mathbf{L}`;
const root = document.querySelector<HTMLElement>('#document')!;
document.documentElement.style.cssText = '--export-font:10.5pt;--export-line:1.4;--export-width:186mm';

Object.assign(window, { exportItemPaginationQA: {
  async render(spacerHeight = 950) {
    root.innerHTML = `<div style="height:${spacerHeight}px">Leading content</div><h2>Keep this heading <span class="export-math inline" data-export-item="formula-error" data-render-error="Invalid TeX"></span></h2><table><tbody><tr><td style="height:100px">Following table</td></tr></tbody></table>`;
    const formula = root.querySelector<HTMLElement>('.export-math')!;
    formula.textContent = source;
    addItemLocations([formula], new Set(['formula-error']));
    await document.fonts.ready;
  },
} });
