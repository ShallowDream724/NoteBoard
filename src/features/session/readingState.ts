import { getEditorCapabilities } from '../../core/editor/editorRegistry';
import type { ReadingState } from '../../core/ipc/types';
import { peekViewState } from './editorSuspension';

function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object'; }
function nonnegative(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(value, 0) : 0;
}

/** Keep only reading coordinates. Editor snapshots may also contain private plug-in state. */
export function readingState(value: unknown): ReadingState | undefined {
  if (!record(value)) return;
  if (value.kind === 'pdf') return { kind: 'pdf', page: Math.max(1, Math.floor(nonnegative(value.page))),
    zoom: nonnegative(value.zoom) || 1, scrollTop: nonnegative(value.scrollTop), scrollLeft: nonnegative(value.scrollLeft),
    ...(typeof value.verticalRatio === 'number' && Number.isFinite(value.verticalRatio)
      ? { verticalRatio: nonnegative(value.verticalRatio) } : {}),
    ...(typeof value.horizontalRatio === 'number' && Number.isFinite(value.horizontalRatio)
      ? { horizontalRatio: Math.min(1, nonnegative(value.horizontalRatio)) } : {}) };
  if (value.kind !== 'code' && value.kind !== 'markdown') return;
  const selection = record(value.selection) ? {
    anchor: Math.floor(nonnegative(value.selection.anchor)), head: Math.floor(nonnegative(value.selection.head)),
  } : null;
  const scrollTop = nonnegative(value.scrollTop);
  if (value.kind === 'markdown' && (value.mode === 'source' || value.mode === 'visual')) {
    return { kind: 'markdown', mode: value.mode, selection, scrollTop, scrollLeft: nonnegative(value.scrollLeft) };
  }
  if (value.kind === 'code') {
    const foldedRanges = Array.isArray(value.foldedRanges) ? value.foldedRanges.slice(0, 256).flatMap(range => {
      if (!record(range)) return [];
      const from = Math.floor(nonnegative(range.from)), to = Math.floor(nonnegative(range.to));
      return from < to ? [{ from, to }] : [];
    }) : [];
    return { kind: 'code', selection, scrollTop, foldedRanges };
  }
}

export function captureReadingState(key: string) {
  try { return readingState(getEditorCapabilities(key)?.captureViewState?.() ?? peekViewState(key)); }
  catch { return undefined; }
}
