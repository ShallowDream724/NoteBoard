import { useMemo } from 'react';
import { renderMermaidSvg } from './mermaidRenderer';
import type { ChartImageSource } from '../export/chartExport';

/** A single current-source export cache. No work until a user selects a format;
 * source/owner changes release the closure, and the menu owns cancellation. */
export function useMermaidExportSource(code: string, owner = '') {
  return useMemo(() => {
    void owner;
    let cached: string | undefined;
    return async (signal: AbortSignal): Promise<ChartImageSource | null> => {
      if (signal.aborted) return null;
      const svg = cached ?? await renderMermaidSvg(code, 'default', signal);
      if (signal.aborted || !svg) return null;
      if (svg.length <= 2_000_000) cached = svg;
      return { kind: 'svg', svg };
    };
  }, [code, owner]);
}
