import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ExportSettings } from '../../src/core/ipc/types';
import { DEFAULT_PDF } from '../../src/features/export/model';
import { restorePdfOptions } from '../../src/features/export/pdfPreferences';
import { usePdfOptions } from '../../src/features/export/usePdfOptions';
import { DraftNumberField } from '../../src/features/export/DraftNumberField';

const saved = vi.hoisted(() => ({ export: undefined as ExportSettings | undefined, write: vi.fn() }));
vi.mock('../../src/stores/settingsStore', () => ({ useSettingsStore: { getState: () => ({ settings: { export: saved.export }, setExport: saved.write }) } }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

beforeEach(() => {
  saved.export = undefined;
  saved.write.mockReset().mockImplementation(async (patch: Partial<ExportSettings>) => {
    saved.export = { pandocPath: '', ...saved.export, ...patch, pdf: { ...saved.export?.pdf, ...patch.pdf } };
  });
});

it('restores every reusable page choice with fresh document-specific state', () => {
  const preferences = {
    paper: 'Letter', landscape: true, marginMm: 22, horizontalMarginMm: 18,
    fontPt: 16, lineHeight: 1.8, paragraphSpacingEm: 1.2, pageNumbers: false,
    pageNumberPosition: 'top-right', pageNumberStyle: 'total',
  };
  const result = restorePdfOptions({ ...preferences, items: { privateTable: 'wrap' }, acceptedReceipt: 'previous-receipt' });
  expect(result).toEqual({ ...preferences, items: {} });
  expect(result.items).not.toBe(DEFAULT_PDF.items);
  expect(restorePdfOptions(undefined)).toEqual(DEFAULT_PDF);
});

it('falls back for invalid values without discarding valid preferences', () => {
  expect(restorePdfOptions({ paper: 'A3', landscape: 'yes', marginMm: -1, horizontalMarginMm: 41,
    fontPt: Infinity, lineHeight: NaN, paragraphSpacingEm: null, pageNumbers: 1,
    pageNumberPosition: 'middle', pageNumberStyle: 'total',
  })).toEqual({ ...DEFAULT_PDF, pageNumberStyle: 'total' });
  expect(restorePdfOptions([])).toEqual(DEFAULT_PDF);
});

it('saves committed edits only, keeps an open session stable, and restores the latest defaults on reopening', async () => {
  saved.export = { pandocPath: 'pandoc.exe', pdf: { fontPt: 13 } };
  const host = document.createElement('div'); document.body.append(host);
  let root = createRoot(host), state!: ReturnType<typeof usePdfOptions>;
  const onError = vi.fn();
  function Harness() {
    state = usePdfOptions(onError);
    return <DraftNumberField label="正文字号" value={state.options.fontPt} min={8} max={24} step={0.5}
      onCommit={value => state.updatePage('fontPt', value)}/>;
  }
  try {
    await act(async () => root.render(<Harness/>));
    expect(state.options.fontPt).toBe(13);
    expect(saved.write).not.toHaveBeenCalled();
    const initial = state.options;
    saved.export = { pandocPath: 'new-pandoc.exe', pdf: { fontPt: 20, landscape: true, marginMm: 24 } };
    await act(async () => root.render(<Harness/>));
    expect(state.options).toBe(initial); // A foreign setting does not queue a new PDF revision.
    const input = host.querySelector('input')!;
    input.focus();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '16');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(saved.write).not.toHaveBeenCalled();
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(saved.write).toHaveBeenCalledExactlyOnceWith({ pdf: { fontPt: 16 } });
    expect(saved.export).toEqual({ pandocPath: 'new-pandoc.exe', pdf: { fontPt: 16, landscape: true, marginMm: 24 } });
    await act(async () => { state.updatePage('fontPt', 16); state.updateItem('table-1', 'wrap'); });
    expect(saved.write).toHaveBeenCalledTimes(1);
    expect(state.options.items).toEqual({ 'table-1': 'wrap' });
    await act(async () => root.unmount());
    root = createRoot(host);
    await act(async () => root.render(<Harness/>));
    expect(state.options).toMatchObject({ fontPt: 16, landscape: true, marginMm: 24, items: {} });
    expect(saved.write).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it('reports a failed preference save while leaving the current preview editable', async () => {
  saved.write.mockRejectedValue(new Error('disk full'));
  const host = document.createElement('div'), root = createRoot(host), onError = vi.fn();
  let state!: ReturnType<typeof usePdfOptions>;
  function Harness() { state = usePdfOptions(onError); return null; }
  await act(async () => root.render(<Harness/>));
  await act(async () => state.updatePage('paper', 'Letter'));
  expect(state.options.paper).toBe('Letter');
  expect(onError).toHaveBeenCalledWith(new Error('disk full'));
  await act(async () => root.unmount());
});
