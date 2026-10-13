/** Lightweight persisted metadata; safe for the initial shell/storage layer. */
export const MAX_DOCUMENT_BOOKMARKS = 100;
export const BOOKMARK_COLORS = [
  { value: 'amber', label: '橙色', css: '#d97706' },
  { value: 'blue', label: '蓝色', css: '#397bfa' },
  { value: 'green', label: '绿色', css: '#21865b' },
  { value: 'violet', label: '紫色', css: '#8761c4' },
  { value: 'red', label: '红色', css: '#d74b55' },
] as const;
export type BookmarkColor = typeof BOOKMARK_COLORS[number]['value'];
export interface DocumentBookmark {
  id: string;
  pos: number;
  size: number;
  nodeType: string;
  quote: string;
  label: string;
  missing: boolean;
  /** Old records are block anchors; ranges use exact document positions. */
  kind?: 'range';
  color?: BookmarkColor;
  contextBefore?: string;
  contextAfter?: string;
}
