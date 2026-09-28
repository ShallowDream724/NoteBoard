import type { PdfPagePreferences } from '../../core/ipc/types';
import { DEFAULT_PDF, type PdfOptions } from './model';

const ranges = { marginMm: [0, 40], horizontalMarginMm: [0, 40], fontPt: [8, 24], lineHeight: [1, 2.5], paragraphSpacingEm: [0, 2] } as const;

/** A fresh session restores only valid page fields, never document-specific state. */
export function restorePdfOptions(saved: unknown): PdfOptions {
  const options = { ...DEFAULT_PDF, items: {} };
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return options;
  const values = saved as Record<string, unknown>;
  for (const key of Object.keys(ranges) as Array<keyof typeof ranges>) {
    const value = values[key], [min, max] = ranges[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max) options[key] = value;
  }
  if (values.paper === 'A4' || values.paper === 'Letter') options.paper = values.paper;
  if (typeof values.landscape === 'boolean') options.landscape = values.landscape;
  if (typeof values.pageNumbers === 'boolean') options.pageNumbers = values.pageNumbers;
  if (['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right'].includes(values.pageNumberPosition as string)) {
    options.pageNumberPosition = values.pageNumberPosition as PdfPagePreferences['pageNumberPosition'];
  }
  if (['number', 'total', 'dashes'].includes(values.pageNumberStyle as string)) {
    options.pageNumberStyle = values.pageNumberStyle as PdfPagePreferences['pageNumberStyle'];
  }
  return options;
}
