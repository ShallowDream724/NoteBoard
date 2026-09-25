import { describe, expect, it, vi } from 'vitest';
import { renderDocument } from '../../src/features/export/renderDocument';
import { renderExportDiagrams } from '../../src/features/export/renderDiagrams';
import { renderMermaidSvg } from '../../src/features/diagram-preview/mermaidRenderer';
import { renderPlantUmlToSvg } from '../../src/features/plantuml/plantumlEncoder';

vi.mock('../../src/features/diagram-preview/mermaidRenderer', () => ({ renderMermaidSvg: vi.fn() }));
vi.mock('../../src/features/plantuml/plantumlEncoder', () => ({ renderPlantUmlToSvg: vi.fn() }));

describe('diagram document export', () => {
  it('uses shared renderers and replaces source nodes with final figures', async () => {
    vi.mocked(renderMermaidSvg).mockResolvedValue('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"><text x="4" y="20">Shared Mermaid figure</text></svg>');
    vi.mocked(renderPlantUmlToSvg).mockResolvedValue({ svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"><text x="4" y="20">Shared UML figure</text></svg>' });
    const markdown = '```mermaid\ngraph LR\nA-->B\n```\n\n```plantuml\nAlice -> Bob: hello\n```\n\n```infographic\n{"type":"metric","title":"Export metrics","data":[{"label":"Completed","value":"42"}]}\n```';
    const result = await renderDocument(markdown, 'Diagram export', '', undefined, undefined, undefined, undefined, 'print', requests => renderExportDiagrams(requests));
    const root = document.createElement('div'); root.innerHTML = result.html;
    expect(root.querySelectorAll('.export-diagram')).toHaveLength(3);
    expect(root.querySelectorAll('.export-diagram > svg')).toHaveLength(2);
    expect(root.querySelector('[data-diagram-error]')).toBeNull();
    expect(root.textContent).toContain('Shared Mermaid figure'); expect(root.textContent).toContain('Export metrics');
    expect(root.textContent).toContain('Completed'); expect(root.textContent).toContain('42');
    expect(root.textContent).not.toContain('A-->B'); expect(root.querySelector('pre')).toBeNull();
    expect(renderMermaidSvg).toHaveBeenCalledWith('graph LR\nA-->B', 'default', undefined);
    expect(result.items.filter(item => item.kind === 'diagram')).toHaveLength(3);
  });

  it('keeps legible source only after a renderer reports a real failure', async () => {
    vi.mocked(renderMermaidSvg).mockRejectedValue(new Error('Parse error at line 2'));
    const result = await renderDocument('```mermaid\ngraph LR\nA[broken\n```', 'Broken', '', undefined, undefined, undefined, undefined, 'print', requests => renderExportDiagrams(requests));
    const root = document.createElement('div'); root.innerHTML = result.html;
    expect(root.querySelector('[data-diagram-error]')?.textContent).toContain('渲染失败');
    expect(root.querySelector('.export-diagram-error')?.textContent).toContain('Parse error at line 2');
    expect(root.querySelector('pre')?.textContent).toBe('graph LR\nA[broken');
    expect(root.querySelector('[data-export-source-only]')).toBeNull();
  });
});
