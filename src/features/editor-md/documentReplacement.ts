import type { Transaction } from '@tiptap/pm/state';

/** Loading, source synchronization and application history restore a document;
 * Tiptap must not interpret an empty target as the user deleting a whole selection. */
export function markDocumentReplacement(tr: Transaction, origin: 'sync' | 'history'): Transaction {
  return tr.setMeta('addToHistory', false)
    .setMeta('noteboard-document-replacement', origin)
    .setMeta('preventClearDocument', true);
}
