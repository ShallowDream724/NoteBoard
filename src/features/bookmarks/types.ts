/** Lightweight persisted metadata; safe for the initial shell/storage layer. */
export const MAX_DOCUMENT_BOOKMARKS = 100;
export interface DocumentBookmark {
  id: string;
  pos: number;
  size: number;
  nodeType: string;
  quote: string;
  label: string;
  missing: boolean;
  contextBefore?: string;
  contextAfter?: string;
}
