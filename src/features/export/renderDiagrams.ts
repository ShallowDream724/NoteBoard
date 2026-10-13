import type { DiagramRequest, DiagramResult } from './diagramRendering';

async function plantUml(code: string, signal?: AbortSignal) {
  // Export only reuses previously authorized, sanitized results. It never uploads source.
  return (await import('../plantuml/plantumlEncoder')).renderPlantUmlToSvg(code, signal, { allowNetwork: false });
}

/** Runs in a real browser, outside the conversion worker. Every target uses
 * the same renderers as its editor; light colors and static markup suit print. */
export async function renderExportDiagrams(requests: DiagramRequest[], signal?: AbortSignal): Promise<DiagramResult[]> {
  const results: DiagramResult[] = [];
  for (const request of requests) {
    signal?.throwIfAborted();
    try {
      if (!request.code.trim()) throw new Error('图表内容为空。');
      if (request.kind === 'infographic') {
        const [{ parseInfographicCode }, { InfographicRenderer }, { createElement }, { renderToStaticMarkup }] = await Promise.all([
          import('../infographic/infographicParser'), import('../infographic/infographicRenderer'), import('react'), import('react-dom/server'),
        ]);
        const { data, error } = parseInfographicCode(request.code);
        if (error || !data) throw new Error(error || '无法读取信息图内容。');
        results.push({ html: renderToStaticMarkup(createElement(InfographicRenderer, { data })) });
      } else {
        let svg: string;
        if (request.kind === 'mermaid') svg = await (await import('../diagram-preview/mermaidRenderer')).renderMermaidSvg(request.code, 'default', signal);
        else {
          const result = await plantUml(request.code, signal);
          if (result.error) throw new Error(result.error);
          svg = result.svg;
        }
        signal?.throwIfAborted();
        if (!svg.trim()) throw new Error('图表未生成可显示的图形。');
        const { normalizeSvg } = await import('./chartExport');
        results.push({ html: normalizeSvg(svg) });
      }
    } catch (error) {
      signal?.throwIfAborted();
      results.push({ html: '', error: error instanceof Error ? error.message : String(error) });
    }
  }
  signal?.throwIfAborted();
  return results;
}
