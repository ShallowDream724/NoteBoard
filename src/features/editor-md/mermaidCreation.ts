import type { Transaction } from '@tiptap/pm/state';

/** Creation is an editing intent, never inferred from matching template text. */
export const MERMAID_CREATION_META = 'noteboard-mermaid-created';
export function markMermaidCreation(tr: Transaction): Transaction {
  return tr.setMeta(MERMAID_CREATION_META, true);
}
