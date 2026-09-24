export const PDF_PHASES = {
  preparing: '整理文档',
  queued: '准备预览',
  starting: '启动排版',
  resources: '加载字体与图片',
  layout: '内容排版',
  printing: '生成 PDF',
  finishing: '处理页码与链接',
  loading: '加载预览',
} as const;

export type PdfPhase = keyof typeof PDF_PHASES;
export interface PdfProgress {
  phase: PdfPhase;
  startedAt: number;
  id?: string;
  revision?: number;
}
export interface PdfProgressEvent {
  id: string;
  revision: number;
  phase: 'resources' | 'layout' | 'printing' | 'finishing';
}
const order = Object.keys(PDF_PHASES);

/** A delayed event from a cancelled session/revision cannot replace the active
 * operation. Duplicate or out-of-order stages do not trigger a React update. */
export function advancePdfProgress(current: PdfProgress | null, event: PdfProgressEvent): PdfProgress | null {
  if (!current || current.id !== event.id || current.revision !== event.revision
    || order.indexOf(event.phase) <= order.indexOf(current.phase)) return current;
  return { ...current, phase: event.phase };
}
