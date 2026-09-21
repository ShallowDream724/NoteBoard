export type ItemMode = 'auto' | 'fit' | 'wrap' | 'columns';
export interface PdfOptions {
  paper: 'A4' | 'Letter'; landscape: boolean; marginMm: number;
  fontPt: number; lineHeight: number; minimumPt: number; pageNumbers: boolean;
  items: Record<string, ItemMode>;
}
export const DEFAULT_PDF: PdfOptions = {
  paper: 'A4', landscape: false, marginMm: 12, fontPt: 10.5, lineHeight: 1.4,
  minimumPt: 8, pageNumbers: false, items: {},
};
export interface ExportItem { id: string; kind: 'formula' | 'table'; label: string }
export interface LayoutIssue { id: string; message: string; blocking: boolean }
export interface ExportDocument { title: string; html: string; items: ExportItem[]; baseDirectory: string; markdown: string }
export interface PdfPayload { html: string; options: PdfOptions; title: string; fontCss: string }
export interface PdfReceipt { id: string; issues: LayoutIssue[] }
export function paperSize(options: PdfOptions) {
  const size = options.paper === 'Letter' ? [215.9, 279.4] : [210, 297];
  return options.landscape ? size.reverse() : size;
}
