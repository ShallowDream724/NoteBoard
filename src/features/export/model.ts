export type ItemMode = 'auto' | 'fit' | 'wrap' | 'columns';
export interface PdfOptions {
  paper: 'A4' | 'Letter'; landscape: boolean; marginMm: number;
  fontPt: number; lineHeight: number; pageNumbers: boolean;
  pageNumberPosition: 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right';
  pageNumberStyle: 'number' | 'total' | 'dashes';
  items: Record<string, ItemMode>;
}
export const DEFAULT_PDF: PdfOptions = {
  paper: 'A4', landscape: false, marginMm: 12, fontPt: 10.5, lineHeight: 1.4,
  pageNumbers: true, pageNumberPosition: 'bottom-center', pageNumberStyle: 'number', items: {},
};
export interface ExportItem { id: string; kind: 'formula' | 'table'; label: string }
export interface LayoutIssue { id: string; message: string; blocking: boolean }
export interface ExportDocument { title: string; html: string; items: ExportItem[]; baseDirectory: string; markdown: string; source?: string | import('@tiptap/core').JSONContent; richSummary?: import('./richProjection').RichExportSummary }
export interface PdfPayload { html: string; options: PdfOptions; title: string; fontCss: string }
export interface ItemLocation { id: string; page: number; rect: [number, number, number, number] }
export interface LayoutReport { issues: LayoutIssue[]; adjustable: string[] }
export interface PdfReceipt extends LayoutReport { id: string; revision: number; size: number; pages: number; locations: ItemLocation[] }
export function paperSize(options: PdfOptions) {
  const size = options.paper === 'Letter' ? [215.9, 279.4] : [210, 297];
  return options.landscape ? size.reverse() : size;
}
